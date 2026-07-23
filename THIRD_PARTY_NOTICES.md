# Third-party notices

Switchboard can package the following local models during development:

- `onnx-community/all-MiniLM-L6-v2-ONNX`, based on `sentence-transformers/all-MiniLM-L6-v2`, Apache-2.0
- `Xenova/ms-marco-MiniLM-L-6-v2`, based on `cross-encoder/ms-marco-MiniLM-L-6-v2`, Apache-2.0
- `onnx-community/SmolLM2-135M-Instruct-ONNX`, based on Hugging Face SmolLM2, Apache-2.0

Switchboard also bundles `@huggingface/transformers` and ONNX Runtime Web through that package. Their notices and licenses remain available in the installed npm dependency tree and should be included in any packaged distribution.

Model files are not committed to this repository. `scripts/fetch-models.mjs` downloads them from immutable revisions and creates a manifest containing the source repository, source revision, byte length, and SHA-256 digest of each asset.
