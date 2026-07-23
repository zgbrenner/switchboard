import unittest

from training.switchboard_data import build_arbiter_pairs, prepare_examples, split_examples


class DataPreparationTests(unittest.TestCase):
    def test_prepares_conservative_target_and_context(self):
        source = {
            "id": "legal-follow-up",
            "prompt": "Do it again.",
            "context": [{"role": "user", "text": "Audit the contract."}],
            "tags": ["legal"],
            "expected": {"minTier": "deep", "maxTier": "max", "capabilities": ["files"]},
        }
        example = prepare_examples([source])[0]
        self.assertEqual(example["tier"], "deep")
        self.assertIn("Audit the contract", example["text"])
        self.assertEqual(example["capabilities"], ["files"])

    def test_split_is_stable_and_keeps_all_ids(self):
        examples = [{"id": f"case-{index}", "text": "x", "tier": "fast", "capabilities": [], "tags": []} for index in range(20)]
        first = split_examples(examples, validation_fraction=0.2, seed="switchboard")
        second = split_examples(examples, validation_fraction=0.2, seed="switchboard")
        self.assertEqual(first, second)
        self.assertEqual({item["id"] for item in first.train + first.validation}, {item["id"] for item in examples})
        self.assertGreater(len(first.validation), 0)

    def test_arbiter_pairs_include_one_positive_and_three_negatives(self):
        examples = [{"id": "x", "text": "Audit this", "tier": "deep", "capabilities": ["code"], "tags": ["security"]}]
        pairs = build_arbiter_pairs(examples)
        self.assertEqual(len(pairs), 4)
        self.assertEqual(sum(pair["label"] for pair in pairs), 1)
        self.assertEqual(next(pair for pair in pairs if pair["label"] == 1)["route"], "deep")


if __name__ == "__main__":
    unittest.main()
