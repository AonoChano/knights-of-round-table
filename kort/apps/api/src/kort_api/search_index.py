"""Persistent full-text index over conversation titles and visible message bodies.

The conversation store is a directory of JSON documents, which is a poor place to run a
substring scan over every message on each keystroke. This keeps a SQLite FTS5 index beside the
store (runtime/data/search.db) with a trigram tokenizer, so Chinese, English, digits and mixed
queries all match as substrings. ConversationStore re-indexes just the conversation it wrote.

Only what the user actually sees is indexed: the session title, user messages and assistant
final answers. Internal discussion transcripts, tool traces and stage summaries stay out.
"""

from __future__ import annotations

import base64
import json
import logging
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .schemas import ConversationRecord, MessageNode

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "kort-search-2"
TITLE_WEIGHT = 4.0
BODY_WEIGHT = 1.0
MIN_TRIGRAM = 3  # fewer characters than this cannot use MATCH, so fall back to LIKE
MAX_TEXT_CHARS = 24_000
SNIPPET_WINDOW = 90
PER_CONVERSATION_CAP = 2
CANDIDATE_MULTIPLIER = 4
COLUMNS = "conversation_id, node_id, role, message_at, conversation_title, scope, title, body"


@dataclass
class SearchHit:
    conversation_id: str
    conversation_title: str
    node_id: str | None
    match_type: str
    role: str | None
    snippet: str
    matches: list[tuple[int, int]]
    message_time: str
    score: float


@dataclass
class SearchPage:
    query: str
    scope: str
    results: list[SearchHit]
    next_cursor: str | None
    total: int
    took_ms: int


def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(json.dumps({"offset": int(offset)}).encode()).decode()


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        offset = int(payload.get("offset"))
    except Exception as exc:
        raise ValueError("Invalid search cursor") from exc
    if offset < 0:
        raise ValueError("Invalid search cursor")
    return offset


def _terms(query: str) -> list[str]:
    return [term for term in query.split() if term]


def _match_expression(query: str) -> str:
    """Every whitespace-separated term has to appear, each as its own substring phrase."""
    return " ".join('"' + term.replace('"', '""') + '"' for term in _terms(query))


def _uses_match(query: str) -> bool:
    """The trigram tokenizer needs three characters per term, so any shorter term forces LIKE."""
    terms = _terms(query)
    return bool(terms) and all(len(term) >= MIN_TRIGRAM for term in terms)


def _indexable(node: MessageNode) -> bool:
    return node.role in {"user", "assistant"} and node.status != "streaming" and bool(node.content.strip())


def _title_row(record: ConversationRecord) -> tuple[Any, ...]:
    return (
        record.conversation_id,
        "",
        "",
        record.updated_at.isoformat(),
        record.title,
        "title",
        record.title[:MAX_TEXT_CHARS],
        "",
    )


def _message_row(record: ConversationRecord, node: MessageNode) -> tuple[Any, ...]:
    return (
        record.conversation_id,
        node.node_id,
        node.role,
        node.created_at.isoformat(),
        record.title,
        "message",
        "",
        node.content[:MAX_TEXT_CHARS],
    )


def _rows_for(record: ConversationRecord) -> list[tuple[Any, ...]]:
    rows = [_title_row(record)]
    rows.extend(_message_row(record, node) for node in record.nodes if _indexable(node))
    return rows


def _window(text: str, start: int, end: int) -> tuple[int, int]:
    """Widen a cut to the nearest space so latin words are not sliced, CJK stays as is."""
    if start > 0:
        low = max(0, start - 40)
        cut = text.rfind(" ", low, start)
        if cut >= 0:
            start = cut + 1
    if end < len(text):
        high = min(len(text), end + 40)
        cut = text.find(" ", end, high)
        if cut >= 0:
            end = cut
    return start, end


def make_snippet(text: str, query: str) -> tuple[str, list[tuple[int, int]]]:
    """Cut a window around the first match and report highlight offsets inside the snippet.

    Offsets travel to the browser as numbers; the client renders them with React text nodes, so
    no stored message content is ever interpreted as markup.
    """
    needles = [term.casefold() for term in _terms(query)]
    if not needles:
        return text[: SNIPPET_WINDOW * 2].strip(), []
    haystack = text.casefold()
    found: list[tuple[int, int]] = []
    for needle in needles:
        probe = haystack.find(needle)
        while probe >= 0:
            found.append((probe, probe + len(needle)))
            probe = haystack.find(needle, probe + len(needle))
    if not found:
        return text[: SNIPPET_WINDOW * 2].strip(), []
    found.sort()
    lead = found[0]
    start, end = _window(
        text,
        max(0, lead[0] - SNIPPET_WINDOW),
        min(len(text), lead[1] + SNIPPET_WINDOW),
    )
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    offsets: list[tuple[int, int]] = []
    for hit_start, hit_end in found:
        if hit_end <= start or hit_start >= end:
            continue
        clipped = max(hit_start, start) - start + len(prefix)
        clipped_end = min(hit_end, end) - start + len(prefix)
        if clipped_end <= clipped:
            continue
        if offsets and clipped < offsets[-1][0] + offsets[-1][1]:
            previous_start, previous_len = offsets[-1]
            offsets[-1] = (previous_start, max(previous_start + previous_len, clipped_end) - previous_start)
            continue
        offsets.append((clipped, clipped_end - clipped))
        if len(offsets) >= 10:
            break
    return f"{prefix}{text[start:end]}{suffix}", offsets


