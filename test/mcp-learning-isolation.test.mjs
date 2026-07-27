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
    tier: 'balanced', effort: 'medium', taskCategories: ['analysis'],
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
