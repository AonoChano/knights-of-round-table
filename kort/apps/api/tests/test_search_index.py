"""Tests for conversation history search: the SQLite FTS5 index, then the HTTP endpoint."""

import statistics
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import kort_api.app as app_module
from kort_api.schemas import ConversationRecord, DiscussionMessage, MessageNode, ToolTrace
from kort_api.search_index import ConversationSearchIndex, decode_cursor, encode_cursor, make_snippet

client = TestClient(app_module.app)

BASE = datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc)


def _node(
    role: str,
    content: str,
    *,
    offset_min: int = 0,
    status: str = "complete",
    node_id: str | None = None,
) -> MessageNode:
    return MessageNode(
        node_id=node_id or f"node-{uuid4()}",
        parent_id=None,
        role=role,
        content=content,
        status=status,
        created_at=BASE + timedelta(minutes=offset_min),
    )


def _record(
    title: str,
    nodes: list[MessageNode],
    *,
    conversation_id: str | None = None,
) -> ConversationRecord:
    return ConversationRecord(
        conversation_id=conversation_id or f"conv-{uuid4()}",
        created_at=BASE,
        updated_at=BASE + timedelta(minutes=30),
        title=title,
        expert_count=1,
        nodes=nodes,
    )


@pytest.fixture
def index(tmp_path: Path) -> ConversationSearchIndex:
    return ConversationSearchIndex(tmp_path / "search.db")


# ---------------------------------------------------------------------------
# the index
# ---------------------------------------------------------------------------


def test_chinese_title_and_body_both_match(index: ConversationSearchIndex) -> None:
    index.build([
        _record("诺贝尔文学奖归属", [
            _node("user", "帮我查一下 2024 年诺贝尔文学奖是谁拿的？"),
            _node("assistant", "获奖者是韩国作家韩江，代表作《素食者》。", offset_min=1),
        ])
    ])
    page = index.search("诺贝尔")
    assert [hit.match_type for hit in page.results] == ["title", "message"]
    assert page.results[0].node_id is None
    assert page.results[1].role == "user"


def test_english_is_case_insensitive_across_both_rows(index: ConversationSearchIndex) -> None:
    index.build([_record("DeepSeek V3 performance", [_node("user", "How does deepseek-v3 compare with gpt-4o?")])])
    assert index.search("deepseek").total == 2
    assert {hit.match_type for hit in index.search("deepseek").results} == {"title", "message"}
    assert [hit.match_type for hit in index.search("deepseek-v3").results] == ["message"]


def test_separate_terms_have_to_share_a_row(index: ConversationSearchIndex) -> None:
    both = _record("DeepSeek 的定价", [_node("user", "顺便对比一下 GPT-4o 的能力")], conversation_id="both")
    partial = _record("只谈定价", [_node("user", "定价表如下")], conversation_id="partial")
    index.build([both, partial])

    assert [hit.conversation_id for hit in index.search("deepseek 定价").results] == ["both"]
    assert index.search("deepseek 定价").total == 1
    assert index.search("定价 能力").total == 0  # the terms sit in different rows, so nothing matches
    assert [hit.match_type for hit in index.search("gpt-4o 能力").results] == ["message"]
    assert index.search("定价").total == 3  # drop the second term and both sessions come back


def test_short_terms_are_anded_by_the_substring_scan(index: ConversationSearchIndex) -> None:
    index.build([
        _record("消息总线 bus", [_node("user", "这条消息总线走的是 bus 拓扑")], conversation_id="bus"),
        _record("只有总线", [_node("user", "没有别的")], conversation_id="nope"),
    ])
    hits = index.search("总线 bus")  # "bus" is under three characters, so the query takes LIKE
    assert [hit.conversation_id for hit in hits.results] == ["bus", "bus"]
    assert [hit.match_type for hit in hits.results] == ["title", "message"]
    assert all(hit.score == 0.0 for hit in hits.results)


def test_digit_runs_match(index: ConversationSearchIndex) -> None:
    index.build([_record("端口 28888 排查", [_node("user", "SearXNG 在 localhost:28888 上返回 000。")])])
    page = index.search("28888")
    assert page.total == 2
    assert {hit.snippet for hit in page.results} == {
        "端口 28888 排查",
        "SearXNG 在 localhost:28888 上返回 000。",
    }


