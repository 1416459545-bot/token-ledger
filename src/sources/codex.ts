import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../core/types.ts';
import { shortHash } from '../util/hash.ts';
import { lastSegment } from '../util/pathname.ts';
import type { ParseResult, ParseStats, UsageSource } from './types.ts';

export const CODEX_SOURCE = 'codex';
export const CODEX_PROVIDER = 'openai';

/**
 * Codex CLI 的会话目录。
 * 结构：~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl
 */
export function defaultCodexRoot(): string {
  const fromEnv = process.env.CODEX_SESSIONS_DIR;
  if (fromEnv && fromEnv.trim() !== '') return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.codex', 'sessions');
}

export function findRolloutFiles(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
  };

  walk(root);
  return out.sort();
}

function count(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  return 0;
}

interface UsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
}

/** 读取一个 TokenUsage 对象（字段名来自 openai/codex protocol.rs 的 TokenUsage）。 */
export function readUsageTotals(raw: unknown): UsageTotals | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const totals: UsageTotals = {
    inputTokens: count(o.input_tokens),
    cachedInputTokens: count(o.cached_input_tokens),
    cacheWriteInputTokens: count(o.cache_write_input_tokens),
    outputTokens: count(o.output_tokens),
  };
  const sum =
    totals.inputTokens + totals.cachedInputTokens + totals.cacheWriteInputTokens + totals.outputTokens;
  return sum > 0 ? totals : null;
}

/**
 * 解析一个 rollout 文件。
 *
 * 关键点：`token_count` 事件在一个回合里可能重复发出，而 `total_token_usage` 是**会话累计值**。
 * 因此这里对累计值做差分（delta），而不是直接累加 `last_token_usage`，避免重复计账。
 * 模型名取自 `turn_context.payload.model`，项目名取自 `cwd`。
 */
export function parseCodexFile(filePath: string): ParseResult {
  const stats: ParseStats = { lines: 0, skipped: 0, events: 0 };
  const events: UsageEvent[] = [];

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { events, stats };
  }

  interface Parsed {
    obj: Record<string, unknown>;
    payload: Record<string, unknown>;
  }
  const rows: Parsed[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    stats.lines += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      stats.skipped += 1;
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      stats.skipped += 1;
      continue;
    }
    const obj = parsed as Record<string, unknown>;
    const payload =
      obj.payload && typeof obj.payload === 'object' && !Array.isArray(obj.payload)
        ? (obj.payload as Record<string, unknown>)
        : {};
    rows.push({ obj, payload });
  }

  if (rows.length === 0) return { events, stats };

  // 第一遍：拿会话信息与兜底模型（turn_context 可能出现在 token_count 之后）
  let sessionId: string | null = null;
  let fallbackCwd: string | null = null;
  let fallbackModel: string | null = null;

  for (const { obj, payload } of rows) {
    if (obj.type === 'session_meta') {
      const id = typeof payload.id === 'string' && payload.id !== '' ? payload.id : null;
      if (id !== null) sessionId = id;
      const cwd = typeof payload.cwd === 'string' ? payload.cwd : null;
      if (cwd !== null && fallbackCwd === null) fallbackCwd = cwd;
    }
    if (obj.type === 'turn_context') {
      const model = typeof payload.model === 'string' ? payload.model : null;
      if (model !== null && fallbackModel === null) fallbackModel = model;
      const cwd = typeof payload.cwd === 'string' ? payload.cwd : null;
      if (cwd !== null && fallbackCwd === null) fallbackCwd = cwd;
    }
  }

  // 第二遍：按累计值差分出每一条用量
  let currentModel: string | null = fallbackModel;
  let currentCwd: string | null = fallbackCwd;
  let previous: UsageTotals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
  };
  let index = 0;

  for (const { obj, payload } of rows) {
    if (obj.type === 'turn_context') {
      if (typeof payload.model === 'string' && payload.model !== '') currentModel = payload.model;
      if (typeof payload.cwd === 'string' && payload.cwd !== '') currentCwd = payload.cwd;
      continue;
    }
    if (obj.type !== 'event_msg' || payload.type !== 'token_count') continue;

    const info = payload.info;
    if (!info || typeof info !== 'object') continue;
    const totals = readUsageTotals((info as Record<string, unknown>).total_token_usage);
    if (totals === null) continue;

    index += 1;

    const delta: UsageTotals = {
      inputTokens: Math.max(0, totals.inputTokens - previous.inputTokens),
      cachedInputTokens: Math.max(0, totals.cachedInputTokens - previous.cachedInputTokens),
      cacheWriteInputTokens: Math.max(
        0,
        totals.cacheWriteInputTokens - previous.cacheWriteInputTokens,
      ),
      outputTokens: Math.max(0, totals.outputTokens - previous.outputTokens),
    };
    previous = totals;

    const deltaSum =
      delta.inputTokens + delta.cachedInputTokens + delta.cacheWriteInputTokens + delta.outputTokens;
    if (deltaSum === 0) {
      stats.skipped += 1;
      continue;
    }

    // OpenAI 语义：input_tokens 含缓存命中与缓存写入，拆出来单独计价
    const plainInput = Math.max(
      0,
      delta.inputTokens - delta.cachedInputTokens - delta.cacheWriteInputTokens,
    );

    const tsRaw = typeof obj.timestamp === 'string' ? obj.timestamp : '';
    const date = new Date(tsRaw);
    if (Number.isNaN(date.getTime())) {
      stats.skipped += 1;
      continue;
    }
    const ts = date.toISOString();

    const model = currentModel ?? 'unknown';
    const project = currentCwd !== null ? lastSegment(currentCwd) || null : null;

    events.push({
      id: `${CODEX_SOURCE}:${shortHash(
        JSON.stringify([filePath, index, ts, deltaSum, model]),
      )}`,
      ts,
      source: CODEX_SOURCE,
      provider: CODEX_PROVIDER,
      model,
      project,
      sessionId,
      inputTokens: plainInput,
      outputTokens: delta.outputTokens,
      cacheReadTokens: delta.cachedInputTokens,
      cacheWriteTokens: delta.cacheWriteInputTokens,
      costUsd: null,
    });
    stats.events += 1;
  }

  return { events, stats };
}

export const codexSource: UsageSource = {
  name: CODEX_SOURCE,
  label: 'Codex CLI',
  defaultRoot: defaultCodexRoot,
  findFiles: findRolloutFiles,
  parseFile: parseCodexFile,
};
