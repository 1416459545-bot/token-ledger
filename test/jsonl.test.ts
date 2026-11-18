import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSchema } from '../src/core/db.ts';
import { insertEvents, listEventsRange, totalsRange } from '../src/core/ledger.ts';
import type { UsageEvent } from '../src/core/types.ts';
import { renderJsonl } from '../src/output/jsonl.ts';
import { parseImportFile } from '../src/sources/generic.ts';

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
    sessionId: 's1',
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 5,
    cacheWriteTokens: 0,
    costUsd: 0.01,
    ...overrides,
  };
}

const EVENTS: UsageEvent[] = [
  ev('e1', '2026-11-02T10:00:00.000Z'),
  ev('e2', '2026-11-03T10:00:00.000Z', { source: 'codex', provider: 'openai', model: 'gpt-5' }),
];

test('导出的 JSONL 只含 token 与元数据，不含任何正文', () => {
  const jsonl = renderJsonl(EVENTS);
  const lines = jsonl.split('\n');
  assert.equal(lines.length, 2);

  const allowed = new Set([
    'ts',
    'source',
    'provider',
    'model',
    'project',
    'session_id',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_write_tokens',
  ]);
  for (const line of lines) {
    const obj = JSON.parse(line) as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      assert.ok(allowed.has(key), `导出字段 ${key} 不在允许列表里`);
    }
  }
});

test('导出 → 导入：来源与用量都保留，重复导入不重复入库', () => {
  const source = makeDb();
  insertEvents(source, EVENTS);
  const jsonl = renderJsonl(listEventsRange(source, { start: '2026-11-01', end: '2026-11-30' }));

  const file = path.join(os.tmpdir(), `token-ledger-jsonl-${process.pid}-${Date.now()}.jsonl`);
  fs.writeFileSync(file, jsonl, 'utf8');

  try {
    const parsed = parseImportFile(file);
    assert.equal(parsed.events.length, 2);
    assert.deepEqual(
      [...new Set(parsed.events.map((event) => event.source))].sort(),
      ['claude-code', 'codex'],
    );

    const target = makeDb();
    assert.equal(insertEvents(target, parsed.events), 2);
    assert.equal(insertEvents(target, parsed.events), 0, '同一份文件再导入不应新增');

    const range = { start: '2026-11-01', end: '2026-11-30' };
    const before = totalsRange(source, range);
    const after = totalsRange(target, range);
    assert.equal(after.events, before.events);
    assert.equal(after.tokens, before.tokens);
    assert.equal(after.input, before.input);
    assert.equal(after.cacheRead, before.cacheRead);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('合并两个账本：总量等于两者之和', () => {
  const machineA = makeDb();
  const machineB = makeDb();
  insertEvents(machineA, [ev('a1', '2026-11-02T10:00:00.000Z')]);
  insertEvents(machineB, [ev('b1', '2026-11-05T10:00:00.000Z', { inputTokens: 200 })]);

  const range = { start: '2026-11-01', end: '2026-11-30' };
  const exportedA = parseImportFile(
    (() => {
      const file = path.join(os.tmpdir(), `tl-a-${process.pid}-${Date.now()}.jsonl`);
      fs.writeFileSync(file, renderJsonl(listEventsRange(machineA, range)), 'utf8');
      return file;
    })(),
  );

  insertEvents(machineB, exportedA.events);

  const merged = totalsRange(machineB, range);
  assert.equal(merged.events, 2);
  assert.equal(merged.input, 300); // 100 + 200
});
