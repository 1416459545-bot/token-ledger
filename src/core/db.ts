import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  return db;
}