def test_queries_too_short_for_the_tokenizer_still_find_substrings(index: ConversationSearchIndex) -> None:
    index.build([_record("消息总线", [_node("assistant", "这条消息使用了 message bus 架构。")])])
    for term in ("总线", "总", "ge"):
        page = index.search(term)
        assert page.total >= 1, term
        assert all(hit.score == 0.0 for hit in page.results), term  # the LIKE path carries no bm25 score


def test_only_visible_message_content_is_indexed(index: ConversationSearchIndex) -> None:
    answer = _node("assistant", "已经定稿的回答", node_id="final-node")
    answer.discussion_messages = [
        DiscussionMessage(id="d1", round=1, speaker="a", nickname="A", role="expert", text="内部讨论稿不该被搜到")
    ]
    answer.tool_traces = [ToolTrace(id="t1", tool="search", query="内部工具痕迹不该被搜到")]
    index.build([_record("圆桌", [_node("assistant", "中间状态不该被搜到", status="streaming"), answer])])

    assert index.search("定稿").total == 1
    assert index.search("中间状态").total == 0
    assert index.search("不该被搜到").total == 0


def test_title_hits_outrank_body_hits(index: ConversationSearchIndex) -> None:
    index.build([_record("向量数据库选型", [_node("user", "我们在聊向量数据库的选型")])])
    assert [hit.match_type for hit in index.search("向量数据库").results] == ["title", "message"]


def test_equal_scores_are_broken_by_the_newest_row(index: ConversationSearchIndex) -> None:
    older = _record("索引调优 旧", [_node("user", "旧的调优讨论")], conversation_id="older")
    older.updated_at = BASE
    newer = _record("索引调优 新", [_node("user", "新的调优讨论")], conversation_id="newer")
    newer.updated_at = BASE + timedelta(days=3)
    newer.nodes[0].created_at = BASE + timedelta(days=3)
    index.build([older, newer])

    page = index.search("调优")  # two characters, so every row scores the same and the tie-break decides
    assert [hit.match_type for hit in page.results] == ["title", "title", "message", "message"]
    assert [hit.conversation_id for hit in page.results] == ["newer", "older", "newer", "older"]


def test_scope_selects_which_rows_are_searched(index: ConversationSearchIndex) -> None:
    index.build([_record("可观测性", [_node("user", "聊聊可观测性怎么落地")])])
    assert {hit.match_type for hit in index.search("可观测性", scope="title").results} == {"title"}
    assert {hit.match_type for hit in index.search("可观测性", scope="message").results} == {"message"}
    assert len(index.search("可观测性", scope="all").results) == 2
    assert len(index.search("可观测性", scope="nonsense").results) == 2  # an unknown scope degrades to all


def test_one_conversation_does_not_flood_the_list(index: ConversationSearchIndex) -> None:
    busy = _record("重复话题", [_node("assistant", f"第 {i} 次提到 trigram 分词") for i in range(12)])
    quiet = _record("另一个会话", [_node("user", "trigram 也出现在这里")])
    index.build([busy, quiet])

    page = index.search("trigram", limit=20)
    counts: dict[str, int] = {}
    for hit in page.results:
        counts[hit.conversation_id] = counts.get(hit.conversation_id, 0) + 1
    assert counts[busy.conversation_id] == 2
    assert counts[quiet.conversation_id] == 1
    assert page.total == 13  # the real match count stays honest even though the list is capped


def test_cursors_page_without_repeating_or_skipping_hits(index: ConversationSearchIndex) -> None:
    index.build([_record(f"分页会话 {i}", [_node("user", f"第 {i} 条提问")]) for i in range(7)])

    first = index.search("分页会话", limit=3)
    assert len(first.results) == 3
    assert first.next_cursor
    second = index.search("分页会话", limit=3, cursor=first.next_cursor)
    assert len(second.results) == 3
    seen = [hit.conversation_id for hit in first.results + second.results]
    assert len(set(seen)) == 6, seen

    tail = index.search("分页会话", limit=3, cursor=second.next_cursor)
    assert len(tail.results) == 1
    assert tail.next_cursor is None
    assert {hit.conversation_id for hit in tail.results}.isdisjoint(seen)


def test_an_unreadable_cursor_is_rejected(index: ConversationSearchIndex) -> None:
    with pytest.raises(ValueError):
        decode_cursor("!!! not a cursor !!!")
    with pytest.raises(ValueError):
        decode_cursor(encode_cursor(-1))
    assert decode_cursor(encode_cursor(40)) == 40
    assert decode_cursor(None) == 0


