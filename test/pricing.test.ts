import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_PRICES, costOf, normalizeModel, resolvePrice } from '../src/core/pricing.ts';

test('normalizeModel 洗掉 provider 前缀、版本号与日期后缀', () => {
  assert.equal(normalizeModel('anthropic/claude-opus-5-5-20251101'), 'claude-opus-5-5');
  assert.equal(normalizeModel('gpt-4o@2024-08-06'), 'gpt-4o');
  assert.equal(normalizeModel('  Claude-Sonnet-4-5  '), 'claude-sonnet-4-5');
  assert.equal(normalizeModel('deepseek-chat-2025-01-20'), 'deepseek-chat');
  assert.equal(normalizeModel(''), '');
});

test('精确命中优先于模型族近似', () => {
  const exact = resolvePrice('claude-opus', BUILTIN_PRICES);
  assert.ok(exact);
  assert.equal(exact.exact, true);
  assert.equal(exact.key, 'claude-opus');

  const approx = resolvePrice('claude-opus-5-5', BUILTIN_PRICES);
  assert.ok(approx);
  assert.equal(approx.exact, false);
  assert.equal(approx.key, 'claude-opus');
});

test('最长匹配：gpt-4o-mini 不会被 gpt-4o 抢走', () => {
  const mini = resolvePrice('gpt-4o-mini-2024-07-18', BUILTIN_PRICES);
  assert.ok(mini);
  assert.equal(mini.key, 'gpt-4o-mini');

  const full = resolvePrice('gpt-4o', BUILTIN_PRICES);
  assert.ok(full);
  assert.equal(full.key, 'gpt-4o');
});

test('未知模型返回 null，不瞎猜价格', () => {
  assert.equal(resolvePrice('totally-unknown-model-9000', BUILTIN_PRICES), null);
  assert.equal(resolvePrice('', BUILTIN_PRICES), null);
});

test('边界匹配不会把 o3 命中到 foo3 里', () => {
  assert.equal(resolvePrice('foo3', BUILTIN_PRICES), null);
  assert.ok(resolvePrice('o3', BUILTIN_PRICES));
});

test('计费公式：按每百万 tokens 换算，保留 6 位小数', () => {
  const price = { provider: 'test', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  const cost = costOf({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, price);
  assert.equal(cost, 3);

  const mixed = costOf({ input: 500_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 200_000 }, price);
  // 0.5*3 + 0.1*15 + 1*0.3 + 0.2*3.75 = 1.5 + 1.5 + 0.3 + 0.75 = 4.05
  assert.equal(mixed, 4.05);
});
