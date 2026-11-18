import { daysInMonth } from '../src/util/format.ts';
import { currentMonth } from '../src/util/format.ts';
import { lastDaysPeriod, monthPeriod, type Period } from '../src/core/period.ts';
import { renderHtml } from '../src/output/html.ts';
import type { AggregateRow, Totals } from '../src/core/types.ts';

interface TauriGlobal {
  core: { invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

type Kind = 'month' | '7d' | '30d';

interface DashboardPayload {
  totals: Totals;
  byModel: AggregateRow[];
  byDay: AggregateRow[];
  byProject: AggregateRow[];
  bySource: AggregateRow[];
  unpriced: { model: string; count: number }[];
  trend: { month: string; tokens: number; cost: number }[];
  budgetAmount: number | null;
  dbPath: string;
}

let kind: Kind = 'month';
let lastHtml = '';

function periodOf(k: Kind): Period {
  if (k === '7d') return lastDaysPeriod(7);
  if (k === '30d') return lastDaysPeriod(30);
  return monthPeriod(currentMonth());
}

function budgetOf(amount: number | null, spent: number, month: string | null): {
  month: string;
  budget: number;
  spent: number;
  remaining: number;
  daysInMonth: number;
  daysLeft: number;
  dailyAllowance: number;
  overBudget: boolean;
  hasBudget: boolean;
} | null {
  if (amount === null || month === null) return null;

  const now = new Date();
  const dim = daysInMonth(month);
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const daysLeft = month === currentKey ? dim - now.getDate() + 1 : month > currentKey ? dim : 0;
  const remaining = amount - spent;

  return {
    month,
    budget: amount,
    spent,
    remaining,
    daysInMonth: dim,
    daysLeft,
    dailyAllowance: daysLeft > 0 ? Math.max(0, remaining) / daysLeft : 0,
    overBudget: remaining < 0,
    hasBudget: true,
  };
}

function injectToolbar(): void {
  const bar = document.createElement('div');
  bar.id = 'tl-toolbar';
  bar.innerHTML = `
    <button data-kind="month">本月</button>
    <button data-kind="7d">7 天</button>
    <button data-kind="30d">30 天</button>
    <button data-action="scan">扫描</button>
    <button data-action="refresh">刷新</button>
    <button data-action="export">导出</button>
  `;
  bar.style.cssText =
    'position:fixed;right:20px;bottom:20px;z-index:9999;display:flex;gap:6px;padding:8px;' +
    'background:rgba(22,27,34,.92);border:1px solid #30363d;border-radius:12px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.35);';

  bar.querySelectorAll('button').forEach((btn) => {
    (btn as HTMLButtonElement).style.cssText =
      'cursor:pointer;border:1px solid #30363d;background:#21262d;color:#e6edf3;' +
      'border-radius:8px;padding:6px 12px;font-size:13px;';
  });

  bar.addEventListener('click', (event) => {
    const target = event.target as HTMLButtonElement;
    if (target.tagName !== 'BUTTON') return;
    const nextKind = target.dataset.kind as Kind | undefined;
    if (nextKind) {
      kind = nextKind;
      void load();
      return;
    }
    if (target.dataset.action === 'refresh') void load();
    if (target.dataset.action === 'scan') void runScan(target);
    if (target.dataset.action === 'export') exportHtml();
  });

  document.body.appendChild(bar);
}

/** 扫描本机日志（与 CLI 的 scan 同一套逻辑，Rust 实现） */
async function runScan(button: HTMLButtonElement): Promise<void> {
  const tauri = window.__TAURI__;
  if (!tauri) return;

  const original = button.textContent ?? '扫描';
  button.textContent = '扫描中…';
  button.disabled = true;

  try {
    const raw = await tauri.core.invoke<string>('scan_logs', { force: false });
    const summary = JSON.parse(raw) as {
      inserted: number;
      results: { label: string; files_scanned: number; files_skipped: number; inserted: number }[];
    };
    const detail = summary.results
      .map((r) => `${r.label} ${r.files_scanned} 个文件 +${r.inserted}`)
      .join(' · ');
    toast(`扫描完成：新增 ${summary.inserted} 条（${detail}）`);
    await load();
  } catch (err) {
    toast(`扫描失败：${String(err)}`, true);
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

let toastTimer: number | undefined;

function toast(message: string, isError = false): void {
  let el = document.getElementById('tl-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tl-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.cssText =
    'position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:10000;' +
    'padding:10px 18px;border-radius:10px;font-size:13px;max-width:80vw;' +
    `background:${isError ? '#5a1d1d' : '#1f2d1f'};color:${isError ? '#ffb3b3' : '#b3ffb3'};` +
    'border:1px solid rgba(255,255,255,.12);box-shadow:0 6px 24px rgba(0,0,0,.4);';
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el?.remove();
  }, 4000);
}

function exportHtml(): void {
  if (lastHtml === '') return;
  const blob = new Blob([lastHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `token-ledger-${periodOf(kind).label.replace(/[^\d-]/g, '') || 'report'}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function load(): Promise<void> {
  const tauri = window.__TAURI__;
  if (!tauri) {
    document.body.innerHTML =
      '<div style="padding:32px;color:#c9d1d9">Tauri API 不可用（请用 tauri 启动）</div>';
    return;
  }

  const period = periodOf(kind);
  let data: DashboardPayload;
  try {
    const raw = await tauri.core.invoke<string>('dashboard_data', {
      start: period.start,
      end: period.end,
      month: period.month,
    });
    data = JSON.parse(raw) as DashboardPayload;
  } catch (err) {
    document.body.innerHTML = `<div style="padding:32px;color:#f85149">加载账本失败：${String(err)}</div>`;
    return;
  }

  const html = renderHtml({
    label: period.label,
    generatedAt: new Date().toLocaleString('zh-CN'),
    totals: data.totals,
    byModel: data.byModel,
    byDay: data.byDay,
    byProject: data.byProject,
    bySource: data.bySource,
    budget: budgetOf(data.budgetAmount, data.totals.cost, period.month),
    unpriced: data.unpriced,
    trend: data.trend,
  });

  lastHtml = html;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  injectToolbar();
}

void load();
