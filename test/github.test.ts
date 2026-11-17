import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMENT_MARKER, buildCommentBody, upsertComment } from '../src/github/comment.ts';
import type { CommentData } from '../src/github/comment.ts';
import type { AggregateRow } from '../src/core/types.ts';

const modelRow: AggregateRow = {
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

function data(overrides: Partial<CommentData> = {}): CommentData {
  return {
    month: '2026-11',
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
    byModel: [modelRow],
    bySource: [{ ...modelRow, key: 'claude-code' }],
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
    ...overrides,
  };
}

test('评论正文带 marker、汇总、模型表与预算', () => {
  const body = buildCommentBody(data());
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /Token 账本 · 2026-11/);
  assert.match(body, /claude-opus-5-5/);
  assert.match(body, /按数据源/);
  assert.match(body, /月预算 \$50\.00/);
  assert.match(body, /估算值/);
});

test('没有数据时给出明确指引，而不是贴 0', () => {
  const body = buildCommentBody(
    data({
      totals: { ...data().totals, events: 0, tokens: 0, cost: 0 },
      byModel: [],
      bySource: [],
    }),
  );
  assert.match(body, /没有找到可统计的用量记录/);
  assert.match(body, /import-file/);
});

test('超支时正文里会出现警告', () => {
  const body = buildCommentBody(
    data({
      budget: { ...data().budget, budget: 1, spent: 2, remaining: -1, overBudget: true },
    }),
  );
  assert.match(body, /已超支/);
});

interface FakeCall {
  url: string;
  method: string;
  body?: string;
}

function makeFakeFetch(commentList: unknown[], postStatus = 201): { fetchImpl: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    if (method === 'GET') {
      return new Response(JSON.stringify(commentList), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ id: 999, html_url: 'https://example.test/c/999' }), {
      status: postStatus,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

test('首次评论：走 POST 新建', async () => {
  const { fetchImpl, calls } = makeFakeFetch([]);
  const result = await upsertComment({
    repo: 'o/r',
    issueNumber: 7,
    body: `${COMMENT_MARKER}\nhello`,
    token: 't',
    apiUrl: 'https://api.test',
    fetchImpl,
  });

  assert.equal(result.action, 'created');
  assert.equal(result.id, 999);
  assert.equal(calls[0].url, 'https://api.test/repos/o/r/issues/7/comments?per_page=100');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url, 'https://api.test/repos/o/r/issues/7/comments');
});

test('已有带 marker 的评论：走 PATCH 更新，不刷屏', async () => {
  const { fetchImpl, calls } = makeFakeFetch([
    { id: 5, body: '别人的评论' },
    { id: 42, body: `${COMMENT_MARKER}\n旧内容` },
  ]);
  const result = await upsertComment({
    repo: 'o/r',
    issueNumber: 7,
    body: `${COMMENT_MARKER}\n新内容`,
    token: 't',
    apiUrl: 'https://api.test',
    fetchImpl,
  });

  assert.equal(result.action, 'updated');
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].url, 'https://api.test/repos/o/r/issues/comments/42');
});

test('API 返回错误时抛出可读异常', async () => {
  const fetchImpl = (async () => new Response('nope', { status: 403 })) as typeof fetch;
  await assert.rejects(
    () =>
      upsertComment({
        repo: 'o/r',
        issueNumber: 1,
        body: 'x',
        token: 't',
        apiUrl: 'https://api.test',
        fetchImpl,
      }),
    /HTTP 403/,
  );
});
