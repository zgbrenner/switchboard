import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { AggregatePreferenceStore, getPreferenceStore } = await import('../mcp/learning.mjs');

const override = { categories: ['analysis'], recommendedTier: 'balanced', selectedTier: 'deep' };

test('unconfigured preference stores are isolated by default', async () => {
  const first = getPreferenceStore(undefined);
  const second = getPreferenceStore(undefined);
  assert.notEqual(first, second);

  await first.record(override);
  assert.equal((await first.snapshot()).totalOverrides, 1);
  assert.equal((await second.snapshot()).totalOverrides, 0);
  assert.deepEqual((await second.snapshot()).categories, {});
});

test('an explicit state path intentionally shares persistent aggregate state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'switchboard-learning-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'preferences.json');
  const first = getPreferenceStore(path);
  const second = getPreferenceStore(path);
  assert.equal(first, second);

  await first.record(override);
  const snapshot = await second.snapshot();
  assert.equal(snapshot.persistent, true);
  assert.equal(snapshot.totalOverrides, 1);
  assert.equal(snapshot.categories.analysis.overrides, 1);
});

test('snapshots and route adjustments wait for queued writes', async () => {
  const store = new AggregatePreferenceStore();
  const writes = Array.from({ length: 3 }, () => store.record(override));
  await Promise.all(writes);

  const snapshot = await store.snapshot();
  assert.equal(snapshot.totalOverrides, 3);
  assert.equal(snapshot.categories.analysis.overrides, 3);

  const base = {
    tier: 'balanced',
    effort: 'medium',
    taskCategories: ['analysis'],
    capabilities: { web: false, files: false, vision: false, longContext: false, code: false },
  };
  const adjusted = await store.apply(base);
  assert.equal(adjusted.learning.applied, true);
  assert.equal(adjusted.decision.tier, 'deep');
});

test('oversized persistent state is rejected before parsing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'switchboard-learning-large-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'preferences.json');
  await writeFile(path, ' '.repeat(1_048_577), 'utf8');
  const store = new AggregatePreferenceStore({ path });
  await assert.rejects(store.snapshot(), /1 MiB/);
});

test('a failed load can be retried after the state file is corrected', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'switchboard-learning-retry-'));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'preferences.json');
  await writeFile(path, '{broken', 'utf8');
  const store = new AggregatePreferenceStore({ path });
  await assert.rejects(store.snapshot(), /JSON/);

  await writeFile(path, JSON.stringify({ version: 1, updatedAt: null, totalOverrides: 0, categories: {} }), 'utf8');
  assert.equal((await store.snapshot()).totalOverrides, 0);
});

test('a transient persist failure does not permanently wedge the write queue', async () => {
  // this.queue serializes writes by chaining .then() calls. Chaining .then() onto an already-
  // rejected promise just re-propagates that rejection forever, so a single transient failure
  // (a full disk, a concurrent writer, any I/O hiccup) used to poison every future record/reset/
  // snapshot/apply call on this store instance -- permanently, with no further contention at all.
  const store = new AggregatePreferenceStore();
  const originalPersist = store.persist.bind(store);
  let failNext = true;
  store.persist = async () => {
    if (failNext) {
      failNext = false;
      throw new Error('simulated transient failure');
    }
    return originalPersist();
  };

  await assert.rejects(store.record(override), /simulated transient failure/);
  // The queue must have recovered: an unrelated later call succeeds instead of failing forever.
  const second = await store.record({ categories: ['code'], recommendedTier: 'balanced', selectedTier: 'deep' });
  assert.equal(second.categories.code.overrides, 1);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.categories.code.overrides, 1);
});

test('the number of distinct categories is bounded, protecting route_request from an oversized state file', async () => {
  // Nothing previously capped how many distinct category keys record() could accumulate over time
  // (only each call's own 1-16 categories were bounded). Left unbounded, this can grow the
  // persisted file past its own 1 MiB read limit, and every subsequent load -- including apply(),
  // which route_request calls on every invocation when preferences are shared -- would then throw,
  // breaking routing itself for every session sharing that state file.
  const store = new AggregatePreferenceStore();
  for (let batch = 0; batch < 140; batch += 1) {
    const categories = Array.from({ length: 16 }, (_, i) => `cat${String(batch * 16 + i).padStart(36, '0')}`);
    await store.record({ categories, recommendedTier: 'balanced', selectedTier: 'deep' });
  }
  const snapshot = await store.snapshot();
  const distinctCategories = Object.keys(snapshot.categories).length;
  assert.ok(distinctCategories < 2_240, `expected the category count to be capped, got ${distinctCategories}`);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot), 'utf8') < 1_048_576, 'capped state must stay well under the 1 MiB limit');
});