class ConversationSearchIndex:
    """SQLite FTS5 index kept in step with the JSON conversation store."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._ready = False

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        return connection

    @contextmanager
    def _session(self) -> Iterator[sqlite3.Connection]:
        """One connection, committed on success and always closed.

        sqlite3's own context manager only ends the transaction; on Windows an open handle keeps
        the file locked, and a rebuild has to delete it.
        """
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _create(connection: sqlite3.Connection) -> None:
        connection.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        connection.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS items USING fts5(
                conversation_id UNINDEXED,
                node_id UNINDEXED,
                role UNINDEXED,
                message_at UNINDEXED,
                conversation_title UNINDEXED,
                scope UNINDEXED,
                title,
                body,
                tokenize = 'trigram'
            )
            """
        )

    @staticmethod
    def _meta(connection: sqlite3.Connection, key: str) -> str | None:
        row = connection.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return None if row is None else row["value"]

    def ready(self) -> bool:
        """True only once the whole history has been indexed at the current schema version."""
        if self._ready:
            return True
        try:
            with self._session() as connection:
                schema = self._meta(connection, "schema")
                built = self._meta(connection, "built")
                table = connection.execute("SELECT 1 FROM sqlite_master WHERE name='items'").fetchone()
            if schema == SCHEMA_VERSION and built == SCHEMA_VERSION and table is not None:
                self._ready = True
        except sqlite3.Error:
            logger.warning("search_index.check_failed path=%s", self.path, exc_info=True)
        return self._ready

    def build(self, records: Iterable[ConversationRecord]) -> int:
        """Rebuild from scratch: first use, or whenever the extractor or schema moves on."""
        started = time.perf_counter()
        collected = list(records)
        rows = [row for record in collected for row in _rows_for(record)]
        with self._lock:
            if self.path.exists():
                self.path.unlink()
            for wal in (self.path.with_name(self.path.name + "-wal"), self.path.with_name(self.path.name + "-shm")):
                if wal.exists():
                    wal.unlink()
            with self._session() as connection:
                self._create(connection)
                connection.executemany(
                    "INSERT INTO items(conversation_id, node_id, role, message_at,"
                    " conversation_title, scope, title, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    rows,
                )
                connection.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('schema', ?)", (SCHEMA_VERSION,))
                connection.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('built', ?)", (SCHEMA_VERSION,))
            self._ready = True
        logger.info(
            "search_index.built conversations=%s rows=%s duration_ms=%.1f path=%s",
            len(collected),
            len(rows),
            (time.perf_counter() - started) * 1000,
            self.path,
        )
        return len(rows)

    def sync(self, record: ConversationRecord) -> None:
        """Replace one conversation's rows after the store wrote it."""
        rows = _rows_for(record)
        started = time.perf_counter()
        try:
            with self._lock:
                with self._session() as connection:
                    self._create(connection)
                    if self._meta(connection, "built") != SCHEMA_VERSION:
                        # A full build has not run yet, so a partial row set would be mistaken for one.
                        logger.debug("search_index.sync_deferred conversation_id=%s", record.conversation_id)
                        return
                    connection.execute("DELETE FROM items WHERE conversation_id = ?", (record.conversation_id,))
                    connection.executemany(
                        "INSERT INTO items(conversation_id, node_id, role, message_at,"
                        " conversation_title, scope, title, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        rows,
                    )
        except sqlite3.Error:
            logger.warning("search_index.sync_failed conversation_id=%s", record.conversation_id, exc_info=True)
            return
        logger.debug(
            "search_index.synced conversation_id=%s rows=%s duration_ms=%.1f",
            record.conversation_id,
            len(rows),
            (time.perf_counter() - started) * 1000,
        )

    def remove(self, conversation_id: str) -> None:
        try:
            with self._lock:
                with self._session() as connection:
                    self._create(connection)
                    connection.execute("DELETE FROM items WHERE conversation_id = ?", (conversation_id,))
        except sqlite3.Error:
            logger.warning("search_index.remove_failed conversation_id=%s", conversation_id, exc_info=True)

    def search(
        self,
        query: str,
        *,
        scope: str = "all",
        limit: int = 20,
        cursor: str | None = None,
    ) -> SearchPage:
        started = time.perf_counter()
        term = query.strip()
        scope = scope if scope in {"all", "title", "message"} else "all"
        offset = decode_cursor(cursor)
        if not term:
            return SearchPage(term, scope, [], None, 0, self._elapsed(started))
        if not self.ready():
            return SearchPage(term, scope, [], None, 0, self._elapsed(started))

        scopes = ("title", "message") if scope == "all" else (scope,)
        fetch = max(limit, 1) * CANDIDATE_MULTIPLIER
        candidates = self._candidates(term, scopes, fetch, offset)
        total = self._count(term, scopes)

        results: list[SearchHit] = []
        per_conversation: dict[str, int] = {}
        consumed = 0
        for row in candidates:
            consumed += 1
            text = row["title"] if row["scope"] == "title" else row["body"]
            snippet, matches = make_snippet(text, term)
            if row["scope"] == "message" and not matches:
                # The index matched but the highlight did not: stale row, keep it out of results.
                logger.debug("search_index.highlight_miss node_id=%s", row["node_id"])
                continue
            key = row["conversation_id"]
            if per_conversation.get(key, 0) >= PER_CONVERSATION_CAP:
                continue
            per_conversation[key] = per_conversation.get(key, 0) + 1
            results.append(
                SearchHit(
                    conversation_id=row["conversation_id"],
                    conversation_title=row["conversation_title"],
                    node_id=row["node_id"] or None,
                    match_type=row["scope"],
                    role=row["role"] or None,
                    snippet=snippet,
                    matches=matches,
                    message_time=row["message_at"],
                    score=float(row["score"] or 0.0),
                )
            )
            if len(results) >= limit:
                break

        unclaimed = consumed < len(candidates)
        more_rows_possible = len(candidates) >= fetch
        next_cursor = encode_cursor(offset + consumed) if results and (unclaimed or more_rows_possible) else None
        return SearchPage(term, scope, results, next_cursor, total, self._elapsed(started))

    @staticmethod
    def _elapsed(started: float) -> int:
        return max(1, int((time.perf_counter() - started) * 1000))

    def _matcher(self, term: str, scopes: tuple[str, ...]) -> tuple[str, tuple[str, ...]]:
        """The WHERE clause without the scope filter and the term bindings that close it."""
        placeholder = ",".join(["?"] * len(scopes))
        scoped = f"scope IN ({placeholder})"
        if _uses_match(term):
            return f"{scoped} AND items MATCH ?", (_match_expression(term),)
        likes: list[str] = []
        params: list[str] = []
        for item in _terms(term):
            likes.append("(title LIKE ? COLLATE NOCASE OR body LIKE ? COLLATE NOCASE)")
            params.extend((f"%{item.casefold()}%", f"%{item.casefold()}%"))
        return f"{scoped} AND {' AND '.join(likes)}", tuple(params)

    def _select(
        self, term: str, scopes: tuple[str, ...], window: str
    ) -> tuple[str, tuple[Any, ...]]:
        matcher, tail = self._matcher(term, scopes)
        if _uses_match(term):
            weights = (0, 0, 0, 0, 0, 0, TITLE_WEIGHT, BODY_WEIGHT)
            return (
                f"SELECT {COLUMNS}, bm25(items, ?, ?, ?, ?, ?, ?, ?, ?) AS score FROM items"
                f" WHERE {matcher} ORDER BY score, message_at DESC LIMIT {window}"
            ), (*weights, *scopes, *tail)
        return (
            f"SELECT {COLUMNS}, 0 AS score FROM items WHERE {matcher}"
            " ORDER BY CASE WHEN scope='title' THEN 0 ELSE 1 END, message_at DESC"
            f" LIMIT {window}"
        ), (*scopes, *tail)

    def _count_statement(self, term: str, scopes: tuple[str, ...]) -> tuple[str, tuple[Any, ...]]:
        matcher, tail = self._matcher(term, scopes)
        return f"SELECT count(*) FROM items WHERE {matcher}", (*scopes, *tail)

    def _candidates(
        self, term: str, scopes: tuple[str, ...], fetch: int, offset: int
    ) -> list[sqlite3.Row]:
        sql, params = self._select(term, scopes, f"{int(fetch)} OFFSET {int(offset)}")
        with self._lock:
            with self._session() as connection:
                try:
                    return connection.execute(sql, params).fetchall()
                except sqlite3.Error:
                    logger.warning("search_index.query_failed term=%s", term[:40], exc_info=True)
                    return []

    def _count(self, term: str, scopes: tuple[str, ...]) -> int:
        sql, params = self._count_statement(term, scopes)
        with self._lock:
            with self._session() as connection:
                try:
                    row = connection.execute(sql, params).fetchone()
                except sqlite3.Error:
                    logger.warning("search_index.count_failed term=%s", term[:40], exc_info=True)
                    return 0
        return int(row[0]) if row is not None else 0
