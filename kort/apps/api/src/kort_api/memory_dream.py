"""Dream-time consolidation for agent memory."""

from __future__ import annotations

import json
import logging
import re
import shutil
from datetime import datetime, timedelta, timezone

from .memory_utils import (
    AGENT_NAME_RE,
    DREAM_PREFIX,
    FACT_PREFIX,
    HUNCH_PREFIX,
    JSON_BLOCK_RE,
    MAX_DREAM_EPISODES,
    MAX_FACT_CHARS,
    MAX_HUNCHES,
    MAX_HUNCH_CHARS,
    MAX_PRIVATE_FACTS,
    MAX_SHARED_FACTS,
    MAX_SNAPSHOTS,
    _append_jsonl,
    _clamp,
    _clean_text,
    _evidence_ids,
    _fact_record,
    _iso_now,
    _jaccard,
    _looks_like_instruction,
    _new_id,
    _parse_ts,
    _read_jsonl,
    _recency,
    _rewrite_jsonl,
    _tags,
    _utc_now,
)
from .model_client import ModelCallError, OpenAICompatibleClient
from .prompting import clip_tokens
from .schemas import ProviderProfile

logger = logging.getLogger("kort_api.memory")


class MemoryDreamMixin:
    DREAM_SYSTEM_PROMPT = """你是圆桌代理的“睡眠期记忆巩固”模块，不与用户对话。
你的任务是把经历压缩成长期记忆：提炼事实、连接线索、修正过时认识、写下简短的自我叙事。
硬性规则：
- 只依据提供的经历和已有记忆，不编造用户信息。
- 每条新事实必须引用至少一个 E- 编号作为证据；没有证据的想法只能写成 hunch。
- 事实与猜测必须分开；不确定就降低 confidence，不要假装确定。
- 新旧信息矛盾时，用 facts_update 归档旧事实，并让新事实引用新证据。
- 宁少勿多：最多 4 条 facts_add、3 条 hunches_add、4 条 facts_update。
- 只输出严格 JSON，不要 markdown 代码块，不要额外解释。"""

    def should_dream(self, agent_name: str) -> bool:
        state = self._dream_state(agent_name)
        last_dream = _parse_ts(state.get("last_dream_at"))
        episodes = [
            item
            for item in self._episodes()
            if agent_name in (item.get("participants") or []) and item.get("status", "active") == "active"
        ]
        if not episodes:
            return False
        if last_dream is None:
            oldest = min((_parse_ts(item.get("created_at")) or _utc_now()) for item in episodes)
            pending = len(episodes)
            elapsed_ok = (_utc_now() - oldest) >= timedelta(hours=self.dream_min_hours)
        else:
            pending = sum(
                1
                for item in episodes
                if (_parse_ts(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)) > last_dream
            )
            elapsed_ok = (_utc_now() - last_dream) >= timedelta(hours=self.dream_min_hours)
        if pending >= self.dream_min_episodes:
            return True
        return pending >= 1 and elapsed_ok

    def dream(
        self,
        agent_name: str,
        provider: ProviderProfile,
        secrets: dict[str, str],
        *,
        apply: bool = False,
        max_episodes: int = MAX_DREAM_EPISODES,
    ) -> dict:
        episodes = [
            item
            for item in self._episodes()
            if agent_name in (item.get("participants") or []) and item.get("status", "active") == "active"
        ]
        if not episodes:
            raise ValueError("No episodes available for this agent")
        episodes.sort(key=lambda item: str(item.get("created_at", "")), reverse=True)
        selected = episodes[: max(1, max_episodes)]
        known_episode_ids = {str(item.get("id", "")) for item in selected}

        private = [item for item in self._private_facts(agent_name) if item.get("status", "active") == "active"]
        shared = [item for item in self._shared_facts() if item.get("status", "active") == "active"]
        hunches = [item for item in self._hunches(agent_name) if item.get("status", "active") == "active"]

        prompt = self._build_dream_prompt(
            agent_name=agent_name,
            episodes=selected,
            facts=shared + private,
            hunches=hunches,
        )
        client = OpenAICompatibleClient(secrets)
        raw = client.chat(
            provider=provider,
            prompt=prompt,
            system_prompt=self.DREAM_SYSTEM_PROMPT,
            disable_thinking=True,
        )
        payload = self._parse_dream_payload(raw)
        report = self.apply_dream(
            agent_name,
            payload,
            dry_run=not apply,
            known_episode_ids=known_episode_ids,
        )
        report["raw_excerpt"] = _clean_text(raw, 400)
        report["episode_ids"] = sorted(known_episode_ids)
        return report

    def _build_dream_prompt(
        self,
        *,
        agent_name: str,
        episodes: list[dict],
        facts: list[dict],
        hunches: list[dict],
    ) -> str:
        persona = ""
        persona_path = self.agents_root / agent_name / "persona.md"
        if persona_path.is_file():
            try:
                persona = clip_tokens(persona_path.read_text(encoding="utf-8"), 160)
            except OSError:
                persona = ""

        episode_lines = []
        for item in episodes:
            episode_lines.append(
                f"[{item.get('id')}] {str(item.get('created_at', ''))[:10]} "
                f"Q: {_clean_text(item.get('question'), 200)} | "
                f"A: {_clean_text(item.get('answer_gist'), 260)}"
            )
        fact_lines = [
            f"[{item.get('id')}] ({_clamp(item.get('confidence'), 0, 1, 0.6):.0%}) "
            f"{_clean_text(item.get('text'), 180)}"
            for item in facts[-90:]
        ]
        hunch_lines = [
            f"[{item.get('id')}] {_clean_text(item.get('text'), 140)}"
            for item in hunches[-40:]
        ]

        return (
            f"代理：{agent_name}\n"
            f"人格摘要：{persona or '（未设置）'}\n\n"
            f"当前自我叙事：\n{self.self_narrative(agent_name) or '（尚无）'}\n\n"
            f"待巩固的经历：\n" + ("\n".join(episode_lines) or "（无）") + "\n\n"
            f"已有事实（含共享与私有，仅供参考，不要重复添加）：\n"
            + ("\n".join(fact_lines) or "（无）") + "\n\n"
            f"已有直觉：\n" + ("\n".join(hunch_lines) or "（无）") + "\n\n"
            "输出 JSON，结构如下：\n"
            "{\n"
            '  "journal": "两三句话，记录这次巩固的主要发现与自我变化",\n'
            '  "facts_add": [{"text": "...", "tags": ["..."], "confidence": 0.7, "importance": 0.6, "evidence": ["E-xxxxxxxx"]}],\n'
            '  "facts_update": [{"id": "F-xxxxxxxx", "confidence": 0.5, "importance": 0.4, "status": "active|archived", "reason": "..."}],\n'
            '  "hunches_add": [{"text": "...", "confidence": 0.4, "basis": ["E-xxxxxxxx"]}],\n'
            '  "forget": [{"id": "E-xxxxxxxx", "reason": "..."}],\n'
            '  "self": {"identity": "...", "current_obsessions": ["..."], "open_questions": ["..."], "voice_notes": "..."}\n'
            "}"
        )

    @staticmethod
    def _parse_dream_payload(raw: str) -> dict:
        text = raw.strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        match = JSON_BLOCK_RE.search(text)
        if not match:
            raise ModelCallError("Dream response did not contain a JSON object.")
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            raise ModelCallError(f"Dream response was not valid JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise ModelCallError("Dream response must be a JSON object.")
        return payload

    def apply_dream(
        self,
        agent_name: str,
        payload: dict,
        *,
        dry_run: bool = False,
        known_episode_ids: set[str] | None = None,
    ) -> dict:
        """Validate and (unless dry_run) persist one dream. Returns an audit report."""
        with self._lock:
            agent_dir = self._agent_dir(agent_name)
            episodes = self._episodes()
            allowed_episode_ids = set(known_episode_ids or {str(item.get("id", "")) for item in episodes})
            shared = self._shared_facts()
            private = self._private_facts(agent_name)
            hunches = self._hunches(agent_name)
            private_path = agent_dir / "facts.jsonl"
            shared_path = self.shared_dir / "facts.jsonl"
            hunches_path = agent_dir / "hunches.jsonl"

            stats = {
                "facts_added": 0,
                "facts_updated": 0,
                "facts_archived": 0,
                "hunches_added": 0,
                "episodes_archived": 0,
                "shared_promotions": 0,
                "rejected": 0,
            }
            added_facts: list[str] = []
            added_hunches: list[str] = []
            promoted_ids: list[str] = []
            rejected: list[str] = []

            if not dry_run:
                self._snapshot(agent_name)

            def _known_fact(text: str, pool: list[dict]) -> dict | None:
                for item in pool:
                    if item.get("status", "active") != "active":
                        continue
                    if _jaccard(str(item.get("text", "")), text) >= 0.82:
                        return item
                return None

            # --- new facts ---
            raw_facts = payload.get("facts_add")
            for raw in raw_facts if isinstance(raw_facts, list) else []:
                if not isinstance(raw, dict):
                    stats["rejected"] += 1
                    continue
                text = _clean_text(raw.get("text"), MAX_FACT_CHARS)
                evidence = _evidence_ids(raw.get("evidence"), allowed_episode_ids)
                if len(text) < 4 or _looks_like_instruction(text):
                    stats["rejected"] += 1
                    rejected.append(text[:80] or "empty")
                    continue
                confidence = _clamp(raw.get("confidence"), 0.0, 0.85, 0.6)
                importance = _clamp(raw.get("importance"), 0.0, 1.0, 0.55)
                if not evidence:
                    # An unevidenced claim is a hunch, not a fact.
                    confidence = min(confidence, 0.4)
                    target = _known_fact(text, hunches)
                    if target is not None:
                        target["confidence"] = max(
                            _clamp(target.get("confidence"), 0.0, 1.0, 0.3), confidence
                        )
                        target["updated_at"] = _iso_now()
                    else:
                        hunch = {
                            "id": _new_id(HUNCH_PREFIX),
                            "kind": "hunch",
                            "text": text[:MAX_HUNCH_CHARS],
                            "confidence": confidence,
                            "basis": [],
                            "tags": _tags(raw.get("tags"), 4),
                            "created_at": _iso_now(),
                            "updated_at": _iso_now(),
                            "status": "active",
                        }
                        hunches.append(hunch)
                        added_hunches.append(hunch["id"])
                        stats["hunches_added"] += 1
                    continue

                existing = _known_fact(text, private)
                if existing is not None:
                    existing["evidence"] = list(
                        dict.fromkeys(list(existing.get("evidence") or []) + evidence)
                    )
                    existing["confidence"] = max(
                        _clamp(existing.get("confidence"), 0.0, 1.0, 0.5), confidence
                    )
                    existing["importance"] = max(
                        _clamp(existing.get("importance"), 0.0, 1.0, 0.5), importance
                    )
                    existing["updated_at"] = _iso_now()
                    if existing.get("status") == "archived":
                        existing["status"] = "active"
                        existing.pop("archived_at", None)
                    stats["facts_updated"] += 1
                    continue
                if _known_fact(text, shared) is not None:
                    # Shared memory is user-level; an agent dream may not rewrite it.
                    continue

                record = _fact_record(
                    text,
                    scope="private",
                    tags=_tags(raw.get("tags")),
                    confidence=confidence,
                    importance=importance,
                    pinned=False,
                    source="dream",
                    evidence=evidence,
                )
                private.append(record)
                added_facts.append(record["id"])
                stats["facts_added"] += 1

                # Independent consolidation: two agents remembering the same thing
                # promotes it to shared user memory, mirroring systems consolidation.
                other = self._consensus_match(agent_name, text)
                if other is not None and _known_fact(text, shared) is None:
                    promoted = _fact_record(
                        text,
                        scope="shared",
                        tags=_tags(raw.get("tags")),
                        confidence=min(0.9, max(confidence, _clamp(other.get("confidence"), 0, 1, 0.6)) + 0.05),
                        importance=max(importance, _clamp(other.get("importance"), 0, 1, 0.5)),
                        pinned=False,
                        source=f"consensus:{agent_name}+{other.get('_agent', 'unknown')}",
                        evidence=evidence,
                    )
                    shared.append(promoted)
                    promoted_ids.append(promoted["id"])
                    stats["shared_promotions"] += 1

            # --- updates / contradictions (private facts only) ---
            raw_updates = payload.get("facts_update")
            by_id = {str(item.get("id", "")): item for item in private}
            for raw in raw_updates if isinstance(raw_updates, list) else []:
                if not isinstance(raw, dict):
                    stats["rejected"] += 1
                    continue
                target = by_id.get(str(raw.get("id", "")))
                if target is None:
                    stats["rejected"] += 1
                    continue
                if target.get("pinned"):
                    stats["rejected"] += 1
                    rejected.append("pinned fact cannot be rewritten")
                    continue
                status = str(raw.get("status") or "").strip()
                if status == "archived":
                    target["status"] = "archived"
                    target["archived_at"] = _iso_now()
                    target["updated_at"] = _iso_now()
                    reason = _clean_text(raw.get("reason"), 160)
                    if reason:
                        target["archive_reason"] = reason
                    stats["facts_archived"] += 1
                else:
                    new_text = _clean_text(raw.get("text"), MAX_FACT_CHARS)
                    if new_text and not _looks_like_instruction(new_text):
                        target["text"] = new_text
                    if raw.get("confidence") is not None:
                        target["confidence"] = _clamp(
                            raw.get("confidence"), 0.0, 1.0, _clamp(target.get("confidence"), 0, 1, 0.6)
                        )
                    if raw.get("importance") is not None:
                        target["importance"] = _clamp(
                            raw.get("importance"), 0.0, 1.0, _clamp(target.get("importance"), 0, 1, 0.5)
                        )
                    target["updated_at"] = _iso_now()
                    stats["facts_updated"] += 1

            # --- hunches ---
            raw_hunches = payload.get("hunches_add")
            for raw in raw_hunches if isinstance(raw_hunches, list) else []:
                if not isinstance(raw, dict):
                    stats["rejected"] += 1
                    continue
                text = _clean_text(raw.get("text"), MAX_HUNCH_CHARS)
                if len(text) < 4 or _looks_like_instruction(text):
                    stats["rejected"] += 1
                    continue
                basis = _evidence_ids(raw.get("basis"), allowed_episode_ids)
                if _known_fact(text, hunches) is not None:
                    continue
                hunch = {
                    "id": _new_id(HUNCH_PREFIX),
                    "kind": "hunch",
                    "text": text,
                    "confidence": min(0.6, _clamp(raw.get("confidence"), 0.0, 1.0, 0.4)),
                    "basis": basis,
                    "tags": [],
                    "created_at": _iso_now(),
                    "updated_at": _iso_now(),
                    "status": "active",
                }
                hunches.append(hunch)
                added_hunches.append(hunch["id"])
                stats["hunches_added"] += 1

            # --- forget: soft archive only ---
            forgot: set[str] = set()
            raw_forget = payload.get("forget")
            for raw in raw_forget if isinstance(raw_forget, list) else []:
                episode_id = str(raw.get("id") if isinstance(raw, dict) else raw).strip()
                if episode_id in allowed_episode_ids and episode_id not in forgot:
                    forgot.add(episode_id)
            if forgot:
                for item in episodes:
                    if str(item.get("id")) in forgot and agent_name in (item.get("participants") or []):
                        item["status"] = "archived"
                        item["archived_at"] = _iso_now()
                        stats["episodes_archived"] += 1

            journal = _clean_text(payload.get("journal"), 600)
            self_payload = payload.get("self") if isinstance(payload.get("self"), dict) else {}
            self_text = self._render_self(agent_name, self_payload)

            # Bound growth. Pinned facts are never auto-archived, and shared
            # memory is only maintained through explicit user actions.
            private, private_archived = self._trim(private, MAX_PRIVATE_FACTS)
            hunches, hunches_archived = self._trim(hunches, MAX_HUNCHES)
            stats["facts_archived"] += private_archived
            stats["hunches_archived"] = hunches_archived

            if not dry_run:
                _rewrite_jsonl(private_path, private)
                _rewrite_jsonl(shared_path, shared)
                _rewrite_jsonl(hunches_path, hunches)
                _rewrite_jsonl(self.shared_dir / "episodes.jsonl", episodes)
                if self_text:
                    (agent_dir / "self.md").write_text(self_text, encoding="utf-8")
                journal_record = {
                    "id": _new_id(DREAM_PREFIX),
                    "agent": agent_name,
                    "created_at": _iso_now(),
                    "journal": journal,
                    "stats": stats,
                    "facts_added": added_facts,
                    "hunches_added": added_hunches,
                    "shared_promotions": promoted_ids,
                    "episode_ids": sorted(known_episode_ids or []),
                }
                _append_jsonl(agent_dir / "dreams.jsonl", journal_record)
                state = self._dream_state(agent_name)
                state.update(
                    {
                        "last_dream_at": _iso_now(),
                        "last_journal_id": journal_record["id"],
                        "last_stats": stats,
                    }
                )
                (agent_dir / "dream_state.json").write_text(
                    json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
                )

        return {
            "agent": agent_name,
            "applied": not dry_run,
            "journal": journal,
            "stats": stats,
            "added_facts": added_facts,
            "added_hunches": added_hunches,
            "shared_promotions": promoted_ids,
            "rejected": rejected,
            "self_narrative": self_text,
            "proposal": payload if dry_run else None,
        }

    def _consensus_match(self, agent_name: str, text: str) -> dict | None:
        if not self.memory_root.is_dir():
            return None
        for directory in self.memory_root.iterdir():
            if not directory.is_dir() or directory.name in {agent_name, "_shared", "snapshots"}:
                continue
            if not AGENT_NAME_RE.fullmatch(directory.name):
                continue
            for item in _read_jsonl(directory / "facts.jsonl"):
                if item.get("status", "active") != "active":
                    continue
                if _jaccard(str(item.get("text", "")), text) >= 0.82:
                    matched = dict(item)
                    matched["_agent"] = directory.name
                    return matched
        return None

    def _render_self(self, agent_name: str, payload: dict) -> str:
        identity = _clean_text(payload.get("identity"), 400)
        obsessions = _tags(payload.get("current_obsessions"), 5)
        questions = _tags(payload.get("open_questions"), 5)
        voice = _clean_text(payload.get("voice_notes"), 240)
        if not any((identity, obsessions, questions, voice)):
            return ""
        lines = [
            "---",
            f"agent: {agent_name}",
            f"updated_at: {_iso_now()}",
            "---",
            "",
            "## 我是谁",
            identity or "（保持原有身份，等待更多经历。）",
        ]
        if obsessions:
            lines += ["", "## 最近在意的事"] + [f"- {item}" for item in obsessions]
        if questions:
            lines += ["", "## 还没想通的问题"] + [f"- {item}" for item in questions]
        if voice:
            lines += ["", "## 表达上的变化", voice]
        return "\n".join(lines).strip() + "\n"

    def _snapshot(self, agent_name: str) -> None:
        stamp = _utc_now().strftime("%Y%m%dT%H%M%S%f")
        target = self.snapshots_root / agent_name / stamp
        try:
            target.mkdir(parents=True, exist_ok=False)
            source = self.memory_root / agent_name
            if source.is_dir():
                shutil.copytree(source, target / "agent", dirs_exist_ok=True)
            if self.shared_dir.is_dir():
                shutil.copytree(self.shared_dir, target / "_shared", dirs_exist_ok=True)
        except OSError as exc:
            logger.warning("memory_store.snapshot_failed agent=%s error=%s", agent_name, exc)
            return
        snapshots = sorted(
            (item for item in (self.snapshots_root / agent_name).iterdir() if item.is_dir()),
            key=lambda item: item.name,
        )
        for old in snapshots[:-MAX_SNAPSHOTS]:
            shutil.rmtree(old, ignore_errors=True)
