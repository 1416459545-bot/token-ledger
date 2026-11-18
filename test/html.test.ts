import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeHtml, renderHtml } from '../src/output/html.ts';
import type { HtmlReportData } from '../src/output/html.ts';
import type { AggregateRow } from '../src/core/types.ts';

const row: AggregateRow = {
  key: 'claude-opus-5-5',
  events: 3,
  input: 1000,
  output: 500,
  cacheRead: 200,
  cacheWrite: 0,
  tokens: 1700,
  cost: 0.42,
  unpriced: 0,
};

function data(overrides: Partial<HtmlReportData> = {}): HtmlReportData {
  return {
    label: '2026-11',
    generatedAt: '2026-11-17 20:30:00',
    totals: {
      events: 3,
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 0,
      tokens: 1700,
      cost: 0.42,
      unpriced: 0,
    },
    byModel: [row],
    byDay: [
      { ...row, key: '2026-11-02', tokens: 400 },
      { ...row, key: '2026-11-03', tokens: 1300 },
    ],
    byProject: [{ ...row, key: 'alpha' }],
    bySource: [{ ...row, key: 'claude-code' }],
    budget: {
      month: '2026-11',
      budget: 50,
      spent: 0.42,
      remaining: 49.58,
      daysInMonth: 30,
      daysLeft: 11,
      dailyAllowance: 4.5,
      overBudget: false,
      hasBudget: true,
    },
    unpriced: [],
    ...overrides,
  };
}

test('生成的是一份完整、自包含的 HTML', () => {
  const html = renderHtml(data());
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /Token 账本 · 2026-11/);
  assert.match(html, /claude-opus-5-5/);
  assert.match(html, /每日用量/);
  assert.match(html, /按模型/);
  assert.match(html, /按项目/);
  assert.match(html, /按数据源/);
});

test('不含任何外部资源（断网也能看）', () => {
  const html = renderHtml(data());
  assert.ok(!/<script[^>]*src=/i.test(html), '不应有外部脚本');
  assert.ok(!/<link[^>]*href=/i.test(html), '不应有外部样式表');
  assert.ok(!/<(img|iframe|video|audio)[^>]*(src|srcset)=/i.test(html), '不应有外部媒体');
  const urls = html.match(/https?:\/\/[^\s"'<)]+/g) ?? [];
  assert.equal(urls.length, 0, `不应出现外部 URL，实际：${urls.join(', ')}`);
});

test('模型名里的 HTML 被转义，不会注入', () => {
  const evil = { ...row, key: '<script>alert(1)</script>' };
  const html = renderHtml(data({ byModel: [evil] }));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('escapeHtml 处理五个特殊字符', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('每天一个柱子，高度按占比计算', () => {
  const html = renderHtml(data());
  const bars = html.match(/class="bar-col"/g) ?? [];
  assert.equal(bars.length, 2);
  // 1300 / 1300 = 100%
  assert.match(html, /style="height:100%"/);
});

test('没有数据时给出指引而不是空白页', () => {
  const html = renderHtml(
    data({
      totals: { ...data().totals, events: 0, tokens: 0, cost: 0 },
      byModel: [],
      byDay: [],
      byProject: [],
      bySource: [],
    }),
  );
  assert.match(html, /这个区间还没有任何记录/);
  assert.match(html, /token-ledger scan/);
});

test('没设预算时不渲染预算区块', () => {
  const html = renderHtml(
    data({ budget: { ...data().budget, hasBudget: false, budget: 0, remaining: 0 } }),
  );
  assert.ok(!html.includes('预算剩余'));
  assert.ok(!html.includes('<h2>预算</h2>'));
});

test('超支时会显示警告', () => {
  const html = renderHtml(
    data({ budget: { ...data().budget, budget: 1, spent: 2, remaining: -1, overBudget: true } }),
  );
  assert.match(html, /已超支/);
});

test('未定价模型会在页面上提示', () => {
  const html = renderHtml(data({ unpriced: [{ model: 'mystery-model', count: 2 }] }));
  assert.match(html, /mystery-model/);
  assert.match(html, /没有价格/);
});