def test_sync_replaces_a_conversation_and_remove_drops_it(index: ConversationSearchIndex) -> None:
    record = _record("原始标题", [_node("user", "第一条提问")], conversation_id="synced")
    index.build([record])
    assert {hit.conversation_id for hit in index.search("原始标题").results} == {"synced"}

    renamed = record.model_copy(deep=True)
    renamed.title = "改名后的标题"
    index.sync(renamed)
    assert index.search("原始标题").total == 0
    assert index.search("改名后").total == 1

    index.remove("synced")
    assert index.search("改名后").total == 0


def test_a_write_before_the_first_build_does_not_pretend_the_index_is_ready(index: ConversationSearchIndex) -> None:
    index.sync(_record("先写入", [_node("user", "还没有整库构建")], conversation_id="early"))
    assert index.ready() is False
    assert index.search("先写入").total == 0  # an unbuilt index answers empty rather than partial

    index.build([
        _record("先写入", [_node("user", "还没有整库构建")], conversation_id="early"),
        _record("后建库", [_node("user", "第二条会话")], conversation_id="late"),
    ])
    assert index.ready() is True
    assert index.search("后建库").total == 1


def test_snippets_center_on_the_match_and_report_offsets_inside_themselves() -> None:
    body = "前言。" * 40 + "这里出现了需要高亮的关键词，后面还有更多内容。" + "尾声。" * 40
    snippet, offsets = make_snippet(body, "高亮的关键词")
    assert offsets
    start, length = offsets[0]
    assert snippet[start : start + length] == "高亮的关键词"
    assert len(snippet) < len(body)
    assert snippet.startswith("…") and snippet.endswith("…")


def test_snippet_offsets_survive_a_case_insensitive_english_match() -> None:
    snippet, offsets = make_snippet("We talked about DeepSeek here.", "deepseek")
    assert snippet[offsets[0][0] : offsets[0][0] + offsets[0][1]] == "DeepSeek"


def test_every_term_of_a_multi_word_query_gets_its_own_highlight() -> None:
    snippet, offsets = make_snippet("先说 Python 的写法，再谈排序的边界情况。", "python 排序")
    assert [snippet[start : start + length] for start, length in offsets] == ["Python", "排序"]


def test_overlapping_highlights_are_merged_into_one_span() -> None:
    snippet, offsets = make_snippet("llama llama llama", "llama llama")
    assert len(offsets) == 3
    assert all(snippet[start : start + length] == "llama" for start, length in offsets)


def test_repeated_searches_on_a_thousand_sessions_stay_quick(tmp_path: Path) -> None:
    records = [
        _record(
            f"基准会话 {i} 向量检索",
            [
                _node(
                    "user" if turn % 2 == 0 else "assistant",
                    f"第 {turn} 轮讨论 trigram 与 FTS5 的表现，会话编号 {i}。",
                )
                for turn in range(10)
            ],
            conversation_id=f"bench-{i}",
        )
        for i in range(1_000)
    ]
    index = ConversationSearchIndex(tmp_path / "bench.db")
    started = time.perf_counter()
    rows = index.build(records)
    build_ms = (time.perf_counter() - started) * 1000
    assert rows == 11_000

    timings = []
    for term in ("trigram", "基准会话 999", "向量检索", "FTS5"):
        for _ in range(5):
            started = time.perf_counter()
            page = index.search(term, limit=20)
            timings.append((time.perf_counter() - started) * 1000)
            assert page.results, term
    assert build_ms < 15_000
    assert statistics.median(timings) < 200
    assert max(timings) < 1_000


# ---------------------------------------------------------------------------
# the endpoint
# ---------------------------------------------------------------------------


def _seed(*records: ConversationRecord) -> None:
    for record in records:
        app_module.conversation_service.store.append(record)


