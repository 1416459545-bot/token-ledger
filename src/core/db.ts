import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ledgerHome } from '../util/home.ts';
import { createSchema, migrate } from './schema.ts';

// 建表与迁移逻辑在 schema.ts（不绑定驱动），这里只负责「用 node:sqlite 打开」
export { createSchema, migrate, SCHEMA } from './schema.ts';

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
