import fs from 'node:fs';
import type { UsageEvent } from '../core/types.ts';
import { isoToLocalDay } from '../util/format.ts';
import { shortHash } from '../util/hash.ts';

/**
 * 通用导入格式：一行一条 JSON（JSONL），也接受空行与 `#` 注释行。
 *
 * 必填：ts / timestamp / time（可被 Date 解析）、model、至少一个 token 字段
 * 可选：provider、project、session_id
 * 字段同时接受 snake_case 与 camelCase。
 *
 * 例：
 * {"ts":"2026-11-10T10:00:00Z","model":"gpt-4o","input_tokens":1000,"output_tokens":500,"project":"alpha"}
 */
export const IMPORT_SOURCE = 'import';

export interface GenericImportResult {
  events: UsageEvent[];
  stats: { lines: number; skipped: number; events: number };
}

function toCount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function text(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return null;
}

/** 解析一条通用记录；不是一条有效用量就返回 null。 */
export function parseImportLine(raw: unknown, project: string | null = null): UsageEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const tsText = text(pick(obj, ['ts', 'timestamp', 'time']));
  if (tsText === null) return null;
  const date = new Date(tsText);
  if (Number.isNaN(date.getTime())) return null;
  const ts = date.toISOString();
  if (isoToLocalDay(ts) === '') return null;

  const model = text(obj.model);
  if (model === null) return null;

  const inputTokens = toCount(pick(obj, ['input_tokens', 'inputTokens']));
  const outputTokens = toCount(pick(obj, ['output_tokens', 'outputTokens']));
  const cacheReadTokens = toCount(pick(obj, ['cache_read_tokens', 'cacheReadTokens']));
  const cacheWriteTokens = toCount(pick(obj, ['cache_write_tokens', 'cacheWriteTokens']));
  if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0) return null;

  const provider = text(obj.provider) ?? 'unknown';
  const projectName = text(obj.project) ?? project;
  const sessionId = text(pick(obj, ['session_id', 'sessionId']));
  // 保留来源标识：`export --format jsonl` 导出的文件再导入时，来源不会退化成 import
  const source = text(obj.source) ?? IMPORT_SOURCE;

  // 内容哈希做主键：同一文件重复导入不会重复记账
  const id = `${IMPORT_SOURCE}:${shortHash(
    JSON.stringify([
      ts,
      source,
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      projectName,
      sessionId,
    ]),
  )}`;

  return {
    id,
    ts,
    source,
    provider,
    model,
    project: projectName,
    sessionId,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: null,
  };
}

export function parseImportFile(filePath: string, project: string | null = null): GenericImportResult {
  const stats = { lines: 0, skipped: 0, events: 0 };
  const events: UsageEvent[] = [];

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { events, stats };
  }

  const seen = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    stats.lines += 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      stats.skipped += 1;
      continue;
    }

    const event = parseImportLine(parsed, project);
    if (event === null) {
      stats.skipped += 1;
      continue;
    }
    if (seen.has(event.id)) continue;

    seen.add(event.id);
    events.push(event);
    stats.events += 1;
  }

  return { events, stats };
}
