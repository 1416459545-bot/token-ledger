import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { cacheWriteTokensOf, parseClaudeFile, parseClaudeLine, projectOf } from '../src/sources/claude.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'claude');

test('解析一个真实形状的会话文件：跳过无关行、去重、兼容新版缓存字段', () => {
  const file = path.join(FIXTURES, 'proj-alpha', 'session-1.jsonl');
  const { events, stats } = parseClaudeFile(file);

  assert.equal(stats.lines, 7);
  assert.equal(stats.skipped, 4); // user / synthetic / 坏 json / summary
  assert.equal(events.length, 2); // msg_001 去重后 + msg_002

  const first = events[0];
  assert.equal(first.id, 'claude-code:msg_001');
  assert.equal(first.model, 'claude-opus-5-5');
  assert.equal(first.inputTokens, 1000);
  assert.equal(first.outputTokens, 500);
  assert.equal(first.cacheReadTokens, 2000);
  assert.equal(first.cacheWriteTokens, 300); // 取自 cache_creation 明细对象
  assert.equal(first.project, 'alpha');
  assert.equal(first.sessionId, 's1');
  assert.equal(first.costUsd, null);

  const second = events[1];
  assert.equal(second.id, 'claude-code:msg_002');
  assert.equal(second.cacheWriteTokens, 2500); // 扁平字段优先
  assert.ok(second.ts.startsWith('2026-11-03'));
});

test('<synthetic> 与零消耗消息不记账', () => {
  const synthetic = {
    type: 'assistant',
    timestamp: '2026-11-02T00:00:00.000Z',
    message: { id: 'm1', model: '<synthetic>', usage: { input_tokens: 10, output_tokens: 10 } },
  };
  assert.equal(parseClaudeLine(synthetic, 'x.jsonl'), null);

  const zero = {
    type: 'assistant',
    timestamp: '2026-11-02T00:00:00.000Z',
    message: { id: 'm2', model: 'claude-opus', usage: { input_tokens: 0, output_tokens: 0 } },
  };
  assert.equal(parseClaudeLine(zero, 'x.jsonl'), null);

  const user = { type: 'user', timestamp: '2026-11-02T00:00:00.000Z', message: { content: 'hi' } };
  assert.equal(parseClaudeLine(user, 'x.jsonl'), null);
});

test('没有 cwd 时从会话目录名推断项目名', () => {
  assert.equal(projectOf(undefined, '/home/u/.claude/projects/C--work-gamma/session.jsonl'), 'gamma');
  assert.equal(projectOf('C:\\work\\alpha', '/whatever/session.jsonl'), 'alpha');
});

test('cache_creation 两种写法都能算对', () => {
  assert.equal(cacheWriteTokensOf({ cache_creation_input_tokens: 400 }), 400);
  assert.equal(
    cacheWriteTokensOf({ cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 50 } }),
    150,
  );
  assert.equal(cacheWriteTokensOf({}), 0);
});

test('第二个 fixture：另一个月、未定价模型', () => {
  const { events, stats } = parseClaudeFile(path.join(FIXTURES, 'C--work-gamma', 'session-2.jsonl'));
  assert.equal(stats.skipped, 0);
  assert.equal(events.length, 2);
  assert.equal(events[0].model, 'gpt-4o-mini');
  assert.equal(events[0].project, 'gamma');
  assert.ok(events[0].ts.startsWith('2026-10'));
});
