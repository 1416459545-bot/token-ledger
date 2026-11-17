import type { AggregateRow } from '../core/types.ts';
import type { DetailRow } from '../core/ledger.ts';
import { formatInt, formatTokens, formatUsd } from '../util/format.ts';

export interface MarkdownData {
  month: string;
  totals: {
    events: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tokens: number;
    cost: number;
  };
  byModel: AggregateRow[];
  byProject: AggregateRow[];
  budget: { hasBudget: boolean; budget: number; spent: number; remaining: number };
}

const mdTable = (headers: string[], rows: string[][]): string[] => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
];

export function renderMarkdown(data: MarkdownData): string {
  const { totals } = data;
  const out: string[] = [];
  out.push(`# Token 账本 · ${data.month}`);
  out.push('');
  out.push(
    `本月合计 **${formatTokens(totals.tokens)} tokens**，预估 **${formatUsd(totals.cost)}**，共 ${formatInt(
      totals.events,
    )} 次调用。`,
  );
  out.push('');
  out.push(
    `构成：input ${formatTokens(totals.input)} · output ${formatTokens(totals.output)} · cache 读 ${formatTokens(
      totals.cacheRead,
    )} · cache 写 ${formatTokens(totals.cacheWrite)}`,
  );
  out.push('');
  out.push('## 按模型');
  out.push('');
  out.push(
    ...mdTable(
      ['模型', 'Input', 'Output', 'Cache 读', 'Cache 写', 'Tokens', '成本'],
      data.byModel.map((r) => [
        `\`${r.key}\``,
        formatTokens(r.input),
        formatTokens(r.output),
        formatTokens(r.cacheRead),
        formatTokens(r.cacheWrite),
        formatTokens(r.tokens),
        formatUsd(r.cost),
      ]),
    ),
  );

  if (data.byProject.length > 0) {
    out.push('');
    out.push('## 按项目');
    out.push('');
    out.push(
      ...mdTable(
        ['项目', '调用次数', 'Tokens', '成本'],
        data.byProject.map((r) => [r.key, formatInt(r.events), formatTokens(r.tokens), formatUsd(r.cost)]),
      ),
    );
  }

  if (data.budget.hasBudget) {
    out.push('');
    out.push('## 预算');
    out.push('');
    out.push(
      `月预算 ${formatUsd(data.budget.budget)}，已花 ${formatUsd(data.budget.spent)}，剩余 ${formatUsd(
        data.budget.remaining,
      )}。`,
    );
  }

  out.push('');
  out.push('> 成本为估算值，以 provider 实际账单为准。由 token-ledger 生成。');
  return out.join('\n');
}

/** CSV 字段转义：含逗号 / 引号 / 换行时用双引号包起来。 */
function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function renderCsv(rows: DetailRow[]): string {
  const header = ['day', 'model', 'project', 'source', 'calls', 'input', 'output', 'cache_read', 'cache_write', 'tokens', 'cost_usd'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cost = r.unpriced === r.calls ? '' : r.cost;
    lines.push(
      [
        r.day,
        r.model,
        r.project,
        r.source,
        r.calls,
        r.input,
        r.output,
        r.cacheRead,
        r.cacheWrite,
        r.tokens,
        cost,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n');
}
