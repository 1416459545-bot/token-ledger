import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { parseImportFile, parseImportLine } from '../src/sources/generic.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'generic');
const FILE = path.join(FIXTURES, 'usage.jsonl');

test('解析通用 JSONL：注释行忽略、坏行与缺字段跳过、重复去重', () => {
  const { events, stats } = parseImportFile(FILE);

  assert.equal(stats.lines, 7); // 注释行不计入
  assert.equal(stats.events, 3); // 三条有效；第 8 行是重复，被静默去重（不计入 skipped）
  assert.equal(stats.skipped, 3); // 坏 JSON / 零消耗 / 缺时间戳
  assert.equal(events.length, 3);

  const first = events[0];
  assert.equal(first.source, 'import');
  assert.equal(first.model, 'gpt-4o');
  assert.equal(first.provider, 'openai');
  assert.equal(first.project, 'alpha');
  assert.equal(first.inputTokens, 1000);
  assert.equal(first.outputTokens, 500);
  assert.equal(first.costUsd, null);
});

test('同时接受 camelCase 字段', () => {
  const { events } = parseImportFile(FILE);
  const second = events[1];
  assert.equal(second.inputTokens, 200);
  assert.equal(second.outputTokens, 100);
  assert.equal(second.cacheReadTokens, 50);
  assert.equal(second.provider, 'unknown');
});

test('带时区的时间戳会被归一化为 UTC ISO', () => {
  const { events } = parseImportFile(FILE);
  const third = events[2];
  assert.ok(third.ts.startsWith('2026-11-10T16:00:00')); // +08:00 的 11-11 00:00
});

test('--project 覆盖只作用于没有 project 字段的行', () => {
  const { events } = parseImportFile(FILE, 'my-project');
  assert.equal(events[0].project, 'alpha'); // 自带 project 优先
  assert.equal(events[1].project, 'my-project');
});

test('重复导入同一个文件产生完全相同的 id（幂等）', () => {
  const a = parseImportFile(FILE);
  const b = parseImportFile(FILE);
  assert.deepEqual(
    a.events.map((e) => e.id),
    b.events.map((e) => e.id),
  );
});

test('单行解析：缺 model / 零消耗 / 非法时间都返回 null', () => {
  assert.equal(parseImportLine({ ts: '2026-11-10T10:00:00Z', input_tokens: 5, output_tokens: 5 }), null);
  assert.equal(parseImportLine({ ts: '2026-11-10T10:00:00Z', model: 'm', input_tokens: 0 }), null);
  assert.equal(parseImportLine({ ts: 'not a date', model: 'm', input_tokens: 5 }), null);
  assert.equal(parseImportLine(null), null);
  assert.equal(parseImportLine([1, 2]), null);
});
