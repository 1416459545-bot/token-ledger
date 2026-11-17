import fs from 'node:fs';
import path from 'node:path';

/**
 * 价格单位：**美元 / 每 100 万 tokens**。
 * 所有数字都是「常见公开报价」的量级，用于估算，不是账单。
 * 想精确就写 `~/.token-ledger/prices.json` 覆盖（见 README）。
 */
export interface PriceEntry {
  provider: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * 内置价格表。键是「模型族前缀」，不是完整模型名：
 * `claude-opus-5-5` 会命中 `claude-opus`，`gpt-4o-mini` 会先命中 `gpt-4o-mini` 而不是 `gpt-4o`。
 */
export const BUILTIN_PRICES: Record<string, PriceEntry> = {
  'claude-opus': { provider: 'anthropic', input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet': { provider: 'anthropic', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku': { provider: 'anthropic', input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },

  'gpt-5-mini': { provider: 'openai', input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0.25 },
  'gpt-5': { provider: 'openai', input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
  'gpt-4o-mini': { provider: 'openai', input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  'gpt-4o': { provider: 'openai', input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  'o4-mini': { provider: 'openai', input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 1.1 },
  'o3': { provider: 'openai', input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 },

  'gemini-2.5-pro': { provider: 'google', input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 },
  'gemini-2.5-flash': { provider: 'google', input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0.3 },

  'deepseek-reasoner': { provider: 'deepseek', input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
  'deepseek-chat': { provider: 'deepseek', input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 },
};

export interface PricingTable {
  entries: Record<string, PriceEntry>;
  /** `builtin` 或 `builtin+user` */
  source: string;
  warnings: string[];
  customFile: string | null;
}

export interface PriceResolution {
  key: string;
  entry: PriceEntry;
  /** true = 模型名完全命中；false = 按模型族近似命中 */
  exact: boolean;
}

/** 把千奇百怪的模型名洗成可匹配的形式。 */
export function normalizeModel(model: string): string {
  let m = model.trim().toLowerCase();
  if (m === '') return '';
  const slash = m.lastIndexOf('/');
  if (slash !== -1) m = m.slice(slash + 1);
  const at = m.indexOf('@');
  if (at !== -1) m = m.slice(0, at);
  m = m.replace(/[-_](\d{8})$/, '');
  m = m.replace(/[-_](\d{4})-(\d{2})-(\d{2})$/, '');
  m = m.replace(/[-_](\d{4})-(\d{2})$/, '');
  return m;
}

/** `model` 中是否包含 `needle`，且两侧是分词边界（避免 `o3` 命中 `foo3`）。 */
function isBoundaryMatch(hay: string, needle: string): boolean {
  let from = 0;
  while (from <= hay.length) {
    const i = hay.indexOf(needle, from);
    if (i === -1) return false;
    const before = i === 0 ? '' : hay[i - 1];
    const after = i + needle.length >= hay.length ? '' : hay[i + needle.length];
    const okBefore = before === '' || !/[a-z0-9]/.test(before);
    const okAfter = after === '' || !/[a-z0-9]/.test(after);
    if (okBefore && okAfter) return true;
    from = i + 1;
  }
  return false;
}

/** 查价：先精确、再按「最长的模型族」近似。查不到返回 null（账本记 n/a，不瞎猜）。 */
export function resolvePrice(
  model: string,
  table: Record<string, PriceEntry> = BUILTIN_PRICES,
): PriceResolution | null {
  const normalized = normalizeModel(model);
  if (normalized === '') return null;

  const exact = table[normalized];
  if (exact) return { key: normalized, entry: exact, exact: true };

  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (isBoundaryMatch(normalized, key)) {
      return { key, entry: table[key], exact: false };
    }
  }
  return null;
}

/** 计费：单位是每百万 tokens，结果保留 6 位小数。 */
export function costOf(
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
  price: PriceEntry,
): number {
  const raw =
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheWrite * price.cacheWrite) /
    1_000_000;
  return Math.round(raw * 1e6) / 1e6;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    const n = Number(v);
    return n >= 0 ? n : null;
  }
  return null;
}

/**
 * 读取用户价格表并与内置表合并。
 * 文件格式：{ "models": { "<模型键>": { input, output, cacheRead?, cacheWrite?, provider? } } }
 */
export function loadPricing(home: string): PricingTable {
  const entries: Record<string, PriceEntry> = { ...BUILTIN_PRICES };
  const warnings: string[] = [];
  const file = path.join(home, 'prices.json');

  if (!fs.existsSync(file)) {
    return { entries, source: 'builtin', warnings, customFile: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    warnings.push(`价格文件解析失败，已忽略：${file}（${(err as Error).message}）`);
    return { entries, source: 'builtin', warnings, customFile: file };
  }

  const rawModels =
    parsed && typeof parsed === 'object' && 'models' in parsed
      ? (parsed as { models?: unknown }).models
      : parsed;

  if (!rawModels || typeof rawModels !== 'object') {
    warnings.push(`价格文件格式不对（缺少 models 对象），已忽略：${file}`);
    return { entries, source: 'builtin', warnings, customFile: file };
  }

  let merged = 0;
  for (const [rawKey, rawValue] of Object.entries(rawModels as Record<string, unknown>)) {
    if (!rawValue || typeof rawValue !== 'object') continue;
    const v = rawValue as Record<string, unknown>;
    const input = toNumber(v.input);
    const output = toNumber(v.output);
    if (input === null || output === null) {
      warnings.push(`价格条目 "${rawKey}" 缺少 input/output，已跳过`);
      continue;
    }
    const cacheRead = toNumber(v.cacheRead) ?? 0;
    const cacheWrite = toNumber(v.cacheWrite) ?? input;
    const provider = typeof v.provider === 'string' && v.provider.trim() !== '' ? v.provider.trim() : 'custom';
    entries[normalizeModel(rawKey)] = { provider, input, output, cacheRead, cacheWrite };
    merged += 1;
  }

  return {
    entries,
    source: merged > 0 ? 'builtin+user' : 'builtin',
    warnings,
    customFile: merged > 0 ? file : null,
  };
}
