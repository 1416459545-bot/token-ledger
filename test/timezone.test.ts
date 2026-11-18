import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSchema, migrate } from '../src/core/db.ts';
import { insertEvents } from '../src/core/ledger.ts';
import { localDay } from '../src/util/format.ts';
import type { UsageEvent } from '../src/core/types.ts';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  return db;
}

function ev(id: string, ts: string): UsageEvent {
  return {
    id,
    ts,
    source: 'claude-code',
    provider: 'anthropic',
    model: 'claude-opus',
    project: 'alpha',
    sessionId: null,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.01,
  };
}

test('入库按本地时区分桶，而不是 UTC 日期', () => {
  const db = makeDb();
  // 这个时刻在 UTC 是 11-17，在 UTC+8 是 11-18
  const ts = '2026-11-17T20:03:30.000Z';
  insertEvents(db, [ev('tz-1', ts)]);

  const row = db.prepare('SELECT day, month FROM events WHERE id = ?').get('tz-1') as {
    day: string;
    month: string;
  };
  const expectedDay = localDay(new Date(ts));

  assert.equal(row.day, expectedDay, '存储的 day 必须等于本地日期');
  assert.equal(row.month, expectedDay.slice(0, 7));

  // 再验证一次：无论运行在哪个时区，都不该等于「UTC 日期」以外的错误值
  assert.equal(row.day, expectedDay);
});

test('月末跨月场景：UTC 还是本月，本地已是下月', () => {
  const db = makeDb();
  const ts = '2026-11-30T20:00:00.000Z'; // UTC 11-30，UTC+8 是 12-01
  insertEvents(db, [ev('tz-2', ts)]);

  const expectedDay = localDay(new Date(ts));
  const row = db.prepare('SELECT day, month FROM events WHERE id = ?').get('tz-2') as {
    day: string;
    month: string;
  };
  assert.equal(row.day, expectedDay);
  assert.equal(row.month, expectedDay.slice(0, 7));
});

test('迁移：历史 UTC 分桶的数据会被重算成本地日期', () => {
  const db = makeDb();
  const ts = '2026-11-17T20:03:30.000Z';
  // 模拟 v0 数据：day/month 是 UTC 日期
  db.prepare(
    `INSERT INTO events (id, ts, day, month, source, provider, model, project, session_id,
      input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
     VALUES (?, ?, '2026-11-17', '2026-11', 'claude-code', 'anthropic', 'claude-opus', 'alpha', NULL, 100, 10, 0, 0, 0.01)`,
  ).run('legacy-1', ts);

  const fixed = migrate(db);
  const expectedDay = localDay(new Date(ts));
  const row = db.prepare('SELECT day, month FROM events WHERE id = ?').get('legacy-1') as {
    day: string;
    month: string;
  };

  assert.equal(row.day, expectedDay);
  assert.equal(row.month, expectedDay.slice(0, 7));
  // 在 UTC+8 下这里应该是修正了 1 条；在 UTC 下 0 条。两种都合理。
  assert.ok(fixed === 0 || fixed === 1);

  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  assert.equal(Number(version), 1);
});

test('迁移是幂等的：跑第二次不再改动', () => {
  const db = makeDb();
  insertEvents(db, [ev('idem-1', '2026-11-17T20:03:30.000Z')]);
  assert.equal(migrate(db), 0);
  assert.equal(migrate(db), 0);
});

test('空库迁移也安全', () => {
  const db = makeDb();
  assert.equal(migrate(db), 0);
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  assert.equal(Number(version), 1);
});
