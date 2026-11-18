import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderCsv, renderMarkdown } from '../src/output/markdown.ts';
import { renderReport } from '../src/output/report.ts';
import type { ReportData } from '../src/output/report.ts';
import { displayWidth, renderTable } from '../src/output/table.ts';
import { renderRice } from '../src/output/rice.ts';
import type { AggregateRow, Totals } from '../src/core/types.ts';
import type { DetailRow } from '../src/core/ledger.ts';

const totals: Totals = {
  events: 3,
  input: 1000,
  output: 500,
  cacheRead: 2000,
  cacheWrite: 300,
  tokens: 3800,
  cost: 0.42,
  unpriced: 0,
};

const modelRow: AggregateRow = {
  key: 'claude-opus-5-5',
  events: 3,
  input: 1000,
  output: 500,
  cacheRead: 2000,
  cacheWrite: 300,
  tokens: 3800,
  cost: 0.42,
  unpriced: 0,
};

function data(overrides: Partial<ReportData> = {}): ReportData {
  return {
    label: '2026-11',
    totals,
    byModel: [modelRow],
    byDay: [{ ...modelRow, key: '2026-11-02' }],
    byProject: [{ ...modelRow, key: 'alpha' }],
    budget: {
      month: '2026-11',
      budget: 50,
      spent: 0.42,
      remaining: 49.58,
      daysInMonth: 30,
      daysLeft: 11,
      dailyAllowance: 4.507272727272727,
      overBudget: false,
      hasBudget: true,
    },
    unpriced: [],
    ...overrides,
  };
}

test('中文按双宽计算，表格不错位', () => {
  assert.equal(displayWidth('白饭'), 4);
  assert.equal(displayWidth('abc'), 3);

  const table = renderTable(['名', '值'], [['白饭', '1']]);
  const widths = table.split('\n').map((line) => displayWidth(line));
  assert.equal(new Set(widths).size, 1, '每行显示宽度应一致');
});

test('report 包含各分区与预算信息', () => {
  const out = renderReport(data());
  assert.match(out, /Token 账本 · 2026-11/);
  assert.match(out, /按模型/);
  assert.match(out, /按项目/);
  assert.match(out, /按天/);
  assert.match(out, /claude-opus-5-5/);
  assert.match(out, /每天还能吃/);
});

test('空月份给出下一步指引，而不是空白', () => {
  const out = renderReport(
    data({
      totals: { ...totals, events: 0, tokens: 0, cost: 0 },
      byModel: [],
      byDay: [],
      byProject: [],
    }),
  );
  assert.match(out, /这个区间还没有任何记录/);
  assert.match(out, /token-ledger scan/);
});

test('未定价模型会给出补价格提示', () => {
  const out = renderReport(data({ unpriced: [{ model: 'claude-opus-5-5', count: 3 }] }));
  assert.match(out, /无价格/);
  assert.match(out, /prices\.json/);
});

test('markdown 导出含标题、表格与免责声明', () => {
  const md = renderMarkdown({
    label: '2026-11',
    totals,
    byModel: [modelRow],
    byProject: [{ ...modelRow, key: 'alpha' }],
    budget: { hasBudget: true, budget: 50, spent: 0.42, remaining: 49.58 },
  });
  assert.match(md, /^# Token 账本 · 2026-11/m);
  assert.match(md, /\| 模型 \|/);
  assert.match(md, /估算值/);
});

test('CSV 对含逗号的字段做转义', () => {
  const row: DetailRow = {
    day: '2026-11-02',
    model: 'weird,model',
    project: 'a"b',
    source: 'claude-code',
    calls: 1,
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    tokens: 15,
    cost: 0.01,
    unpriced: 0,
  };
  const csv = renderCsv([row]);
  assert.ok(csv.split('\n')[1].startsWith('2026-11-02,"weird,model","a""b"'));
});

test('白饭彩蛋按 1M tokens 一碗换算', () => {
  const out = renderRice('2026-11', 3_500_000);
  assert.match(out, /3\.5 碗/);
  assert.match(out, /🍚/);
});
