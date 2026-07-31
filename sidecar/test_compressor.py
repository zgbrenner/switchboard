from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

import compressor


class FakeEncoding:
    def __init__(self, word_count: int, token_count: int | None = None) -> None:
        if token_count is None:
            self.ids = [101, *range(1, word_count + 1), 102]
            self.word_ids = [None, *range(word_count), None]
        else:
            self.ids = list(range(token_count))
            self.word_ids = [None] * token_count
        self.attention_mask = [1] * len(self.ids)


class FakeTokenizer:
    def __init__(self) -> None:
        self.calls: list[int] = []

    def encode(self, words, *, is_pretokenized: bool, add_special_tokens: bool):
        self.calls.append(len(words))
        if len(words) > 2:
            return FakeEncoding(len(words), token_count=600)
        return FakeEncoding(len(words))


class FakeSession:
    def run(self, _outputs, feeds):
        token_count = feeds['input_ids'].shape[1]
        logits = np.zeros((1, token_count, 2), dtype=np.float32)
        logits[:, :, 0] = 1.0
        return [logits]


class CompressorTests(unittest.TestCase):
    def test_request_validation_is_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model, threshold, chunks = compressor._validated_request(
                {
                    'version': 1,
                    'modelDirectory': directory,
                    'threshold': 0.25,
                    'chunks': [{'text': 'hello', 'protected': True}],
                },
                None,
            )
        self.assertEqual(model, Path(directory).resolve())
        self.assertEqual(threshold, 0.25)
        self.assertEqual(chunks, [{'text': 'hello', 'protected': True}])

        with self.assertRaisesRegex(compressor.ProtocolError, 'unknown fields'):
            compressor._validated_request(
                {
                    'version': 1,
                    'modelDirectory': '.',
                    'chunks': [{'text': 'hello', 'protected': False, 'extra': True}],
                },
                None,
            )

    def test_hard_keep_preserves_safety_and_identifiers(self) -> None:
        words = ['drop', 'never', 'accountId', '42', 'https://example.com', 'end']
        decisions = [compressor._hard_keep_word(word, index, len(words)) for index, word in enumerate(words)]
        self.assertEqual(decisions, [True, True, True, True, True, True])

    def test_long_token_windows_split_recursively(self) -> None:
        tokenizer = FakeTokenizer()
        runtime = compressor.Runtime(tokenizer=tokenizer, session=FakeSession(), input_names=frozenset({'input_ids', 'attention_mask'}))
        words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']
        keep = compressor._model_keep(runtime, words, 0.0)
        self.assertEqual(len(keep), len(words))
        self.assertTrue(all(keep))
        self.assertGreater(len(tokenizer.calls), 1)
        self.assertIn(8, tokenizer.calls)
        self.assertTrue(all(size <= 2 or size == 8 or size == 4 for size in tokenizer.calls))

    def test_non_natural_language_routes_bypass_the_model(self) -> None:
        runtime = SimpleNamespace()
        self.assertEqual(compressor._compress_chunk(runtime, 'protected content', True, 0.0), ('protected content', 'protected'))
        structured = json.dumps({'enabled': True, 'count': 42})
        self.assertEqual(compressor._compress_chunk(runtime, structured, False, 0.0), (structured, 'structured'))
        non_english = '这是一个用于测试本地压缩旁路行为的中文句子。'
        self.assertEqual(compressor._compress_chunk(runtime, non_english, False, 0.0), (non_english, 'non_english'))

    def test_reconstruction_preserves_significant_newlines(self) -> None:
        text = 'Alpha unnecessary words.\n\nNever remove 42.'
        matches = list(compressor.WORD_PATTERN.finditer(text))
        keep = [True, False, False, True, True, True]
        self.assertEqual(compressor._reconstruct(text, matches, keep), 'Alpha\n\nNever remove 42.')


if __name__ == '__main__':
    unittest.main()
