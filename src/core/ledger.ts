import type { DatabaseSync } from 'node:sqlite';
import type { AggregateRow, GroupBy, Totals, UsageEvent } from './types.ts';

/** 批量入库，幂等：同一 id 只记一次。返回真正新增的条数。 */
export function insertEvents(db: DatabaseSync, events: UsageEvent[]): number {
  if (events.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events
       (id, ts, day, month, source, provider, model, project, session_id,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  db.exec('BEGIN');
  try {
    for (const e of events) {
      const day = e.ts.slice(0, 10);
      const month = day.slice(0, 7);
      const result = stmt.run(
        e.id,
        e.ts,
        day,
        month,
        e.source,
        e.provider,
        e.model,
        e.project,
        e.sessionId,
        e.inputTokens,
        e.outputTokens,
        e.cacheReadTokens,
        e.cacheWriteTokens,
        e.costUsd,
      );
      if (Number(result.changes) > 0) inserted += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return inserted;
}

export interface FileState {
  mtimeMs: number;
  size: number;
}

export function getFileState(db: DatabaseSync, p: string): FileState | null {
  const row = db.prepare('SELECT mtime_ms, size FROM files WHERE path = ?').get(p) as
    | { mtime_ms: number; size: number }
    | undefined;
  if (!row) return null;
  return { mtimeMs: Number(row.mtime_ms), size: Number(row.size) };
}

export function setFileState(db: DatabaseSync, p: string, mtimeMs: number, size: number, inserted: number): void {
  db.prepare(
    `INSERT INTO files (path, mtime_ms, size, events_inserted) VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size,
       events_inserted = excluded.events_inserted`,
  ).run(p, mtimeMs, size, inserted);
}

const GROUP_COLUMNS: Record<GroupBy, string> = {
  day: 'day',
  model: 'model',
  project: "COALESCE(NULLIF(project, ''), '(未标注)')",
  source: 'source',
};

/** 浮点求和会带出 0.12000000000000001 这种尾巴，账本统一收到 6 位小数。 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function toAggregateRow(raw: Record<string, unknown>): AggregateRow {
  const input = Number(raw.input ?? 0);
  const output = Number(raw.output ?? 0);
  const cacheRead = Number(raw.cacheRead ?? 0);
  const cacheWrite = Number(raw.cacheWrite ?? 0);
  return {
    key: String(raw.key ?? ''),
    events: Number(raw.events ?? 0),
    input,
    output,
    cacheRead,
    cacheWrite,
    tokens: input + output + cacheRead + cacheWrite,
    cost: round6(Number(raw.cost ?? 0)),
    unpriced: Number(raw.unpriced ?? 0),
  };
}

/** 按维度聚合某个月的消耗。 */
export function aggregate(db: DatabaseSync, month: string, by: GroupBy): AggregateRow[] {
  const col = GROUP_COLUMNS[by];
  const order = by === 'day' ? 'key ASC' : 'SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) DESC';
  const rows = db
    .prepare(
      `SELECT ${col} AS key,
              COUNT(*) AS events,
              SUM(input_tokens) AS input,
              SUM(output_tokens) AS output,
              SUM(cache_read_tokens) AS cacheRead,
              SUM(cache_write_tokens) AS cacheWrite,
              SUM(cost_usd) AS cost,
              SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM events
        WHERE month = ?
        GROUP BY key
        ORDER BY ${order}`,
    )
    .all(month) as Record<string, unknown>[];
  return rows.map(toAggregateRow);
}

/** 某月总计。 */
export function totals(db: DatabaseSync, month: string): Totals {
  const raw = db
    .prepare(
      `SELECT COUNT(*) AS events,
              COALESCE(SUM(input_tokens), 0) AS input,
              COALESCE(SUM(output_tokens), 0) AS output,
              COALESCE(SUM(cache_read_tokens), 0) AS cacheRead,
              COALESCE(SUM(cache_write_tokens), 0) AS cacheWrite,
              COALESCE(SUM(cost_usd), 0) AS cost,
              COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced
         FROM events WHERE month = ?`,
    )
    .get(month) as Record<string, unknown>;
  return toAggregateRow({ key: month, ...raw });
}

export interface DetailRow {
  day: string;
  model: string;
  project: string;
  source: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  unpriced: number;
}

/** 按 天 × 模型 × 项目 × 来源 的明细聚合，供 CSV / Markdown 导出。 */
export function detailRows(db: DatabaseSync, month: string): DetailRow[] {
  const rows = db
    .prepare(
      `SELECT day, model, COALESCE(NULLIF(project, ''), '(未标注)') AS project, source,
              COUNT(*) AS calls,
              SUM(input_tokens) AS input,
              SUM(output_tokens) AS output,
              SUM(cache_read_tokens) AS cacheRead,
              SUM(cache_write_tokens) AS cacheWrite,
              SUM(cost_usd) AS cost,
              SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
         FROM events
        WHERE month = ?
        GROUP BY day, model, project, source
        ORDER BY day ASC, SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) DESC`,
    )
    .all(month) as Record<string, unknown>[];

  return rows.map((raw) => {
    const input = Number(raw.input ?? 0);
    const output = Number(raw.output ?? 0);
    const cacheRead = Number(raw.cacheRead ?? 0);
    const cacheWrite = Number(raw.cacheWrite ?? 0);
    return {
      day: String(raw.day ?? ''),
      model: String(raw.model ?? ''),
      project: String(raw.project ?? ''),
      source: String(raw.source ?? ''),
      calls: Number(raw.calls ?? 0),
      input,
      output,
      cacheRead,
      cacheWrite,
      tokens: input + output + cacheRead + cacheWrite,
      cost: Number(raw.cost ?? 0),
      unpriced: Number(raw.unpriced ?? 0),
    };
  });
}

/** 未定价的模型及其记录数（用于提示补价格表）。 */
export function unpricedModels(db: DatabaseSync, month: string): { model: string; count: number }[] {
  const rows = db
    .prepare(
      `SELECT model, COUNT(*) AS count FROM events
        WHERE month = ? AND cost_usd IS NULL
        GROUP BY model ORDER BY count DESC`,
    )
    .all(month) as Record<string, unknown>[];
  return rows.map((r) => ({ model: String(r.model), count: Number(r.count) }));
}

/** 账本里出现过的月份，倒序。 */
export function listMonths(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT DISTINCT month FROM events ORDER BY month DESC').all() as Record<string, unknown>[];
  return rows.map((r) => String(r.month));
}

export function eventCount(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number };
  return Number(row.c ?? 0);
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? String(row.value) : null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
