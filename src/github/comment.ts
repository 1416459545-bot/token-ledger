import type { BudgetStatus } from '../core/budget.ts';
import type { AggregateRow, Totals } from '../core/types.ts';
import { formatInt, formatTokens, formatUsd } from '../util/format.ts';

/** 用来识别「本工具发过的评论」，实现幂等更新而不是刷屏。 */
export const COMMENT_MARKER = '<!-- token-ledger:comment -->';

export interface CommentData {
  month: string;
  totals: Totals;
  byModel: AggregateRow[];
  bySource: AggregateRow[];
  budget: BudgetStatus;
  /** 可选的运行链接，方便点回去看 */
  runUrl?: string;
}

const mdTable = (headers: string[], rows: string[][]): string[] => [
  `| ${headers.join(' | ')} |`,
  `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
];

/** 生成 PR 评论正文（Markdown）。 */
export function buildCommentBody(data: CommentData): string {
  const out: string[] = [COMMENT_MARKER];
  out.push(`### 🍚 Token 账本 · ${data.month}`);
  out.push('');

  if (data.totals.events === 0) {
    out.push('这次运行**没有找到可统计的用量记录**。');
    out.push('');
    out.push('可能的原因：');
    out.push('');
    out.push('- 本次 CI 没有运行任何 AI agent（本地开发的用量不会出现在 runner 上）');
    out.push('- agent 的日志不在 `~/.claude/projects` 或 `~/.codex/sessions`');
    out.push('');
    out.push('如果用量数据在别处，可以用 `import-file` 输入传进来（通用 JSONL 格式，见 README）。');
    out.push('');
    out.push(footer(data.runUrl));
    return out.join('\n');
  }

  out.push(
    ...mdTable(
      ['调用次数', 'Tokens', '预估花费'],
      [[formatInt(data.totals.events), formatTokens(data.totals.tokens), formatUsd(data.totals.cost)]],
    ),
  );

  if (data.byModel.length > 0) {
    out.push('');
    out.push('**按模型**');
    out.push('');
    out.push(
      ...mdTable(
        ['模型', 'Tokens', '预估花费'],
        data.byModel
          .slice(0, 5)
          .map((row) => [`\`${row.key}\``, formatTokens(row.tokens), formatUsd(row.cost)]),
      ),
    );
  }

  if (data.bySource.length > 0) {
    out.push('');
    out.push(
      `**按数据源**：${data.bySource
        .map((row) => `\`${row.key}\` ${formatInt(row.events)} 次`)
        .join(' · ')}`,
    );
  }

  if (data.budget.hasBudget) {
    out.push('');
    const budgetBits = [
      `月预算 ${formatUsd(data.budget.budget)}`,
      `已花 ${formatUsd(data.budget.spent)}`,
      `剩余 ${formatUsd(data.budget.remaining)}`,
    ];
    if (data.budget.overBudget) budgetBits.push(`⚠ 已超支 ${formatUsd(Math.abs(data.budget.remaining))}`);
    else if (data.budget.daysLeft > 0) budgetBits.push(`每天还能吃 ${formatUsd(data.budget.dailyAllowance)}`);
    out.push(`**预算**：${budgetBits.join(' · ')}`);
  }

  out.push('');
  out.push(footer(data.runUrl));
  return out.join('\n');
}

function footer(runUrl?: string): string {
  const link = runUrl !== undefined ? ` · [本次运行](${runUrl})` : '';
  return `<sub>成本为估算值，以 provider 实际账单为准${link} · 由 token-ledger 生成</sub>`;
}

export interface UpsertCommentOptions {
  repo: string;
  issueNumber: number;
  body: string;
  token: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface UpsertCommentResult {
  action: 'created' | 'updated';
  id: number;
  url?: string;
}

interface IssueComment {
  id: number;
  body?: string;
  html_url?: string;
}

/**
 * 发布或更新评论：已经发过（带 marker）就 PATCH 更新，否则新建。
 * 这样每次 CI 运行不会刷一串重复评论。
 */
export async function upsertComment(options: UpsertCommentOptions): Promise<UpsertCommentResult> {
  const { repo, issueNumber, body, token } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const api = (
    options.apiUrl?.trim() ||
    process.env.GITHUB_API_URL?.trim() ||
    'https://api.github.com'
  ).replace(/\/+$/, '');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'token-ledger',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const listUrl = `${api}/repos/${repo}/issues/${issueNumber}/comments?per_page=100`;
  const listResponse = await doFetch(listUrl, { method: 'GET', headers });
  if (!listResponse.ok) {
    throw new Error(`列出 PR 评论失败：HTTP ${listResponse.status}`);
  }
  const comments = (await listResponse.json()) as IssueComment[];
  const existing = Array.isArray(comments)
    ? comments.find((comment) => typeof comment.body === 'string' && comment.body.includes(COMMENT_MARKER))
    : undefined;

  const targetUrl = existing
    ? `${api}/repos/${repo}/issues/comments/${existing.id}`
    : `${api}/repos/${repo}/issues/${issueNumber}/comments`;

  const response = await doFetch(targetUrl, {
    method: existing ? 'PATCH' : 'POST',
    headers,
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw new Error(`发表评论失败：HTTP ${response.status}`);
  }

  const created = (await response.json()) as IssueComment;
  return {
    action: existing ? 'updated' : 'created',
    id: Number(created.id ?? 0),
    url: created.html_url,
  };
}
