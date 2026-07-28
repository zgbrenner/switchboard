import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const TIERS = ['fast', 'balanced', 'deep', 'max'];
const HIGH_STAKES = new Set(['high-stakes', 'legal', 'security', 'medical', 'finance']);
const MAX_STATE_BYTES = 1_048_576;
const persistentStores = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tierIndex(value) {
  const index = TIERS.indexOf(value);
  return index < 0 ? 0 : index;
}

function emptyState() {
  return { version: 1, updatedAt: null, totalOverrides: 0, categories: {} };
}

function publicState(state, persistent) {
  return {
    version: state.version,
    persistent,
    updatedAt: state.updatedAt,
    totalOverrides: state.totalOverrides,
    categories: Object.fromEntries(Object.entries(state.categories).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function validateState(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.version !== 1 ||
    !value.categories ||
    typeof value.categories !== 'object' ||
    Array.isArray(value.categories)
  )
    return emptyState();
  const state = emptyState();
  state.updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : null;
  state.totalOverrides = Number.isInteger(value.totalOverrides) && value.totalOverrides >= 0 ? value.totalOverrides : 0;
  for (const [category, raw] of Object.entries(value.categories)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/u.test(category) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    state.categories[category] = {
      bias: Number.isFinite(raw.bias) ? clamp(raw.bias, -0.35, 0.35) : 0,
      overrides: Number.isInteger(raw.overrides) && raw.overrides >= 0 ? raw.overrides : 0,
      upgrades: Number.isInteger(raw.upgrades) && raw.upgrades >= 0 ? raw.upgrades : 0,
      downgrades: Number.isInteger(raw.downgrades) && raw.downgrades >= 0 ? raw.downgrades : 0,
    };
  }
  return state;
}

export class AggregatePreferenceStore {
  constructor({ path } = {}) {
    this.path = path ? resolve(path) : null;
    this.state = emptyState();
    this.loaded = false;
    this.loadPromise = null;
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    if (this.loadPromise) return await this.loadPromise;
    this.loadPromise = (async () => {
      if (!this.path) {
        this.loaded = true;
        return;
      }
      try {
        const text = await readFile(this.path, 'utf8');
        if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) throw new Error('Preference state exceeds the 1 MiB limit.');
        this.state = validateState(JSON.parse(text));
        this.loaded = true;
      } catch (error) {
        if (error?.code === 'ENOENT') {
          this.loaded = true;
          return;
        }
        throw error;
      } finally {
        this.loadPromise = null;
      }
    })();
    await this.loadPromise;
  }

  async persist() {
    if (!this.path) return;
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.path);
  }

  async record({ categories, recommendedTier, selectedTier }) {
    await this.load();
    const delta = tierIndex(selectedTier) - tierIndex(recommendedTier);
    if (delta === 0) {
      await this.queue;
      return publicState(this.state, Boolean(this.path));
    }
    this.queue = this.queue.then(async () => {
      const direction = Math.sign(delta);
      for (const category of categories) {
        const current = this.state.categories[category] ?? { bias: 0, overrides: 0, upgrades: 0, downgrades: 0 };
        current.bias = Math.round(clamp(current.bias * 0.9 + direction * 0.1, -0.35, 0.35) * 1000) / 1000;
        current.overrides += 1;
        if (direction > 0) current.upgrades += 1;
        else current.downgrades += 1;
        this.state.categories[category] = current;
      }
      this.state.totalOverrides += 1;
      this.state.updatedAt = new Date().toISOString();
      await this.persist();
    });
    await this.queue;
    return publicState(this.state, Boolean(this.path));
  }

  async snapshot() {
    await this.load();
    await this.queue;
    return publicState(this.state, Boolean(this.path));
  }

  async reset() {
    await this.load();
    this.queue = this.queue.then(async () => {
      this.state = emptyState();
      if (this.path) await rm(this.path, { force: true });
    });
    await this.queue;
    return publicState(this.state, Boolean(this.path));
  }

  async apply(decision) {
    await this.load();
    await this.queue;
    const categories = decision.taskCategories ?? [];
    const values = categories.map((category) => this.state.categories[category]?.bias).filter(Number.isFinite);
    if (!values.length) return { decision, learning: { applied: false, bias: 0, reason: 'no-category-history' } };
    const bias = values.reduce((total, value) => total + value, 0) / values.length;
    if (Math.abs(bias) < 0.08) return { decision, learning: { applied: false, bias, reason: 'below-threshold' } };
    const direction = Math.sign(bias);
    const hardCapability = Object.values(decision.capabilities ?? {}).some(Boolean);
    const highStakes = categories.some((category) => HIGH_STAKES.has(category));
    if (direction < 0 && (hardCapability || highStakes))
      return { decision, learning: { applied: false, bias, reason: 'downward-safety-floor' } };
    const current = tierIndex(decision.tier);
    const next = clamp(current + direction, 0, TIERS.length - 1);
    if (next === current) return { decision, learning: { applied: false, bias, reason: 'tier-boundary' } };
    const tier = TIERS[next];
    const effort = tier === 'max' ? 'max' : tier === 'deep' ? 'high' : tier === 'balanced' ? 'medium' : 'low';
    return {
      decision: { ...decision, tier, effort },
      learning: { applied: true, bias: Math.round(bias * 1000) / 1000, fromTier: decision.tier, toTier: tier },
    };
  }
}

export function getPreferenceStore(path = process.env.SWITCHBOARD_MCP_STATE_PATH) {
  if (!path) return new AggregatePreferenceStore();
  const key = resolve(path);
  if (!persistentStores.has(key)) persistentStores.set(key, new AggregatePreferenceStore({ path: key }));
  return persistentStores.get(key);
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

export function normalizeOverrideArguments(value) {
  const args = object(value ?? {}, 'record_override arguments');
  const allowed = new Set(['categories', 'recommendedTier', 'selectedTier']);
  for (const key of Object.keys(args))
    if (!allowed.has(key)) throw new Error(`record_override arguments contains an unsupported property: ${key}.`);
  if (!Array.isArray(args.categories) || args.categories.length < 1 || args.categories.length > 16)
    throw new Error('categories must contain between 1 and 16 entries.');
  const categories = [
    ...new Set(
      args.categories.map((category, index) => {
        if (typeof category !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/u.test(category))
          throw new Error(`categories[${index}] is invalid.`);
        return category;
      }),
    ),
  ];
  if (!TIERS.includes(args.recommendedTier) || !TIERS.includes(args.selectedTier))
    throw new Error('recommendedTier and selectedTier must be fast, balanced, deep, or max.');
  return { categories, recommendedTier: args.recommendedTier, selectedTier: args.selectedTier };
}

export const OVERRIDE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['categories', 'recommendedTier', 'selectedTier'],
  properties: {
    categories: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
      description:
        'Task categories the corrected decision applies to, taken verbatim from taskCategories in the route_request response — for example "code", "high-stakes", "reasoning", "research". Category names only: this tool rejects prompt text, file data, model identifiers, notes, and any field not listed here.',
      items: {
        type: 'string',
        pattern: '^[a-z0-9][a-z0-9_-]{0,39}$',
        description: 'A lowercase category name of at most 40 characters.',
      },
    },
    recommendedTier: { type: 'string', enum: TIERS, description: 'The tier Switchboard recommended.' },
    selectedTier: {
      type: 'string',
      enum: TIERS,
      description:
        'The tier actually used. Higher than recommendedTier records an upgrade, lower records a downgrade. Learned downgrades can never route beneath a capability or safety floor.',
    },
  },
};
