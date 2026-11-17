import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsageEvent } from '../core/types.ts';
import { isoToLocalDay } from '../util/format.ts';
import { shortHash } from '../util/hash.ts';

export const SOURCE_NAME = 'claude-code';
export const DEFAULT_PROVIDER = 'anthropic';

export interface ParseStats {
  lines: number;
  /** 被跳过的行数（非 assistant、synthetic、零消耗、坏行） */
  skipped: number;
  events: number;
}

/** Claude Code 本地会话日志目录。 */
export function defaultClaudeRoot(): string {
  const fromEnv = process.env.CLAUDE_PROJECTS_DIR;
  if (fromEnv && fromEnv.trim() !== '') return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.claude', 'projects');
}

/** 递归找出所有 .jsonl 会话文件。 */
export function findJsonlFiles(root: string): string[] {
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

function toPositiveInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

/**
 * 缓存写入 token。
 * 新版 Claude Code 同时提供扁平字段和 `cache_creation` 明细对象，优先用扁平总数。
 */
export function cacheWriteTokensOf(usage: Record<string, unknown>): number {
  const flat = toPositiveInt(usage.cache_creation_input_tokens);
  if (flat > 0) return flat;
  const nested = usage.cache_creation;
  if (nested && typeof nested === 'object') {
    let sum = 0;
    for (const value of Object.values(nested as Record<string, unknown>)) sum += toPositiveInt(value);
    return sum;
  }
  return 0;
}

/** 从 `cwd` 或会话目录名推断项目名。 */
export function projectOf(cwd: unknown, filePath: string): string | null {
  if (typeof cwd === 'string' && cwd.trim() !== '') {
    const base = path.basename(cwd.replace(/[\\/]+$/, ''));
    if (base !== '') return base;
  }
  const dirName = path.basename(path.dirname(filePath));
  const cleaned = dirName.replace(/^[A-Za-z]--/, '');
  const segments = cleaned.split('-').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

/**
 * 解析一行 JSONL。不是「一次真实 API 调用」就返回 null。
 * 这里刻意不读取 message.content —— 账本只记数字。
 */
export function parseClaudeLine(raw: unknown, filePath: string): UsageEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type !== 'assistant') return null;

  const message = obj.message;
  if (!message || typeof message !== 'object') return null;
  const msg = message as Record<string, unknown>;

  const usage = (msg.usage ?? obj.usage) as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== 'object') return null;

  const model = typeof msg.model === 'string' ? msg.model.trim() : '';
  // <synthetic> 是客户端合成消息，不计费
  if (model === '' || model === '<synthetic>') return null;

  const input = toPositiveInt(usage.input_tokens);
  const output = toPositiveInt(usage.output_tokens);
  const cacheRead = toPositiveInt(usage.cache_read_input_tokens);
  const cacheWrite = cacheWriteTokensOf(usage);

  if (input + output + cacheRead + cacheWrite === 0) return null;

  const tsRaw = typeof obj.timestamp === 'string' ? obj.timestamp : '';
  const tsDate = new Date(tsRaw);
  if (Number.isNaN(tsDate.getTime())) return null;
  const ts = tsDate.toISOString();
  if (isoToLocalDay(ts) === '') return null;

  const sessionId = typeof obj.sessionId === 'string' && obj.sessionId !== '' ? obj.sessionId : null;
  const messageId = typeof msg.id === 'string' && msg.id !== '' ? msg.id : null;
  const uuid = typeof obj.uuid === 'string' && obj.uuid !== '' ? obj.uuid : null;

  const id = messageId !== null
    ? `${SOURCE_NAME}:${messageId}`
    : `${SOURCE_NAME}:${shortHash(`${filePath}|${uuid ?? ''}|${ts}|${model}|${input}|${output}`)}`;

  return {
    id,
    ts,
    source: SOURCE_NAME,
    provider: DEFAULT_PROVIDER,
    model,
    project: projectOf(obj.cwd, filePath),
    sessionId,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsd: null,
  };
}

/** 解析一个会话文件。坏行只计数，不中断整个扫描。 */
export function parseClaudeFile(filePath: string): { events: UsageEvent[]; stats: ParseStats } {
  const stats: ParseStats = { lines: 0, skipped: 0, events: 0 };
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { events: [], stats };
  }

  const events: UsageEvent[] = [];
  const seen = new Set<string>();
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
    const event = parseClaudeLine(parsed, filePath);
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
