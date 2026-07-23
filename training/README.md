# Switchboard model training

This directory contains a reproducible starting toolchain for the local Scout and Arbiter models. The 32-case browser-router benchmark is a smoke-test seed, not enough data for a production checkpoint.

## 1. Prepare seed data

```bash
python -m training.prepare_data
```

The command produces deterministic Scout examples and four route-policy pairs per example in `training/generated/`, which is intentionally ignored by Git.

## 2. Expand and review the dataset

Before training a release candidate, add properly licensed or authored examples covering:

- Simple transformations and low-risk requests
- Difficult coding, legal, security, financial, and technical analysis
- Current research and primary-source verification
- Attachments, scanned documents, images, and long context
- Vague follow-ups and conflicting signals
- Multilingual and adversarial prompts
- Boundary cases between every adjacent tier

Keep a human-reviewed test set completely separate from teacher-generated labels.

## 3. Install training dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r training/requirements.txt
```

## 4. Pin immutable model revisions

Resolve the exact Hugging Face commit for each base model. Never train or package from `main` or a moving tag.

## 5. Train Scout

```bash
python -m training.train_scout \
  --revision <ETTIN_ENCODER_COMMIT> \
  --train training/generated/scout-train.jsonl \
  --validation training/generated/scout-validation.jsonl
```

Scout is a standard nine-label classifier. Four labels represent mutually exclusive tiers and five represent capabilities. The browser runtime can interpret the first four logits with an argmax and the remaining logits with calibrated thresholds.

## 6. Train Arbiter

```bash
python -m training.train_arbiter \
  --revision <ETTIN_RERANKER_COMMIT> \
  --train training/generated/arbiter-train.jsonl \
  --validation training/generated/arbiter-validation.jsonl
```

Arbiter is a binary cross-encoder that scores a request against each abstract route-policy description.

## 7. Export a verified pack

```bash
python -m training.export_pack \
  --model-dir training/output/scout \
  --output model-packs/generated/scout \
  --pack-id switchboard-scout-v1-fp32 \
  --stage scout \
  --source-repository jhu-clsp/ettin-encoder-17m \
  --source-revision <ETTIN_ENCODER_COMMIT>
```

The exporter runs Optimum ONNX export and writes a manifest containing the immutable source revision, exact byte size, and SHA-256 digest of every asset. Quantization should be performed and benchmarked before changing the pack's quantization label.

## Release gate

Do not enable a neural pack until it beats the deterministic baseline on a larger locked test set, reports harmful under-routing separately, has acceptable calibration, and passes both WebGPU and WASM memory and latency tests.
