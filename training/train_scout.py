#!/usr/bin/env python3
"""Fine-tune a compact multi-label Scout router."""

from __future__ import annotations

import argparse
import inspect
import json
from pathlib import Path

LABELS = [
    "tier:fast", "tier:balanced", "tier:deep", "tier:max",
    "capability:web", "capability:files", "capability:vision", "capability:longContext", "capability:code",
]
TIERS = ("fast", "balanced", "deep", "max")
CAPABILITIES = ("web", "files", "vision", "longContext", "code")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="jhu-clsp/ettin-encoder-17m")
    parser.add_argument("--revision", required=True, help="Immutable Hugging Face Git revision.")
    parser.add_argument("--train", default="training/generated/scout-train.jsonl")
    parser.add_argument("--validation", default="training/generated/scout-validation.jsonl")
    parser.add_argument("--output", default="training/output/scout")
    parser.add_argument("--max-length", type=int, default=768)
    parser.add_argument("--epochs", type=float, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    return parser.parse_args()


def read_records(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def label_vector(record: dict) -> list[float]:
    vector = [0.0] * len(LABELS)
    vector[TIERS.index(record["tier"])] = 1.0
    for capability in record.get("capabilities", []):
        vector[4 + CAPABILITIES.index(capability)] = 1.0
    return vector


def main() -> None:
    args = parse_args()
    import numpy as np
    from datasets import Dataset
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, DataCollatorWithPadding, Trainer, TrainingArguments

    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=args.revision, trust_remote_code=False)
    id2label = {index: label for index, label in enumerate(LABELS)}
    label2id = {label: index for index, label in id2label.items()}
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model,
        revision=args.revision,
        trust_remote_code=False,
        num_labels=len(LABELS),
        id2label=id2label,
        label2id=label2id,
        problem_type="multi_label_classification",
    )

    def make_dataset(path: str) -> Dataset:
        rows = [{"text": row["text"], "labels": label_vector(row)} for row in read_records(path)]
        dataset = Dataset.from_list(rows)
        return dataset.map(
            lambda batch: tokenizer(batch["text"], truncation=True, max_length=args.max_length),
            batched=True,
            remove_columns=["text"],
        )

    train_dataset = make_dataset(args.train)
    validation_dataset = make_dataset(args.validation)

    def metrics(prediction) -> dict[str, float]:
        logits, labels = prediction
        tier_accuracy = float((np.argmax(logits[:, :4], axis=1) == np.argmax(labels[:, :4], axis=1)).mean())
        capability_predictions = logits[:, 4:] > 0
        capability_truth = labels[:, 4:] > 0.5
        capability_exact = float((capability_predictions == capability_truth).all(axis=1).mean())
        return {"tier_accuracy": tier_accuracy, "capability_exact_match": capability_exact}

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
        metric_for_best_model="tier_accuracy",
        greater_is_better=True,
        report_to=[],
        seed=17,
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
    print(f"Saved Scout checkpoint to {Path(args.output).resolve()}")


if __name__ == "__main__":
    main()
