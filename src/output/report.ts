import type { AggregateRow, Totals } from '../core/types.ts';
import type { BudgetStatus } from '../core/budget.ts';
import { formatInt, formatTokens, formatUsd } from '../util/format.ts';
import { renderTable } from './table.ts';

export interface ReportData {
  month: string;
  totals: Totals;
  byModel: AggregateRow[];
  byDay: AggregateRow[];
  byProject: AggregateRow[];
  budget: BudgetStatus;
  unpriced: { model: string; count: number }[];
}

const TOKEN_RIGHT = [1, 2, 3, 4, 5, 6];

function modelRows(rows: AggregateRow[]): string[][] {
  return rows.map((r) => [
    r.key,
    formatTokens(r.input),
    formatTokens(r.output),
    formatTokens(r.cacheRead),
    formatTokens(r.cacheWrite),
    formatTokens(r.tokens),
    formatUsd(r.cost),
  ]);
}

function simpleRows(rows: AggregateRow[], limit: number): string[][] {
  return rows.slice(0, limit).map((r) => [r.key, formatInt(r.events), formatTokens(r.tokens), formatUsd(r.cost)]);
}

export function renderReport(data: ReportData): string {
  const { totals, month } = data;
  const title = `Token 账本 · ${month}`;
  const rule = '─'.repeat(Math.max(32, Math.min(60, title.length + 24)));

  if (totals.events === 0) {
    return [
      title,
      rule,
      '本月还没有任何记录。',
      '',
      '先扫一遍本地日志：',
      '  token-ledger scan',
    ].join('\n');
  }

  const out: string[] = [title, rule];
  out.push(`合计      ${formatTokens(totals.tokens)} tokens    ≈ ${formatUsd(totals.cost)}   共 ${formatInt(totals.events)} 次调用`);
  out.push(
    `构成      input ${formatTokens(totals.input)} · output ${formatTokens(totals.output)} · cache读 ${formatTokens(
      totals.cacheRead,
    )} · cache写 ${formatTokens(totals.cacheWrite)}`,
  );

  out.push('');
  out.push('按模型');
  out.push(
    renderTable(
      ['MODEL', 'INPUT', 'OUTPUT', 'CACHE-R', 'CACHE-W', 'TOKENS', 'COST'],
      modelRows(data.byModel),
      TOKEN_RIGHT,
    ),
  );

  if (data.byProject.length > 0) {
    out.push('');
    out.push('按项目');
    out.push(renderTable(['PROJECT', 'CALLS', 'TOKENS', 'COST'], simpleRows(data.byProject, 10), [1, 2, 3]));
  }

  out.push('');
  out.push('按天');
  out.push(renderTable(['DAY', 'CALLS', 'TOKENS', 'COST'], simpleRows(data.byDay, 31), [1, 2, 3]));

  out.push('');
  out.push('预算');
  if (!data.budget.hasBudget) {
    out.push('  还没设预算。试试：token-ledger budget set 50');
  } else {
    const b = data.budget;
    out.push(
      `  月预算 ${formatUsd(b.budget)} · 已花 ${formatUsd(b.spent)} · 剩余 ${formatUsd(b.remaining)}`,
    );
    if (b.overBudget) {
      out.push(`  ⚠ 已超支 ${formatUsd(Math.abs(b.remaining))}，本鱼劝你少说两句废话。`);
    } else if (b.daysLeft > 0) {
      out.push(`  含今天还剩 ${b.daysLeft} 天 → 每天还能吃 ${formatUsd(b.dailyAllowance)}`);
    }
  }

  if (data.unpriced.length > 0) {
    out.push('');
    out.push('提示');
    for (const item of data.unpriced.slice(0, 5)) {
      out.push(`  ${item.model} × ${item.count} 条无价格，成本记为 n/a`);
    }
    out.push('  补价格：在 ~/.token-ledger/prices.json 里加一条，见 README「自定义价格表」');
  }

  return out.join('\n');
}
