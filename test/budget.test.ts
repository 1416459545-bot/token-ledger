import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { budgetStatus, clearBudget, getBudget, setBudget } from '../src/core/budget.ts';
import { createSchema } from '../src/core/db.ts';

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  createSchema(db);
  return db;
}

test('预算可重复设定，以最后一次为准', () => {
  const db = makeDb();
  assert.equal(getBudget(db, '2026-11'), null);
  setBudget(db, '2026-11', 50);
  setBudget(db, '2026-11', 80);
  assert.equal(getBudget(db, '2026-11'), 80);

  assert.equal(clearBudget(db, '2026-11'), true);
  assert.equal(getBudget(db, '2026-11'), null);
  assert.equal(clearBudget(db, '2026-11'), false);
});

test('账本语义：剩余额度 ÷ 剩余天数（含今天）', () => {
  const db = makeDb();
  setBudget(db, '2026-11', 50);
  const status = budgetStatus(db, '2026-11', 20, new Date(2026, 10, 20, 12, 0, 0));

  assert.equal(status.hasBudget, true);
  assert.equal(status.daysInMonth, 30);
  assert.equal(status.daysLeft, 11); // 20 号含当天，到 30 号共 11 天
  assert.equal(status.remaining, 30);
  assert.equal(status.overBudget, false);
  assert.ok(Math.abs(status.dailyAllowance - 30 / 11) < 1e-9);
});

test('超支时 remaining 为负，dailyAllowance 归零', () => {
  const db = makeDb();
  setBudget(db, '2026-11', 10);
  const status = budgetStatus(db, '2026-11', 25, new Date(2026, 10, 5, 9, 0, 0));

  assert.equal(status.overBudget, true);
  assert.equal(status.remaining, -15);
  assert.equal(status.dailyAllowance, 0);
});

test('没设预算时不编造金额', () => {
  const db = makeDb();
  const status = budgetStatus(db, '2026-11', 12.5, new Date(2026, 10, 5));
  assert.equal(status.hasBudget, false);
  assert.equal(status.spent, 12.5);
  assert.equal(status.budget, 0);
});

test('过去的月份剩余天数为 0，未来月份按整月算', () => {
  const db = makeDb();
  setBudget(db, '2026-10', 50);
  setBudget(db, '2026-12', 60);
  const now = new Date(2026, 10, 20);

  assert.equal(budgetStatus(db, '2026-10', 10, now).daysLeft, 0);
  assert.equal(budgetStatus(db, '2026-12', 10, now).daysLeft, 31);
});
