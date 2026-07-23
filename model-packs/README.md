# Switchboard model packs

No model weights are committed in the initial extension.

A future pack must contain `manifest.json` plus every referenced asset. The manifest is validated by `src/models/manifest.ts` and requires:

- Schema version 1
- Stage: `scout`, `arbiter`, or `judge`
- Hugging Face source repository
- Immutable hexadecimal Git revision
- `transformers-js` runtime
- Quantization label
- Exact byte length and SHA-256 for every asset

Moving references such as `main`, `latest`, tags, or branch names are rejected.
