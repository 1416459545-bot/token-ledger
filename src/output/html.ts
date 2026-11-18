import type { BudgetStatus } from '../core/budget.ts';
import type { AggregateRow, Totals } from '../core/types.ts';
import { formatInt, formatTokens, formatUsd } from '../util/format.ts';

export interface HtmlReportData {
  /** 区间标签，例如 `2026-11` 或 `2026-11-01 ~ 2026-11-15` */
  label: string;
  generatedAt: string;
  totals: Totals;
  byModel: AggregateRow[];
  byDay: AggregateRow[];
  byProject: AggregateRow[];
  bySource: AggregateRow[];
  /** 只有统计区间恰好是完整自然月时才有预算信息 */
  budget: BudgetStatus | null;
  unpriced: { model: string; count: number }[];
  /** 近几个月的总量，用于趋势图（少于 2 个月不渲染） */
  trend?: { month: string; tokens: number; cost: number }[];
}

/** HTML 转义：模型名/项目名可能包含任意字符。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dayLabel(day: string): string {
  // 2026-11-02 -> 02
  const parts = day.split('-');
  return parts.length === 3 ? parts[2] : day;
}

const STYLE = `
:root { color-scheme: light dark; --bg:#fafafa; --fg:#111827; --muted:#6b7280; --line:#e5e7eb; --card:#ffffff; --accent:#16a34a; --accent-soft:#dcfce7; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d; --card:#161b22; --accent:#3fb950; --accent-soft:#12261a; }
}
* { box-sizing: border-box; }
body { margin:0; padding:32px 16px; background:var(--bg); color:var(--fg);
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
  line-height:1.5; }
main { max-width: 880px; margin: 0 auto; }
header h1 { margin:0 0 4px; font-size:26px; }
.sub { margin:0; color:var(--muted); font-size:14px; }
h2 { font-size:16px; margin:32px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--line); }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-top:24px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.card .k { font-size:12px; color:var(--muted); }
.card .v { font-size:22px; font-weight:600; margin-top:4px; font-variant-numeric:tabular-nums; }
.chart { display:flex; align-items:flex-end; justify-content:center; gap:6px; height:180px; padding:12px;
  background:var(--card); border:1px solid var(--line); border-radius:10px; }
.bar-col { flex:1; max-width:56px; display:flex; flex-direction:column; align-items:center;
  justify-content:flex-end; height:100%; min-width:0; }
.bar { width:100%; min-height:2px; background:var(--accent); border-radius:3px 3px 0 0; }
.bar-label { font-size:10px; color:var(--muted); margin-top:6px; }
table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line);
  border-radius:10px; overflow:hidden; font-size:14px; }
th, td { padding:8px 12px; text-align:right; border-bottom:1px solid var(--line); font-variant-numeric:tabular-nums; }
th:first-child, td:first-child { text-align:left; }
thead th { background:transparent; color:var(--muted); font-weight:600; letter-spacing:.02em; }
tbody tr:last-child td { border-bottom:none; }
.budget { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.track { height:8px; background:var(--line); border-radius:999px; overflow:hidden; }
.fill { height:100%; background:var(--accent); }
.budget p { margin:10px 0 0; font-size:14px; color:var(--muted); }
.hint { font-size:13px; color:var(--muted); }
footer { margin-top:40px; padding-top:16px; border-top:1px solid var(--line); font-size:12px; color:var(--muted); }
code { background:var(--accent-soft); padding:1px 5px; border-radius:4px; font-size:13px; }
`;

function table(headers: string[], rows: string[][]): string {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

/** 生成完全自包含的单文件 HTML 看板（无外部 CSS/JS/字体/图片）。 */
export function renderHtml(data: HtmlReportData): string {
  const { totals } = data;
  const maxDay = data.byDay.reduce((max, row) => Math.max(max, row.tokens), 0);

  const bars = data.byDay
    .map((row) => {
      const pct = maxDay > 0 ? Math.max(2, Math.round((row.tokens / maxDay) * 100)) : 0;
      const title = `${row.key} · ${formatTokens(row.tokens)} tokens · ${formatUsd(row.cost)}`;
      return `<div class="bar-col" title="${escapeHtml(title)}"><div class="bar" style="height:${pct}%"></div><div class="bar-label">${escapeHtml(dayLabel(row.key))}</div></div>`;
    })
    .join('');

  const modelRows = data.byModel.map((row) => [
    `<code>${escapeHtml(row.key)}</code>`,
    formatTokens(row.input),
    formatTokens(row.output),
    formatTokens(row.cacheRead),
    formatTokens(row.cacheWrite),
    formatTokens(row.tokens),
    formatUsd(row.cost),
  ]);

  const projectRows = data.byProject.map((row) => [
    escapeHtml(row.key),
    formatInt(row.events),
    formatTokens(row.tokens),
    formatUsd(row.cost),
  ]);

  const sourceRows = data.bySource.map((row) => [
    `<code>${escapeHtml(row.key)}</code>`,
    formatInt(row.events),
    formatTokens(row.tokens),
    formatUsd(row.cost),
  ]);

  const budget = data.budget;
  const budgetPct =
    budget !== null && budget.hasBudget && budget.budget > 0
      ? Math.min(100, Math.round((budget.spent / budget.budget) * 100))
      : 0;

  const trendRows = data.trend ?? [];
  const trendMax = trendRows.reduce((max, row) => Math.max(max, row.tokens), 0);
  const trendSection =
    trendRows.length >= 2
      ? `<h2>近 ${trendRows.length} 个月趋势</h2>
  <div class="chart">${trendRows
    .map((row) => {
      const pct = trendMax > 0 ? Math.max(2, Math.round((row.tokens / trendMax) * 100)) : 0;
      const tip = `${row.month} · ${formatTokens(row.tokens)} tokens · ${formatUsd(row.cost)}`;
      return `<div class="bar-col" title="${escapeHtml(tip)}"><div class="bar" style="height:${pct}%"></div><div class="bar-label">${escapeHtml(row.month.slice(2))}</div></div>`;
    })
    .join('')}</div>`
      : '';

  const unpricedNote =
    data.unpriced.length > 0
      ? `<p class="hint">⚠ ${data.unpriced.length} 个模型没有价格，成本记为 n/a：${data.unpriced
          .slice(0, 5)
          .map((item) => escapeHtml(item.model))
          .join('、')}</p>`
      : '';

  const empty = totals.events === 0;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Token 账本 · ${escapeHtml(data.label)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>🍚 Token 账本</h1>
    <p class="sub">${escapeHtml(data.label)} · 生成于 ${escapeHtml(data.generatedAt)}</p>
  </header>

  <section class="cards">
    <div class="card"><div class="k">Tokens</div><div class="v">${formatTokens(totals.tokens)}</div></div>
    <div class="card"><div class="k">预估花费</div><div class="v">${formatUsd(totals.cost)}</div></div>
    <div class="card"><div class="k">调用次数</div><div class="v">${formatInt(totals.events)}</div></div>
    <div class="card"><div class="k">${budget === null ? '预算' : budget.hasBudget ? '预算剩余' : '预算'}</div><div class="v">${
      budget === null ? '—' : budget.hasBudget ? formatUsd(budget.remaining) : '未设置'
    }</div></div>
  </section>

  ${
    empty
      ? '<p class="hint">这个区间还没有任何记录。先运行 <code>token-ledger scan</code>。</p>'
      : `
  <h2>每日用量</h2>
  <div class="chart">${bars}</div>

  ${trendSection}
  <h2>按模型</h2>
  ${table(['模型', 'Input', 'Output', 'Cache 读', 'Cache 写', 'Tokens', '成本'], modelRows)}

  <h2>按项目</h2>
  ${table(['项目', '调用次数', 'Tokens', '成本'], projectRows)}

  <h2>按数据源</h2>
  ${table(['数据源', '调用次数', 'Tokens', '成本'], sourceRows)}
  `
  }

  ${
    budget !== null && budget.hasBudget
      ? `<h2>预算</h2>
  <div class="budget">
    <div class="track"><div class="fill" style="width:${budgetPct}%"></div></div>
    <p>月预算 ${formatUsd(budget.budget)} · 已花 ${formatUsd(budget.spent)} · 剩余 ${formatUsd(
      budget.remaining,
    )}${
      budget.overBudget
        ? ` · ⚠ 已超支 ${formatUsd(Math.abs(budget.remaining))}`
        : budget.daysLeft > 0
          ? ` · 含今天还剩 ${budget.daysLeft} 天，每天 ${formatUsd(budget.dailyAllowance)}`
          : ''
    }</p>
  </div>`
      : ''
  }

  ${unpricedNote}

  <footer>
    成本为估算值，以 provider 实际账单为准 · 由 token-ledger 生成 · 本页面为单文件，不含任何外部资源或脚本
  </footer>
</main>
</body>
</html>
`;
}
