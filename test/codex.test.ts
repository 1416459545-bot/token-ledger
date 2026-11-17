import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  defaultCodexRoot,
  findRolloutFiles,
  parseCodexFile,
  readUsageTotals,
} from '../src/sources/codex.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'codex', 'sessions');
const FILE = path.join(FIXTURES, '2026', '11', '17', 'rollout-2026-11-17T20-03-19-test.jsonl');

test('解析 Codex rollout：按累计值差分，重复的 token_count 不会重复计账', () => {
  const { events, stats } = parseCodexFile(FILE);

  assert.equal(stats.lines, 8);
  assert.equal(events.length, 2); // 第 3 次 token_count 是重复累计值（差分为 0），第 4 次 info 为 null

  const first = events[0];
  assert.equal(first.source, 'codex');
  assert.equal(first.provider, 'openai');
  assert.equal(first.model, 'gpt-5.1-codex-max');
  assert.equal(first.project, 'codexproj'); // 从 cwd 的反斜杠路径推出
  assert.equal(first.sessionId, '01a1e963-e13f-7972-9057-41eb1158aa74');
  // input_tokens 1000 含缓存 200 + 缓存写入 100，拆成普通输入 700
  assert.equal(first.inputTokens, 700);
  assert.equal(first.cacheReadTokens, 200);
  assert.equal(first.cacheWriteTokens, 100);
  assert.equal(first.outputTokens, 300);
  assert.equal(first.costUsd, null);
});

test('第二次 token_count 只取增量，不累加', () => {
  const { events } = parseCodexFile(FILE);
  const second = events[1];
  // 累计 1500/300/100/400 减去上一次 1000/200/100/300
  assert.equal(second.inputTokens, 400); // 500 - 100 缓存
  assert.equal(second.cacheReadTokens, 100);
  assert.equal(second.cacheWriteTokens, 0);
  assert.equal(second.outputTokens, 100);
});

test('重复解析同一文件得到相同事件 id（幂等）', () => {
  const a = parseCodexFile(FILE);
  const b = parseCodexFile(FILE);
  assert.deepEqual(
    a.events.map((e) => e.id),
    b.events.map((e) => e.id),
  );
});

test('findRolloutFiles 递归找到会话文件', () => {
  const files = findRolloutFiles(FIXTURES);
  assert.equal(files.length, 1);
  assert.ok(files[0].endsWith('.jsonl'));
});

test('readUsageTotals 拒绝空 / 无效对象', () => {
  assert.equal(readUsageTotals(null), null);
  assert.equal(readUsageTotals({}), null);
  assert.equal(readUsageTotals({ input_tokens: 0, output_tokens: 0 }), null);
  const totals = readUsageTotals({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 });
  assert.deepEqual(totals, {
    inputTokens: 10,
    cachedInputTokens: 2,
    cacheWriteInputTokens: 0,
    outputTokens: 5,
  });
});

test('文件不存在时安静返回空结果', () => {
  const { events, stats } = parseCodexFile(path.join(FIXTURES, 'nope.jsonl'));
  assert.equal(events.length, 0);
  assert.equal(stats.lines, 0);
});

test('默认根目录可用环境变量覆盖', () => {
  assert.ok(defaultCodexRoot().includes('.codex'));
});
