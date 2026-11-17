/**
 * 简易表格渲染。
 * 关键点：中文 / emoji 在终端里占两格，必须按「显示宽度」补空格，否则一定错位。
 */

function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) width += charWidth(ch.codePointAt(0) ?? 0);
  return width;
}

function padEnd(s: string, width: number): string {
  const gap = width - displayWidth(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

function padStart(s: string, width: number): string {
  const gap = width - displayWidth(s);
  return gap > 0 ? ' '.repeat(gap) + s : s;
}

export function renderTable(headers: string[], rows: string[][], rightAlign: number[] = []): string {
  const widths = headers.map((h, i) => {
    const cells = rows.map((r) => displayWidth(r[i] ?? ''));
    return Math.max(displayWidth(h), ...cells);
  });

  const isRight = (i: number) => rightAlign.includes(i);
  // 注意：不能 trimEnd()，末列的补位空格一旦被吃掉，整张表就歪了
  const renderRow = (cells: string[]): string =>
    cells.map((c, i) => (isRight(i) ? padStart(c, widths[i]) : padEnd(c, widths[i]))).join('  ');

  const lines = [renderRow(headers)];
  lines.push(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of rows) {
    lines.push(renderRow(headers.map((_, i) => row[i] ?? '')));
  }
  return lines.join('\n');
}
