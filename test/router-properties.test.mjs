/**
 * Property tests for the router.
 *
 * These assert invariants that hold for every input, rather than the expected tier of a handful of
 * hand-picked prompts. They need no ground-truth labels and no model calls, so they are the part of
 * the routing evaluation story that is fully verifiable in CI. See benchmarks/README.md for the
 * outcome-labelled evaluation that complements them.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { TIER_ORDER } from '../.test-dist/router/policies.js';
import { routeRequest } from '../.test-dist/router/route.js';

const POLICIES = ['conserve', 'fast', 'balanced', 'best'];

function route(prompt, { policy = 'balanced', files = [], context = [], categoryBoosts } = {}) {
  return routeRequest({
    prompt,
    context,
    files,
    preferences: categoryBoosts ? { policy, categoryBoosts } : { policy },
  });
}

const tierIndex = (tier) => TIER_ORDER.indexOf(tier);

/** A spread of prompts covering every tier and several domains. */
const CORPUS = [
  'Make this sentence friendlier: Thanks for the update.',
  'Rewrite this paragraph to be shorter.',
  'What is the capital of France?',
  'Summarize this meeting note.',
  'Compare these two database designs and recommend one.',
  'Explain how this caching layer works.',
  'Debug this failing test and explain the root cause.',
  'Audit this authentication flow and prove the absence of subtle race conditions.',
  'Design a distributed consensus protocol and prove its safety properties.',
  'Research this deeply, verify every claim with primary sources, and produce a detailed implementation plan.',
  'Draft a contract indemnification clause and check it for compliance exposure.',
  'Review this SQL migration for correctness and concurrency hazards.',
];

test('routing is deterministic across repeated calls', () => {
  for (const prompt of CORPUS) {
    const first = JSON.stringify(route(prompt));
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal(JSON.stringify(route(prompt)), first, `non-deterministic routing for: ${prompt}`);
    }
  }
});

test('policy is monotonic: conserve <= fast <= balanced <= best', () => {
  let responsive = 0;
  for (const prompt of CORPUS) {
    const tiers = POLICIES.map((policy) => tierIndex(route(prompt, { policy }).tier));
    for (let index = 1; index < tiers.length; index++) {
      assert.ok(
        tiers[index] >= tiers[index - 1],
        `policy ${POLICIES[index]} routed below ${POLICIES[index - 1]} for: ${prompt} (${tiers.join(',')})`,
      );
    }
    if (new Set(tiers).size > 1) responsive++;
  }
  // The control must not be inert. It was a documented no-op before: every policy returned the
  // same tier for every prompt, which is the regression this assertion exists to prevent.
  assert.ok(responsive >= CORPUS.length / 3, `policy changed the tier for only ${responsive}/${CORPUS.length} prompts`);
});

test('no policy can route beneath a capability or safety floor', () => {
  const visionFile = {
    name: 'diagram.png',
    size: 1000,
    detectedType: 'png',
    mediaType: 'image/png',
    textLength: 0,
    excerpt: '',
    warnings: [],
    capabilities: { files: true, vision: true, longContext: false },
  };
  for (const policy of POLICIES) {
    const withFile = route('Tell me what this says.', { policy, files: [visionFile] });
    assert.ok(tierIndex(withFile.tier) >= tierIndex('deep'), `${policy} bypassed the visual-attachment floor`);
    assert.equal(withFile.capabilities.vision, true);
    assert.equal(withFile.capabilities.files, true);
  }
});

test('an attachment never lowers a floor the prompt already established', () => {
  const prompt = 'Audit this authentication flow and prove the absence of subtle race conditions.';
  const smallFile = {
    name: 'note.txt',
    size: 100,
    detectedType: 'txt',
    mediaType: 'text/plain',
    textLength: 100,
    excerpt: 'x',
    warnings: [],
    capabilities: { files: true, vision: false, longContext: false },
  };
  const withoutFile = route(prompt);
  const withFile = route(prompt, { files: [smallFile] });
  assert.ok(
    tierIndex(withFile.tier) >= tierIndex(withoutFile.tier),
    `attaching a file lowered the tier from ${withoutFile.tier} to ${withFile.tier}`,
  );
  assert.equal(withFile.capabilities.files, true);
});

test('confidence reflects evidence rather than defaulting high', () => {
  for (const empty of ['', '   ', 'hi', 'ok', '.']) {
    const decision = route(empty);
    assert.ok(decision.confidence <= 0.3, `no-evidence prompt ${JSON.stringify(empty)} reported confidence ${decision.confidence}`);
  }
  const strong = route('Audit this authentication flow and prove the absence of subtle race conditions.');
  assert.ok(strong.confidence >= 0.8, `strongly-evidenced prompt reported only ${strong.confidence}`);
  assert.ok(strong.confidence <= 0.97);
});

test('confidence stays within [0,1] and is finite for every corpus prompt', () => {
  for (const prompt of [...CORPUS, '', 'x'.repeat(50000)]) {
    const { confidence } = route(prompt);
    assert.ok(Number.isFinite(confidence), `non-finite confidence for: ${prompt.slice(0, 40)}`);
    assert.ok(confidence >= 0 && confidence <= 1);
  }
});

