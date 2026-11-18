import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSchema } from '../src/core/db.ts';
import {
  insertEvents,
  listEventsRange,
  monthlyTotals,
  totalsRange,
  unpricedModelsRange,
} from '../src/core/ledger.ts';
import type { UsageEvent } from '../src/core/types.ts';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  return db;
}

function ev(id: string, ts: string, overrides: Partial<UsageEvent> = {}): UsageEvent {
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
    ...overrides,
  };
}

const EVENTS: UsageEvent[] = [
  ev('e1', '2026-10-30T10:00:00.000Z', { inputTokens: 1000 }),
  ev('e2', '2026-11-02T10:00:00.000Z', { inputTokens: 100 }),
  ev('e3', '2026-11-15T23:00:00.000Z', { inputTokens: 200 }),
  ev('e4', '2026-11-16T01:00:00.000Z', { inputTokens: 300, costUsd: null, model: 'mystery' }),
];

test('区间统计只包含区间内的事件（边界闭区间）', () => {
  const db = makeDb();
  insertEvents(db, EVENTS);

  const firstHalf = totalsRange(db, { start: '2026-11-01', end: '2026-11-15' });
  assert.equal(firstHalf.events, 2);
  assert.equal(firstHalf.input, 300);

  const inclusive = totalsRange(db, { start: '2026-11-15', end: '2026-11-16' });
  assert.equal(inclusive.events, 2);
  assert.equal(inclusive.unpriced, 1);
});

test('跨月区间能同时覆盖两个月', () => {
  const db = makeDb();
  insertEvents(db, EVENTS);

  const range = totalsRange(db, { start: '2026-10-01', end: '2026-11-30' });
  assert.equal(range.events, 4);
  assert.equal(range.input, 1600);
});

test('月度趋势按月份升序返回', () => {
  const db = makeDb();
  insertEvents(db, EVENTS);

  const trend = monthlyTotals(db, 6);
  assert.equal(trend.length, 2);
  assert.deepEqual(
    trend.map((row) => row.month),
    ['2026-10', '2026-11'],
  );
  assert.equal(trend[1].events, 3);
  assert.equal(trend[1].tokens, 100 + 10 + 200 + 10 + 300 + 10);
});

test('区间内的事件按时间升序导出', () => {
  const db = makeDb();
  insertEvents(db, EVENTS);

  const rows = listEventsRange(db, { start: '2026-11-01', end: '2026-11-30' });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['e2', 'e3', 'e4'],
  );
  assert.equal(rows[2].costUsd, null);
  assert.equal(rows[2].model, 'mystery');
});

test('区间内的未定价模型', () => {
  const db = makeDb();
  insertEvents(db, EVENTS);

  assert.deepEqual(unpricedModelsRange(db, { start: '2026-11-01', end: '2026-11-30' }), [
    { model: 'mystery', count: 1 },
  ]);
  assert.deepEqual(unpricedModelsRange(db, { start: '2026-10-01', end: '2026-10-31' }), []);
});
