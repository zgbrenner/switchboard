#!/usr/bin/env python3
"""Local Kompress-Small ONNX prompt-compression sidecar.

Protocol: one JSON request on stdin, one JSON response on stdout. The process
never performs network I/O. Release bundles include the pinned model and all
runtime libraries.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

MAX_REQUEST_BYTES = 16 * 1024 * 1024
MAX_CHUNKS = 4096
MAX_CHUNK_CHARACTERS = 64_000
MAX_WORDS_PER_WINDOW = 240
MIN_MODEL_WORDS = 12
MIN_KEEP_RATE = 0.25
MAX_KEEP_RATE = 0.98
MODEL_NAME = "chopratejas/kompress-small"
MODEL_RUNTIME_NAME = "kompress-small-onnx"

NEGATION_OR_REQUIREMENT = re.compile(
    r"^(?:no|not|never|none|without|unless|except|must|shall|should|may|cannot|can't|won't|isn't|aren't|required|required:)$",
    re.IGNORECASE,
)
URL_OR_EMAIL = re.compile(r"(?:https?://|www\.|\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b)", re.IGNORECASE)
DATE_OR_NUMBER = re.compile(r"\d")
IDENTIFIER = re.compile(r"(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z0-9]+_[A-Za-z0-9_]+|[A-Z][A-Z0-9_-]{2,})")
IMPORTANT_PUNCTUATION = re.compile(r"[:;!?]|(?:^|[^.])\.\.$")
WORD_PATTERN = re.compile(r"\S+")
CODE_LINE = re.compile(
    r"^\s*(?:[{}\[\]();]|(?:def|class|function|const|let|var|import|export|return|if|else|for|while|SELECT|INSERT|UPDATE|DELETE)\b)",
    re.MULTILINE,
)


class ProtocolError(ValueError):
    """Raised for bounded request-validation failures."""


@dataclass(frozen=True)
class Runtime:
    tokenizer: Any
    session: Any
    input_names: frozenset[str]


_RUNTIME_CACHE: dict[str, Runtime] = {}


def _json_error(message: str, *, code: str = "compression_failed") -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "message": message}}


def _read_request() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ProtocolError(f"Request exceeds the {MAX_REQUEST_BYTES}-byte limit.")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolError(f"Request is not valid UTF-8 JSON: {error}") from error
    if not isinstance(value, dict):
        raise ProtocolError("Request must be a JSON object.")
    return value


def _validated_request(value: dict[str, Any], cli_model: Path | None) -> tuple[Path, float, list[dict[str, Any]]]:
    if value.get("version") != 1:
        raise ProtocolError("Unsupported protocol version; expected 1.")
    raw_model = cli_model or value.get("modelDirectory")
    if not isinstance(raw_model, (str, os.PathLike)) or not str(raw_model):
        raise ProtocolError("modelDirectory is required.")
    model_directory = Path(raw_model).expanduser().resolve()
    threshold = value.get("threshold", 0.0)
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not -5.0 <= float(threshold) <= 5.0:
        raise ProtocolError("threshold must be a number between -5 and 5.")
    chunks = value.get("chunks")
    if not isinstance(chunks, list) or len(chunks) > MAX_CHUNKS:
        raise ProtocolError(f"chunks must be an array containing at most {MAX_CHUNKS} entries.")
    normalized: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict):
            raise ProtocolError(f"chunks[{index}] must be an object.")
        if set(chunk) - {"text", "protected"}:
            raise ProtocolError(f"chunks[{index}] contains unknown fields.")
        text = chunk.get("text")
        if not isinstance(text, str) or len(text) > MAX_CHUNK_CHARACTERS:
            raise ProtocolError(f"chunks[{index}].text must be a string of at most {MAX_CHUNK_CHARACTERS} characters.")
        protected = chunk.get("protected", False)
        if not isinstance(protected, bool):
            raise ProtocolError(f"chunks[{index}].protected must be a boolean.")
        normalized.append({"text": text, "protected": protected})
    return model_directory, float(threshold), normalized


def _model_files(model_directory: Path) -> tuple[Path, Path]:
    model_path = model_directory / "model.onnx"
    tokenizer_path = model_directory / "tokenizer.json"
    missing = [str(path.name) for path in (model_path, tokenizer_path) if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Model bundle is missing: {', '.join(missing)}.")
    return model_path, tokenizer_path


def _load_runtime(model_directory: Path) -> Runtime:
    cache_key = str(model_directory)
    cached = _RUNTIME_CACHE.get(cache_key)
    if cached is not None:
        return cached
    try:
        import onnxruntime as ort
        from tokenizers import Tokenizer
    except ImportError as error:
        raise RuntimeError("The sidecar runtime is missing onnxruntime or tokenizers.") from error

    model_path, tokenizer_path = _model_files(model_directory)
    session_options = ort.SessionOptions()
    session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session_options.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
    session_options.inter_op_num_threads = 1
    session = ort.InferenceSession(
        str(model_path),
        sess_options=session_options,
        providers=["CPUExecutionProvider"],
    )
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    runtime = Runtime(tokenizer=tokenizer, session=session, input_names=frozenset(item.name for item in session.get_inputs()))
    if not {"input_ids", "attention_mask"}.issubset(runtime.input_names):
        raise RuntimeError(f"Unexpected ONNX inputs: {sorted(runtime.input_names)}.")
    _RUNTIME_CACHE[cache_key] = runtime
    return runtime


def _letters(text: str) -> list[str]:
    return [character for character in text if character.isalpha()]


def _looks_english(text: str) -> bool:
    letters = _letters(text)
    if not letters:
        return False
    latin = sum(character.isascii() for character in letters)
    return latin / len(letters) >= 0.85


def _looks_structured(text: str) -> bool:
    stripped = text.lstrip()
    if stripped.startswith(("{", "[")):
        try:
            json.loads(text)
            return True
        except json.JSONDecodeError:
            pass
    lines = text.splitlines()
    if len(lines) >= 3:
        code_lines = sum(bool(CODE_LINE.search(line)) for line in lines)
        if code_lines / len(lines) >= 0.35:
            return True
    punctuation = sum(character in "{}[]();<>=" for character in text)
    return bool(text) and punctuation / len(text) >= 0.08


def _hard_keep_word(word: str, index: int, total: int) -> bool:
    stripped = word.strip("\"'`()[]{}<>")
    return (
        index == 0
        or index == total - 1
        or bool(NEGATION_OR_REQUIREMENT.match(stripped))
        or bool(URL_OR_EMAIL.search(word))
        or bool(DATE_OR_NUMBER.search(word))
        or bool(IDENTIFIER.search(stripped))
        or bool(IMPORTANT_PUNCTUATION.search(word))
        or (index > 0 and stripped[:1].isupper() and stripped[1:].islower())
    )


def _windowed(sequence: Sequence[str], size: int) -> Iterable[tuple[int, Sequence[str]]]:
    for start in range(0, len(sequence), size):
        yield start, sequence[start : start + size]


def _encode(runtime: Runtime, words: Sequence[str]) -> Any:
    return runtime.tokenizer.encode(list(words), is_pretokenized=True, add_special_tokens=True)


def _model_keep(runtime: Runtime, words: Sequence[str], threshold: float) -> list[bool]:
    import numpy as np

    encoding = _encode(runtime, words)
    if len(encoding.ids) > 512:
        if len(words) <= 1:
            return [True] * len(words)
        midpoint = len(words) // 2
        return _model_keep(runtime, words[:midpoint], threshold) + _model_keep(runtime, words[midpoint:], threshold)
    feeds: dict[str, Any] = {
        "input_ids": np.asarray([encoding.ids], dtype=np.int64),
        "attention_mask": np.asarray([encoding.attention_mask], dtype=np.int64),
    }
    if "token_type_ids" in runtime.input_names:
        feeds["token_type_ids"] = np.zeros_like(feeds["input_ids"], dtype=np.int64)
    logits = runtime.session.run(None, feeds)[0]
    if getattr(logits, "ndim", 0) != 3 or logits.shape[0] != 1 or logits.shape[2] < 2:
        raise RuntimeError(f"Unexpected ONNX output shape: {getattr(logits, 'shape', None)}.")
    word_ids = encoding.word_ids
    keep = [False] * len(words)
    represented: set[int] = set()
    for token_index, word_id in enumerate(word_ids):
        if word_id is None or word_id < 0 or word_id >= len(words):
            continue
        represented.add(word_id)
        margin = float(logits[0, token_index, 1] - logits[0, token_index, 0])
        if margin >= threshold:
            keep[word_id] = True
    for index in range(len(words)):
        if index not in represented or _hard_keep_word(words[index], index, len(words)):
            keep[index] = True
    return keep


def _gap_between(text: str, left: re.Match[str], right: re.Match[str]) -> str:
    gap = text[left.end() : right.start()]
    newline_count = gap.count("\n")
    if newline_count >= 2:
        return "\n\n"
    if newline_count == 1:
        return "\n"
    return " "


def _reconstruct(text: str, matches: Sequence[re.Match[str]], keep: Sequence[bool]) -> str:
    selected = [index for index, decision in enumerate(keep) if decision]
    if not selected:
        return text
    leading = text[: matches[0].start()]
    trailing = text[matches[-1].end() :]
    pieces = [leading, matches[selected[0]].group(0)]
    previous = selected[0]
    for index in selected[1:]:
        pieces.append(_gap_between(text, matches[previous], matches[index]))
        pieces.append(matches[index].group(0))
        previous = index
    pieces.append(trailing)
    return "".join(pieces)


def _compress_natural_language(runtime: Runtime, text: str, threshold: float) -> str:
    matches = list(WORD_PATTERN.finditer(text))
    if len(matches) < MIN_MODEL_WORDS:
        return text
    words = [match.group(0) for match in matches]
    keep = [_hard_keep_word(word, index, len(words)) for index, word in enumerate(words)]
    for start, window in _windowed(words, MAX_WORDS_PER_WINDOW):
        window_keep = _model_keep(runtime, window, threshold)
        for offset, decision in enumerate(window_keep):
            if decision:
                keep[start + offset] = True
    keep_rate = sum(keep) / len(keep)
    if keep_rate < MIN_KEEP_RATE or keep_rate > MAX_KEEP_RATE:
        return text
    compressed = _reconstruct(text, matches, keep)
    return compressed if compressed.strip() else text


def _compress_chunk(runtime: Runtime, text: str, protected: bool, threshold: float) -> tuple[str, str]:
    if protected:
        return text, "protected"
    if _looks_structured(text):
        return text, "structured"
    if not _looks_english(text):
        return text, "non_english"
    if len(text) < 80 or len(WORD_PATTERN.findall(text)) < MIN_MODEL_WORDS:
        return text, "short"
    return _compress_natural_language(runtime, text, threshold), "model"


def _compress(model_directory: Path, threshold: float, chunks: list[dict[str, Any]]) -> dict[str, Any]:
    runtime = _load_runtime(model_directory)
    output: list[str] = []
    routes: dict[str, int] = {}
    for chunk in chunks:
        compressed, route = _compress_chunk(runtime, chunk["text"], chunk["protected"], threshold)
        output.append(compressed)
        routes[route] = routes.get(route, 0) + 1
    return {
        "ok": True,
        "model": MODEL_RUNTIME_NAME,
        "modelSource": MODEL_NAME,
        "chunks": output,
        "transforms": ["model:kompress-small-onnx", "overlay:hard-keep-v1"],
        "warnings": [],
        "routing": routes,
    }


def _self_test(model_directory: Path) -> int:
    runtime = _load_runtime(model_directory)
    sample = (
        "In order to complete the authentication review, it is important to note that the service must never log passwords. "
        "The service should validate every session token and preserve the account identifier 42."
    )
    compressed, route = _compress_chunk(runtime, sample, False, 0.0)
    if route != "model" or not compressed.strip() or "never" not in compressed.lower() or "42" not in compressed:
        raise RuntimeError(f"Self-test produced an unsafe result: {compressed!r}")
    print(json.dumps({"ok": True, "model": MODEL_RUNTIME_NAME, "original": sample, "compressed": compressed}))
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, help="Directory containing model.onnx, model.onnx.data, and tokenizer.json.")
    parser.add_argument("--self-test", action="store_true", help="Load the model and run a bounded semantic smoke test.")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.self_test:
            if args.model is None:
                raise ProtocolError("--self-test requires --model.")
            return _self_test(args.model.expanduser().resolve())
        request = _read_request()
        model_directory, threshold, chunks = _validated_request(request, args.model)
        print(json.dumps(_compress(model_directory, threshold, chunks), ensure_ascii=False, separators=(",", ":")))
        return 0
    except ProtocolError as error:
        print(json.dumps(_json_error(str(error), code="invalid_request"), separators=(",", ":")))
        return 2
    except Exception as error:  # Deliberately turns runtime faults into a bounded protocol error.
        print(json.dumps(_json_error(str(error)), separators=(",", ":")))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
