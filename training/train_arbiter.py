#!/usr/bin/env python3
"""Fine-tune the route-policy cross-encoder Arbiter."""

from __future__ import annotations

import argparse
import inspect
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="cross-encoder/ettin-reranker-17m-v1")
    parser.add_argument("--revision", required=True, help="Immutable Hugging Face Git revision.")
    parser.add_argument("--train", default="training/generated/arbiter-train.jsonl")
    parser.add_argument("--validation", default="training/generated/arbiter-validation.jsonl")
    parser.add_argument("--output", default="training/output/arbiter")
    parser.add_argument("--max-length", type=int, default=768)
    parser.add_argument("--epochs", type=float, default=5)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    return parser.parse_args()


def read_records(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    args = parse_args()
    import numpy as np
    from datasets import Dataset
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, DataCollatorWithPadding, Trainer, TrainingArguments

    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=args.revision, trust_remote_code=False)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model,
        revision=args.revision,
        trust_remote_code=False,
        num_labels=2,
        id2label={0: "unsuitable", 1: "suitable"},
        label2id={"unsuitable": 0, "suitable": 1},
        ignore_mismatched_sizes=True,
    )

    def make_dataset(path: str) -> Dataset:
        rows = read_records(path)
        dataset = Dataset.from_list(rows)
        return dataset.map(
            lambda batch: tokenizer(
                batch["text"],
                batch["routeDescription"],
                truncation=True,
                max_length=args.max_length,
            ),
            batched=True,
            remove_columns=[column for column in dataset.column_names if column != "label"],
        ).rename_column("label", "labels")

    train_dataset = make_dataset(args.train)
    validation_dataset = make_dataset(args.validation)

    def metrics(prediction) -> dict[str, float]:
        logits, labels = prediction
        predicted = np.argmax(logits, axis=1)
        return {"accuracy": float((predicted == labels).mean())}

    kwargs = dict(
        output_dir=args.output,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        num_train_epochs=args.epochs,
        weight_decay=0.01,
        warmup_ratio=0.1,
        save_strategy="epoch",
        logging_steps=10,
        load_best_model_at_end=True,
        metric_for_best_model="accuracy",
        greater_is_better=True,
        report_to=[],
        seed=23,
    )
    parameters = inspect.signature(TrainingArguments.__init__).parameters
    kwargs["eval_strategy" if "eval_strategy" in parameters else "evaluation_strategy"] = "epoch"
    trainer = Trainer(
        model=model,
        args=TrainingArguments(**kwargs),
        train_dataset=train_dataset,
        eval_dataset=validation_dataset,
        data_collator=DataCollatorWithPadding(tokenizer=tokenizer),
        processing_class=tokenizer,
        compute_metrics=metrics,
    )
    trainer.train()
    trainer.save_model(args.output)
    tokenizer.save_pretrained(args.output)
    print(f"Saved Arbiter checkpoint to {Path(args.output).resolve()}")


if __name__ == "__main__":
    main()
