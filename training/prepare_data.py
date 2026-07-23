#!/usr/bin/env python3
"""Prepare deterministic Scout and Arbiter datasets from Switchboard JSONL cases."""

from __future__ import annotations

import argparse
from pathlib import Path

from training.switchboard_data import build_arbiter_pairs, prepare_examples, read_jsonl, split_examples, write_jsonl


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="benchmarks/router-cases.jsonl")
    parser.add_argument("--output", default="training/generated")
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--seed", default="switchboard-v1")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    examples = prepare_examples(read_jsonl(args.source))
    split = split_examples(examples, validation_fraction=args.validation_fraction, seed=args.seed)
    output = Path(args.output)
    write_jsonl(output / "scout-train.jsonl", split.train)
    write_jsonl(output / "scout-validation.jsonl", split.validation)
    write_jsonl(output / "arbiter-train.jsonl", build_arbiter_pairs(split.train))
    write_jsonl(output / "arbiter-validation.jsonl", build_arbiter_pairs(split.validation))
    print(f"Prepared {len(split.train)} train and {len(split.validation)} validation Scout examples.")
    print(f"Wrote datasets to {output.resolve()}.")


if __name__ == "__main__":
    main()
