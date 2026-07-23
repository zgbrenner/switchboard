"""Build reproducible Switchboard model-pack manifests."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

REVISION = re.compile(r"^[0-9a-f]{7,40}$", re.IGNORECASE)
PACK_ID = re.compile(r"^[a-z0-9][a-z0-9._-]+$", re.IGNORECASE)
STAGES = {"scout", "arbiter", "judge"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(
    root: str | Path,
    *,
    pack_id: str,
    stage: str,
    source_repository: str,
    source_revision: str,
    quantization: str,
) -> dict[str, Any]:
    directory = Path(root).resolve()
    if not directory.is_dir():
        raise ValueError(f"Model-pack directory does not exist: {directory}")
    if not PACK_ID.fullmatch(pack_id):
        raise ValueError("pack_id is invalid.")
    if stage not in STAGES:
        raise ValueError("stage must be scout, arbiter, or judge.")
    if "/" not in source_repository:
        raise ValueError("source_repository must use owner/name form.")
    if not REVISION.fullmatch(source_revision):
        raise ValueError("source_revision must be an immutable hexadecimal Git commit.")
    if not quantization.strip():
        raise ValueError("quantization is required.")

    assets: list[dict[str, Any]] = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file() or path.name == "manifest.json":
            continue
        relative = path.relative_to(directory).as_posix()
        if relative.startswith("/") or ".." in Path(relative).parts:
            raise ValueError(f"Unsafe model-pack path: {relative}")
        assets.append({"path": relative, "sha256": sha256_file(path), "bytes": path.stat().st_size})
    if not assets:
        raise ValueError("Model pack has no assets.")

    return {
        "schemaVersion": 1,
        "id": pack_id,
        "stage": stage,
        "sourceRepository": source_repository,
        "sourceRevision": source_revision.lower(),
        "runtime": "transformers-js",
        "quantization": quantization,
        "assets": assets,
    }
