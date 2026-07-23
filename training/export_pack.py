#!/usr/bin/env python3
"""Export a trained classifier to ONNX and create a verified Switchboard model pack."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

from training.model_pack import build_manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--pack-id", required=True)
    parser.add_argument("--stage", required=True, choices=["scout", "arbiter", "judge"])
    parser.add_argument("--source-repository", required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--quantization", default="fp32")
    parser.add_argument("--existing-onnx", action="store_true", help="Package an already-exported directory without running Optimum.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model_dir = Path(args.model_dir).resolve()
    output = Path(args.output).resolve()
    if model_dir == output or model_dir in output.parents or output in model_dir.parents:
        raise SystemExit("--model-dir and --output must be separate, non-nested directories.")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    if args.existing_onnx:
        shutil.copytree(model_dir, output, dirs_exist_ok=True)
    else:
        executable = shutil.which("optimum-cli")
        if not executable:
            raise SystemExit("optimum-cli is required. Install training/requirements.txt or pass --existing-onnx.")
        command = [executable, "export", "onnx", "--model", str(model_dir), "--task", "text-classification", str(output / "onnx")]
        subprocess.run(command, check=True)

    manifest = build_manifest(
        output,
        pack_id=args.pack_id,
        stage=args.stage,
        source_repository=args.source_repository,
        source_revision=args.source_revision,
        quantization=args.quantization,
    )
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Created {args.stage} model pack with {len(manifest['assets'])} verified assets at {output}")


if __name__ == "__main__":
    main()
