import { daysInMonth, localDay } from '../util/format.ts';

/** 一个统计区间（闭区间，按本地日期 `YYYY-MM-DD`）。 */
export interface Period {
  start: string;
  end: string;
  /** 人类可读标签，用于报表标题 */
  label: string;
  /** 非 null 表示恰好是完整自然月，此时才谈得上「月度预算」 */
  month: string | null;
}

export function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return localDay(date) === value;
}

function lastDayOf(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

/** 整月区间，例如 `2026-11` → `2026-11-01 ~ 2026-11-30`。 */
export function monthPeriod(month: string): Period {
  return {
    start: `${month}-01`,
    end: lastDayOf(month),
    label: month,
    month,
  };
}

/** 最近 N 天（含今天），例如 7 → 今天往前数 7 天。 */
export function lastDaysPeriod(days: number, now: Date = new Date()): Period {
  const count = Math.max(1, Math.floor(days));
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (count - 1));
  const start = localDay(startDate);
  const end = localDay(endDate);
  return {
    start,
    end,
    label: `最近 ${count} 天（${start} ~ ${end}）`,
    month: wholeMonthOf(start, end),
  };
}

/** 显式区间：只给 since 则到今天就结束；只给 until 则只统计那一天。 */
export function explicitPeriod(
  since: string | null,
  until: string | null,
  now: Date = new Date(),
): Period | null {
  if (since === null && until === null) return null;
  const end = until ?? localDay(now);
  const start = since ?? end;
  if (!isValidDay(start) || !isValidDay(end)) return null;
  if (start > end) return null;
  return {
    start,
    end,
    label: start === end ? start : `${start} ~ ${end}`,
    month: wholeMonthOf(start, end),
  };
}

/** 解析 `7d` / `30d` 这类相对区间。 */
export function parseLastDays(raw: string): number | null {
  const match = /^(\d+)d$/i.exec(raw.trim());
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isInteger(days) || days <= 0 || days > 3660) return null;
  return days;
}

function wholeMonthOf(start: string, end: string): string | null {
  const month = start.slice(0, 7);
  if (end.slice(0, 7) !== month) return null;
  if (start !== `${month}-01`) return null;
  return end === lastDayOf(month) ? month : null;
}
