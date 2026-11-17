import type { DatabaseSync } from 'node:sqlite';
import { daysInMonth } from '../util/format.ts';

export interface BudgetStatus {
  month: string;
  budget: number;
  spent: number;
  remaining: number;
  daysInMonth: number;
  /** 含今天在内剩余的天数 */
  daysLeft: number;
  /** 剩下每天还能花多少 */
  dailyAllowance: number;
  overBudget: boolean;
  hasBudget: boolean;
}

export function setBudget(db: DatabaseSync, month: string, amount: number): void {
  db.prepare(
    `INSERT INTO budgets (month, amount, currency) VALUES (?, ?, 'USD')
     ON CONFLICT(month) DO UPDATE SET amount = excluded.amount`,
  ).run(month, amount);
}

export function getBudget(db: DatabaseSync, month: string): number | null {
  const row = db.prepare('SELECT amount FROM budgets WHERE month = ?').get(month) as { amount: number } | undefined;
  if (!row) return null;
  return Number(row.amount);
}

export function clearBudget(db: DatabaseSync, month: string): boolean {
  const res = db.prepare('DELETE FROM budgets WHERE month = ?').run(month);
  return Number(res.changes) > 0;
}

/**
 * 账本语义的核心：花掉了多少、还剩多少、剩下的日子每天还能吃多少。
 * `now` 可注入，方便测试。
 */
export function budgetStatus(db: DatabaseSync, month: string, spent: number, now: Date = new Date()): BudgetStatus {
  const total = daysInMonth(month);
  const budget = getBudget(db, month);

  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let daysLeft: number;
  if (month === currentMonthKey) {
    daysLeft = total - now.getDate() + 1;
  } else if (month > currentMonthKey) {
    daysLeft = total;
  } else {
    daysLeft = 0;
  }

  if (budget === null) {
    return {
      month,
      budget: 0,
      spent,
      remaining: 0,
      daysInMonth: total,
      daysLeft,
      dailyAllowance: 0,
      overBudget: false,
      hasBudget: false,
    };
  }

  const remaining = budget - spent;
  return {
    month,
    budget,
    spent,
    remaining,
    daysInMonth: total,
    daysLeft,
    dailyAllowance: daysLeft > 0 ? Math.max(0, remaining) / daysLeft : 0,
    overBudget: remaining < 0,
    hasBudget: true,
  };
}
