import type { DatabaseSync } from 'node:sqlite';
import { isoToLocalDay } from '../util/format.ts';

/**
 * 建表与迁移逻辑单独放在这里，**不依赖任何具体数据库驱动**。
 * CLI 用 node:sqlite，Electron 用 better-sqlite3，两边共用同一份 schema / 迁移。
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id                 TEXT PRIMARY KEY,
  ts                 TEXT NOT NULL,
  day                TEXT NOT NULL,
  month              TEXT NOT NULL,
  source             TEXT NOT NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  project            TEXT,
  session_id         TEXT,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL
);
CREATE INDEX IF NOT EXISTS idx_events_month ON events(month);
CREATE INDEX IF NOT EXISTS idx_events_month_model ON events(month, model);

CREATE TABLE IF NOT EXISTS files (
  path            TEXT PRIMARY KEY,
  mtime_ms        INTEGER NOT NULL,
  size            INTEGER NOT NULL,
  events_inserted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budgets (
  month    TEXT PRIMARY KEY,
  amount   REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** 尽量小的语句接口：node:sqlite 与 better-sqlite3 都满足。 */
export interface DbStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

/** 尽量小的数据库接口：node:sqlite 与 better-sqlite3 都满足。 */
export interface DbLike {
  exec(sql: string): unknown;
  prepare(sql: string): DbStatement;
}

/** 建表（幂等）。 */
export function createSchema(db: DbLike): void {
  db.exec(SCHEMA);
}

/**
 * 历史迁移（幂等，靠 PRAGMA user_version 记录版本）。
 *
 * v0：`day` / `month` 存的是 **UTC 日期**（直接截 ISO 前 10 位）。
 * 在 UTC+8 下，本地 00:00–08:00 的记录会落到前一天，跨月时甚至落到上个月。
 * v1：按**本地时区**重算 day / month。
 *
 * @returns 被修正的记录条数
 */
export function migrate(db: DbLike): number {
  const versionRow = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  const version = Number(versionRow?.user_version ?? 0);
  if (version >= 1) return 0;

  const rows = db.prepare('SELECT id, ts, day, month FROM events').all() as {
    id: string;
    ts: string;
    day: string;
    month: string;
  }[];

  let fixed = 0;
  if (rows.length > 0) {
    const stmt = db.prepare('UPDATE events SET day = ?, month = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
      for (const record of rows) {
        const day = isoToLocalDay(record.ts);
        if (day === '') continue;
        const month = day.slice(0, 7);
        if (day !== record.day || month !== record.month) {
          stmt.run(day, month, record.id);
          fixed += 1;
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  db.exec('PRAGMA user_version = 1');
  return fixed;
}

/** 仅为类型复用：CLI 侧传入的还是 node:sqlite 的实例。 */
export type { DatabaseSync };
