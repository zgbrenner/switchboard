import tempfile
import unittest
from pathlib import Path

from training.model_pack import build_manifest


class ModelPackTests(unittest.TestCase):
    def test_manifest_hashes_assets_and_rejects_moving_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "onnx").mkdir()
            (root / "onnx" / "model.onnx").write_bytes(b"model")
            manifest = build_manifest(
                root,
                pack_id="switchboard-scout-test",
                stage="scout",
                source_repository="jhu-clsp/ettin-encoder-17m",
                source_revision="abcdef1",
                quantization="fp32",
            )
            self.assertEqual(manifest["assets"][0]["path"], "onnx/model.onnx")
            self.assertEqual(len(manifest["assets"][0]["sha256"]), 64)
            with self.assertRaisesRegex(ValueError, "immutable hexadecimal"):
                build_manifest(
                    root,
                    pack_id="switchboard-scout-test",
                    stage="scout",
                    source_repository="jhu-clsp/ettin-encoder-17m",
                    source_revision="main",
                    quantization="fp32",
                )


if __name__ == "__main__":
    unittest.main()
