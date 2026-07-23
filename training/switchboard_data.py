"""Dependency-free dataset preparation for Switchboard router models."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

TIERS = ("fast", "balanced", "deep", "max")
CAPABILITIES = ("web", "files", "vision", "longContext", "code")
ROUTE_POLICIES = {
    "fast": "Simple rewriting, extraction, formatting, casual questions, short summaries, and low-risk direct answers.",
    "balanced": "General explanation, moderate synthesis, standard coding, structured writing, and familiar multi-part tasks.",
    "deep": "Complex debugging, difficult comparisons, legal or technical analysis, subtle constraints, and architecture work.",
    "max": "Current deep research, exhaustive audits, primary-source verification, and exceptionally difficult high-stakes synthesis.",
}


@dataclass(frozen=True)
class DatasetSplit:
    train: list[dict[str, Any]]
    validation: list[dict[str, Any]]


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSON on line {line_number}: {error.msg}") from error
        if not isinstance(value, dict):
            raise ValueError(f"Line {line_number} must contain a JSON object.")
        records.append(value)
    return records


def write_jsonl(path: str | Path, records: Iterable[dict[str, Any]]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def _validate_source(record: dict[str, Any]) -> None:
    identifier = record.get("id")
    prompt = record.get("prompt")
    expected = record.get("expected")
    if not isinstance(identifier, str) or not identifier:
        raise ValueError("Every source record requires a non-empty id.")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError(f"{identifier}: prompt must be a non-empty string.")
    if not isinstance(expected, dict):
        raise ValueError(f"{identifier}: expected must be an object.")
    minimum = expected.get("minTier")
    maximum = expected.get("maxTier")
    if minimum not in TIERS or maximum not in TIERS:
        raise ValueError(f"{identifier}: expected tiers are invalid.")
    if TIERS.index(minimum) > TIERS.index(maximum):
        raise ValueError(f"{identifier}: minTier cannot be stronger than maxTier.")
    capabilities = expected.get("capabilities")
    if not isinstance(capabilities, list) or any(value not in CAPABILITIES for value in capabilities):
        raise ValueError(f"{identifier}: expected capabilities are invalid.")


def _render_text(record: dict[str, Any]) -> str:
    sections: list[str] = []
    context = record.get("context", [])
    if context:
        rendered_context = []
        for turn in context:
            if not isinstance(turn, dict) or turn.get("role") not in {"user", "assistant"} or not isinstance(turn.get("text"), str):
                raise ValueError(f"{record['id']}: context contains an invalid turn.")
            rendered_context.append(f"{turn['role']}: {turn['text'].strip()}")
        sections.append("Recent context:\n" + "\n".join(rendered_context))
    sections.append("Current request:\n" + record["prompt"].strip())
    files = record.get("files", [])
    if files:
        file_lines = []
        for item in files:
            if not isinstance(item, dict):
                raise ValueError(f"{record['id']}: files contains an invalid item.")
            name = str(item.get("name", "attachment"))
            detected = str(item.get("detectedType", "unknown"))
            excerpt = str(item.get("excerpt", ""))[:4000]
            file_lines.append(f"{name} [{detected}]\n{excerpt}".strip())
        sections.append("Attachments:\n" + "\n\n".join(file_lines))
    return "\n\n".join(sections)


def prepare_examples(records: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize benchmark records into conservative Scout training examples."""
    seen: set[str] = set()
    examples: list[dict[str, Any]] = []
    for record in records:
        _validate_source(record)
        identifier = record["id"]
        if identifier in seen:
            raise ValueError(f"Duplicate source id: {identifier}")
        seen.add(identifier)
        expected = record["expected"]
        examples.append({
            "id": identifier,
            "text": _render_text(record),
            "tier": expected["minTier"],
            "capabilities": sorted(set(expected["capabilities"]), key=CAPABILITIES.index),
            "tags": sorted(set(value for value in record.get("tags", []) if isinstance(value, str))),
        })
    return examples


def _bucket(identifier: str, seed: str) -> int:
    digest = hashlib.sha256(f"{seed}:{identifier}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def split_examples(
    examples: Sequence[dict[str, Any]],
    *,
    validation_fraction: float = 0.2,
    seed: str = "switchboard-v1",
) -> DatasetSplit:
    if not 0 < validation_fraction < 1:
        raise ValueError("validation_fraction must be between zero and one.")
    ordered = sorted(examples, key=lambda item: (_bucket(str(item["id"]), seed), str(item["id"])))
    validation_count = max(1, round(len(ordered) * validation_fraction)) if ordered else 0
    validation_ids = {item["id"] for item in ordered[:validation_count]}
    train = [dict(item) for item in examples if item["id"] not in validation_ids]
    validation = [dict(item) for item in examples if item["id"] in validation_ids]
    return DatasetSplit(train=train, validation=validation)


def build_arbiter_pairs(examples: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    pairs: list[dict[str, Any]] = []
    for example in examples:
        tier = example.get("tier")
        if tier not in TIERS:
            raise ValueError(f"{example.get('id', '<unknown>')}: invalid tier.")
        for route in TIERS:
            pairs.append({
                "id": f"{example['id']}::{route}",
                "sourceId": example["id"],
                "text": example["text"],
                "route": route,
                "routeDescription": ROUTE_POLICIES[route],
                "label": 1 if route == tier else 0,
            })
    return pairs