test('non-Latin scripts are not silently routed to the cheapest tier', () => {
  const prompts = [
    'この認証フローを監査し、微妙な障害モードを検証してください。',
    'Проведите аудит этого потока аутентификации и проверьте тонкие режимы отказа.',
    'دقق تدفق المصادقة هذا وتحقق من أوضاع الفشل الدقيقة.',
    '이 인증 흐름을 감사하고 미묘한 실패 모드를 확인하십시오.',
    'इस प्रमाणीकरण प्रवाह का ऑडिट करें और सूक्ष्म विफलता मोड सत्यापित करें।',
  ];
  for (const prompt of prompts) {
    const decision = route(prompt);
    assert.notEqual(decision.tier, 'fast', `non-Latin prompt collapsed to fast: ${prompt.slice(0, 30)}`);
    // The English keyword signals cannot read it, so the router must say so rather than guess.
    assert.equal(decision.shouldUseJudge, true);
    assert.ok(decision.taskCategories.includes('unknown-language'));
  }
});

test('an English prompt quoting a non-Latin identifier is still analysed as English', () => {
  const decision = route('Rewrite this error message to be friendlier: the field 名前 is required.');
  assert.equal(decision.tier, 'fast');
  assert.ok(!decision.taskCategories.includes('unknown-language'));
});

test('tier is invariant to casing, surrounding whitespace, and markdown fencing', () => {
  for (const prompt of CORPUS) {
    const baseline = route(prompt).tier;
    const variants = [`  ${prompt}  `, `${prompt}\n\n`, prompt.toUpperCase(), prompt.toLowerCase(), `> ${prompt}`, `**${prompt}**`];
    for (const variant of variants) {
      assert.equal(route(variant).tier, baseline, `tier changed for a cosmetic variant of: ${prompt}`);
    }
  }
});

test('appending an explicitly harder requirement never lowers the tier', () => {
  const harder = ' Also prove correctness for every edge case and audit it rigorously.';
  for (const prompt of CORPUS) {
    const before = tierIndex(route(prompt).tier);
    const after = tierIndex(route(prompt + harder).tier);
    assert.ok(after >= before, `adding a harder requirement lowered the tier for: ${prompt}`);
  }
});

test('trivial prompts containing an incidental trigger word do not reach the top tiers', () => {
  // These all contain words that appear as literal alternates in the signal patterns.
  const incidental = [
    'what is the weather today',
    'say hi',
    'tell me a joke about a library',
    'what time does the security desk close',
    'is the api down',
  ];
  for (const prompt of incidental) {
    const decision = route(prompt);
    assert.ok(tierIndex(decision.tier) <= tierIndex('balanced'), `trivial prompt over-routed to ${decision.tier}: ${prompt}`);
  }
});

test('common English words that overlap programming vocabulary do not falsely require code capability', () => {
  // 'class' and 'function' are ordinary nouns outside programming. A prompt that merely contains one,
  // with no other technical signal, must not be flagged as needing a code-capable model.
  const nonTechnical = [
    'Explain the legal class action settlement process for this financial dispute.',
    'Describe the function of the judiciary in a democracy.',
    'What time is the wedding function tomorrow?',
    'Which social class does this character belong to in the novel?',
  ];
  for (const prompt of nonTechnical) {
    const decision = route(prompt);
    assert.equal(decision.capabilities.code, false, `false-positive code capability for: ${prompt}`);
    assert.ok(!decision.taskCategories.includes('code'), `false-positive code category for: ${prompt}`);
  }
});

test('keyword-flip stability: injecting trigger words into an unchanged task rarely changes the decision', () => {
  // Semantically null suffixes that contain high-weight trigger vocabulary. The task is identical;
  // only the wording changes. A router that flips on these is matching words, not difficulty.
  const nullSuffixes = [' Thanks!', ' Please and thank you.', ' (no rush)', ' -- sent from my phone'];
  let flips = 0;
  let total = 0;
  for (const prompt of CORPUS) {
    const baseline = route(prompt).tier;
    for (const suffix of nullSuffixes) {
      total++;
      if (route(prompt + suffix).tier !== baseline) flips++;
    }
  }
  const flippingRate = flips / total;
  assert.ok(flippingRate <= 0.05, `flipping rate ${(flippingRate * 100).toFixed(1)}% on semantically null edits (${flips}/${total})`);
});

test('every routed decision carries at least one reason and a valid tier/effort pair', () => {
  const effortForTier = { fast: 'low', balanced: 'medium', deep: 'high', max: 'max' };
  for (const prompt of CORPUS) {
    const decision = route(prompt);
    assert.ok(TIER_ORDER.includes(decision.tier));
    assert.equal(decision.effort, effortForTier[decision.tier]);
    assert.ok(decision.reasons.length >= 1, `no reason given for: ${prompt}`);
    for (const reason of decision.reasons) {
      assert.equal(typeof reason.code, 'string');
      assert.ok(reason.code.length > 0);
      assert.ok(Number.isFinite(reason.weight));
    }
    const total = Object.values(decision.scores).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `tier scores did not sum to 1 for: ${prompt}`);
  }
});

test('routing an empty prompt degrades safely instead of throwing', () => {
  const decision = route('');
  assert.equal(decision.tier, 'fast');
  assert.ok(decision.confidence <= 0.3);
  assert.ok(Array.isArray(decision.reasons));
});
