import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSchema } from '../src/core/db.ts';
import {
  aggregate,
  detailRows,
  eventCount,
  insertEvents,
  listMonths,
  totals,
  unpricedModels,
} from '../src/core/ledger.ts';
import type { UsageEvent } from '../src/core/types.ts';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  return db;
}

function ev(overrides: Partial<UsageEvent> & { id: string; ts: string }): UsageEvent {
  return {
    source: 'claude-code',
    provider: 'anthropic',
    model: 'claude-opus',
    project: 'alpha',
    sessionId: 's1',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: null,
    ...overrides,
  };
}

const SAMPLE: UsageEvent[] = [
  ev({ id: 'e1', ts: '2026-11-02T01:00:00.000Z', inputTokens: 1000, outputTokens: 500, costUsd: 0.1 }),
  ev({ id: 'e2', ts: '2026-11-02T02:00:00.000Z', model: 'gpt-4o', project: 'beta', inputTokens: 200, costUsd: 0.02 }),
  ev({ id: 'e3', ts: '2026-11-03T01:00:00.000Z', model: 'unknown-x', project: null, inputTokens: 50, costUsd: null }),
  ev({ id: 'e4', ts: '2026-10-30T01:00:00.000Z', inputTokens: 999, costUsd: 9 }),
];

test('入库幂等：同一批事件插两次只记一次', () => {
  const db = makeDb();
  assert.equal(insertEvents(db, SAMPLE), 4);
  assert.equal(insertEvents(db, SAMPLE), 0);
  assert.equal(eventCount(db), 4);
});

test('按月统计：cost 为 null 的记录不污染总额，但会被计数', () => {
  const db = makeDb();
  insertEvents(db, SAMPLE);

  const nov = totals(db, '2026-11');
  assert.equal(nov.events, 3);
  assert.equal(nov.input, 1250);
  assert.equal(nov.tokens, 1750);
  assert.equal(nov.cost, 0.12); // 0.1 + 0.02，unknown-x 贡献 0
  assert.equal(nov.unpriced, 1);

  assert.equal(totals(db, '2026-10').events, 1);
  assert.equal(totals(db, '2025-01').events, 0);
});

test('按模型 / 项目聚合，空项目归入 (未标注)', () => {
  const db = makeDb();
  insertEvents(db, SAMPLE);

  const byModel = aggregate(db, '2026-11', 'model');
  assert.deepEqual(
    byModel.map((r) => r.key).sort(),
    ['claude-opus', 'gpt-4o', 'unknown-x'].sort(),
  );
  const opus = byModel.find((r) => r.key === 'claude-opus');
  assert.ok(opus);
  assert.equal(opus.tokens, 1500);
  assert.equal(opus.events, 1);

  const byProject = aggregate(db, '2026-11', 'project');
  const keys = byProject.map((r) => r.key);
  assert.ok(keys.includes('alpha'));
  assert.ok(keys.includes('(未标注)'));
});

test('明细导出保留四个维度', () => {
  const db = makeDb();
  insertEvents(db, SAMPLE);
  const rows = detailRows(db, '2026-11');
  assert.equal(rows.length, 3);
  const first = rows[0];
  assert.equal(first.day, '2026-11-02');
  assert.equal(first.model, 'claude-opus');
  assert.equal(first.project, 'alpha');
  assert.equal(first.source, 'claude-code');
  assert.equal(first.tokens, 1500);
});

test('未定价模型清单 + 月份列表', () => {
  const db = makeDb();
  insertEvents(db, SAMPLE);

  const unpriced = unpricedModels(db, '2026-11');
  assert.deepEqual(unpriced, [{ model: 'unknown-x', count: 1 }]);
  assert.deepEqual(listMonths(db), ['2026-11', '2026-10']);
});