def test_the_endpoint_reports_conversation_and_message_ids() -> None:
    _seed(_record("引用格式讨论", [
        _node("user", "引用的中括号格式怎么渲染？", node_id="ask-1"),
        _node("assistant", "用 [1] 这样的编号引用来源。", node_id="answer-1"),
    ], conversation_id="api-hit"))

    response = client.get("/api/conversations/search", params={"query": "中括号"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["query"] == "中括号"
    assert body["scope"] == "all"
    assert body["total"] == 1
    assert body["next_cursor"] is None
    assert body["took_ms"] >= 1

    hit = body["results"][0]
    assert hit["conversation_id"] == "api-hit"
    assert hit["conversation_title"] == "引用格式讨论"
    assert hit["node_id"] == "ask-1"
    assert hit["match_type"] == "message"
    assert hit["role"] == "user"
    assert hit["snippet"].startswith("引用的中括号")
    assert hit["matches"] == [[hit["snippet"].index("中括号"), 3]]
    assert hit["matched_at"].startswith("2026-10-20T08:00:00")


def test_the_endpoint_searches_every_stored_session_not_only_loaded_ones() -> None:
    _seed(*[_record(f"很久以前的会话 {i}", [_node("user", f"只有第 {i} 条记得这个暗号")]) for i in range(30)])

    body = client.get("/api/conversations/search", params={"query": "暗号", "limit": 5}).json()
    assert len(body["results"]) == 5
    assert body["total"] == 30
    assert body["next_cursor"]

    follow = client.get(
        "/api/conversations/search", params={"query": "暗号", "limit": 5, "cursor": body["next_cursor"]}
    ).json()
    assert follow["total"] == 30
    first_ids = {hit["conversation_id"] for hit in body["results"]}
    assert first_ids.isdisjoint({hit["conversation_id"] for hit in follow["results"]})


def test_a_deleted_session_stops_matching() -> None:
    _seed(_record("等待删除", [_node("user", "这段等待删除的内容也会被删掉")], conversation_id="doomed"))
    assert client.get("/api/conversations/search", params={"query": "等待删除"}).json()["total"] == 2
    assert client.delete("/api/conversations/doomed").status_code == 200
    assert client.get("/api/conversations/search", params={"query": "等待删除"}).json()["results"] == []


def test_a_message_written_after_a_search_is_searchable_without_a_rebuild() -> None:
    _seed(_record("增量更新", [_node("user", "第一个关键词是苹果")], conversation_id="incremental"))
    assert client.get("/api/conversations/search", params={"query": "苹果"}).json()["total"] == 1

    record = app_module.conversation_service.store.get_record("incremental")
    assert record is not None
    record.nodes.append(_node("assistant", "第二个关键词是橘子"))
    app_module.conversation_service.store.append(record)

    assert client.get("/api/conversations/search", params={"query": "橘子"}).json()["total"] == 1
    assert client.get("/api/conversations/search", params={"query": "苹果"}).json()["total"] == 1


def test_renaming_a_session_moves_into_the_new_title() -> None:
    _seed(_record("旧名字", [], conversation_id="renamed"))
    assert client.patch("/api/conversations/renamed", json={"title": "全新的名字"}).status_code == 200
    assert client.get("/api/conversations/search", params={"query": "旧名字"}).json()["results"] == []
    hits = client.get("/api/conversations/search", params={"query": "全新的名字"}).json()["results"]
    assert [hit["match_type"] for hit in hits] == ["title"]


def test_search_never_creates_or_changes_a_session() -> None:
    _seed(_record("只读检查", [_node("user", "请不要改动我")], conversation_id="readonly"))
    before = client.get("/api/conversations/readonly").json()
    listed = client.get("/api/conversations").json()
    for term in ("只读检查", "不要改动", "根本不存在的词"):
        assert client.get("/api/conversations/search", params={"query": term}).status_code == 200
    assert client.get("/api/conversations/readonly").json() == before
    assert client.get("/api/conversations").json() == listed


def test_markup_stored_in_a_message_travels_as_text_with_numeric_offsets() -> None:
    _seed(_record("危险内容", [_node("assistant", "<img src=x onerror=alert(1)> 关键词在这里")], conversation_id="xss"))
    hit = client.get("/api/conversations/search", params={"query": "关键词"}).json()["results"][0]
    assert "<mark" not in hit["snippet"]
    assert "<img" in hit["snippet"]
    start, length = hit["matches"][0]
    assert hit["snippet"][start : start + length] == "关键词"


def test_the_endpoint_validates_its_parameters() -> None:
    _seed(_record("参数校验", [], conversation_id="params"))
    assert client.get("/api/conversations/search").status_code == 422
    assert client.get("/api/conversations/search", params={"query": ""}).status_code == 422
    assert client.get("/api/conversations/search", params={"query": "参数", "limit": 0}).status_code == 422
    assert client.get("/api/conversations/search", params={"query": "参数", "limit": 500}).status_code == 422
    assert client.get("/api/conversations/search", params={"query": "参数", "cursor": "garbage"}).status_code == 400


def test_a_no_match_query_is_an_empty_page_not_an_error() -> None:
    _seed(_record("有内容的会话", [_node("user", "确实有内容")]))
    body = client.get("/api/conversations/search", params={"query": "根本不存在的词"}).json()
    assert body["results"] == []
    assert body["total"] == 0
    assert body["next_cursor"] is None
