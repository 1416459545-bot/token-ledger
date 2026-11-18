import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isoToLocalDay } from '../util/format.ts';
import { ledgerHome } from '../util/home.ts';

const SCHEMA = `
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

/** 建表（幂等）。单独导出，方便测试用内存库。 */
export function createSchema(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

export function dbFile(dir: string = ledgerHome()): string {
  return path.join(dir, 'ledger.db');
}

/** 打开（必要时创建）账本数据库。 */
export function openDb(dir: string = ledgerHome()): DatabaseSync {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbFile(dir));
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // 某些文件系统不支持 WAL，降级即可，不影响正确性
  }
  createSchema(db);
  migrate(db);
  return db;
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
export function migrate(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
  const version = Number(row?.user_version ?? 0);
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
