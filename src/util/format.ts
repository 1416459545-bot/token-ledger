/** token 数的人类可读格式：1_234_567 -> "1.23M" */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** 带千分位的整数：1234567 -> "1,234,567" */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 美元金额。null 表示未定价。 */
export function formatUsd(n: number | null, digits = 2): string {
  if (n === null || !Number.isFinite(n)) return 'n/a';
  const d = Math.abs(n) >= 1000 ? 0 : digits;
  return `$${n.toFixed(d)}`;
}

/** 当前本地月份，形如 `2026-11`。 */
export function currentMonth(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 本地日期，形如 `2026-11-17`。 */
export function localDay(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 校验并规范化 `YYYY-MM`，非法返回 null。 */
export function normalizeMonth(input: string): string | null {
  const m = MONTH_RE.exec(input.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

/** `2026-11` 这一月有多少天。 */
export function daysInMonth(month: string): number {
  const [y, mo] = month.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
}

/** 把 ISO 时间戳转成本地 `YYYY-MM-DD`；非法输入回退到空串。 */
export function isoToLocalDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return localDay(d);
}

/** 把 ISO 时间戳转成本地 `YYYY-MM`。 */
export function isoToLocalMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return currentMonth(d);
}

export function padEnd(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

export function padStart(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}
