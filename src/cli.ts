#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { openDb, dbFile } from './core/db.ts';
import { aggregate, detailRows, eventCount, insertEvents, listMonths, totals as queryTotals, unpricedModels } from './core/ledger.ts';
import { budgetStatus, clearBudget, setBudget } from './core/budget.ts';
import { loadPricing } from './core/pricing.ts';
import { priceEvents, scanClaude } from './core/scanner.ts';
import { defaultClaudeRoot, findJsonlFiles } from './sources/claude.ts';
import { parseImportFile } from './sources/generic.ts';
import { renderReport } from './output/report.ts';
import { renderCsv, renderMarkdown } from './output/markdown.ts';
import { DEFAULT_BOWL_SIZE, renderRice } from './output/rice.ts';
import { renderTable } from './output/table.ts';
import { currentMonth, formatInt, formatTokens, formatUsd, normalizeMonth } from './util/format.ts';
import { expandHome, ledgerHome } from './util/home.ts';
import type { GroupBy } from './core/types.ts';

type Flags = Record<string, string | boolean>;

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Flags;
}

const VALID_BY: GroupBy[] = ['day', 'model', 'project', 'source'];

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Flags = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq !== -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          flags[token.slice(2)] = next;
          i += 1;
        } else {
          flags[token.slice(2)] = true;
        }
      }
    } else if (token.startsWith('-') && token.length > 1) {
      flags[token.slice(1)] = true;
    } else {
      positionals.push(token);
    }
  }

  const command = positionals.shift() ?? 'help';
  return { command, positionals, flags };
}

function print(text = ''): void {
  console.log(text);
}

function printErr(text: string): void {
  console.error(text);
}

function flagStr(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function flagNum(flags: Flags, name: string): number | undefined {
  const raw = flagStr(flags, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

const HELP = `token-ledger · 本地优先的 AI token 花费账本

用法
  token-ledger <命令> [选项]

命令
  scan                扫描本地 Claude Code 日志并记账
  import <file.jsonl> 导入任意工具的用量数据（通用 JSONL 格式）
  report              看某个月的账（默认本月）
  budget set <金额>   设定月度预算（美元）
  budget show         看预算余额
  budget clear        清掉月度预算
  export              导出账本（md / csv）
  rice                看看这个月吃了几碗白饭
  doctor              诊断：路径、数据量、价格表

选项
  --month YYYY-MM                 指定月份
  --by model|project|day|source   report 只看某一个维度
  --root <dir>                    scan 的日志目录
  --project <名称>                import 时给没有 project 字段的记录补上归属
  --force                         scan 忽略增量缓存，全量重扫
  --format md|csv                 export 的输出格式（默认 md）
  --out <file>                    export 写入文件
  --json                          机器可读输出（scan / report）
  --bowl-size <n>                 rice 里一碗等于多少 tokens（默认 1000000）
  -h, --help                      帮助
  -v, --version                   版本

数据
  账本目录  ~/.token-ledger（可用 TOKEN_LEDGER_HOME 覆盖）
  只记 token 数字与模型元数据，不保存任何 prompt / 回复正文。`;

function version(): string {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgUrl, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function resolveMonth(flags: Flags): string | null {
  const raw = flagStr(flags, 'month');
  if (raw === undefined) return currentMonth();
  const normalized = normalizeMonth(raw);
  if (normalized === null) {
    printErr(`月份格式不对：${raw}（应为 YYYY-MM，例如 ${currentMonth()}）`);
    return null;
  }
  return normalized;
}

function cmdScan(parsed: ParsedArgs): number {
  const home = ledgerHome();
  const requestedRoot = flagStr(parsed.flags, 'root') ?? defaultClaudeRoot();
  const root = path.resolve(expandHome(requestedRoot));
  const db = openDb(home);
  const pricing = loadPricing(home);

  const summary = scanClaude({ db, root, force: parsed.flags.force === true, prices: pricing.entries });

  if (parsed.flags.json === true) {
    print(JSON.stringify(summary, null, 2));
    return 0;
  }

  print(`扫描 ${summary.filesTotal} 个日志文件`);
  print(`  新扫 ${summary.filesScanned} · 跳过（未变化）${summary.filesSkipped} · 新增记录 ${summary.inserted}`);

  if (summary.filesTotal === 0) {
    print('');
    print(`没在 ${root} 找到 .jsonl 日志。`);
    print('确认 Claude Code 日志目录，或用 --root 指定。');
  }
  if (summary.unreadableFiles.length > 0) {
    print(`  ⚠ ${summary.unreadableFiles.length} 个文件处理失败`);
    for (const f of summary.unreadableFiles.slice(0, 3)) print(`    ${f}`);
  }
  if (summary.unpricedModels.length > 0) {
    print('');
    print(`这些模型没有价格，成本已记为 n/a：${summary.unpricedModels.join(', ')}`);
    print('补价格：~/.token-ledger/prices.json，格式见 README「自定义价格表」');
  }
  for (const warning of pricing.warnings) print(`⚠ ${warning}`);
  print('');
  print(`账本：${dbFile(home)}`);
  return 0;
}

function cmdImport(parsed: ParsedArgs): number {
  const target = parsed.positionals[0];
  if (target === undefined) {
    printErr('用法：token-ledger import <file.jsonl> [--project 名称] [--json]');
    return 1;
  }

  const file = path.resolve(expandHome(target));
  if (!fs.existsSync(file)) {
    printErr(`文件不存在：${file}`);
    return 1;
  }

  const home = ledgerHome();
  const db = openDb(home);
  const pricing = loadPricing(home);
  const project = flagStr(parsed.flags, 'project') ?? null;

  const parsedFile = parseImportFile(file, project);
  const { priced, unpricedModels } = priceEvents(parsedFile.events, pricing.entries);
  const inserted = insertEvents(db, priced);

  if (parsed.flags.json === true) {
    print(
      JSON.stringify(
        { file, ...parsedFile.stats, inserted, unpricedModels },
        null,
        2,
      ),
    );
    return 0;
  }

  print(`导入 ${file}`);
  print(
    `  解析 ${parsedFile.stats.lines} 行 · 有效 ${parsedFile.stats.events} 条 · 新增 ${inserted} 条（重复自动跳过）`,
  );
  if (parsedFile.stats.skipped > 0) {
    print(`  跳过 ${parsedFile.stats.skipped} 行（缺字段 / 坏 JSON / 零消耗）`);
  }
  if (unpricedModels.length > 0) {
    print(`  未定价模型：${unpricedModels.join(', ')}（成本记为 n/a）`);
  }
  for (const warning of pricing.warnings) print(`⚠ ${warning}`);
  return 0;
}

function cmdReport(parsed: ParsedArgs): number {
  const month = resolveMonth(parsed.flags);
  if (month === null) return 1;

  const by = flagStr(parsed.flags, 'by');
  if (by !== undefined && !VALID_BY.includes(by as GroupBy)) {
    printErr(`--by 只能是 ${VALID_BY.join(' / ')}`);
    return 1;
  }

  const db = openDb();
  const totals = queryTotals(db, month);

  if (by !== undefined) {
    const rows = aggregate(db, month, by as GroupBy);
    print(`Token 账本 · ${month} · 按 ${by}`);
    print('─'.repeat(40));
    if (rows.length === 0) {
      print('本月没有记录。');
      return 0;
    }
    print(
      renderTable(
        [by.toUpperCase(), 'CALLS', 'TOKENS', 'COST'],
        rows.map((r) => [r.key, formatInt(r.events), formatTokens(r.tokens), formatUsd(r.cost)]),
        [1, 2, 3],
      ),
    );
    return 0;
  }

  const data = {
    month,
    totals,
    byModel: aggregate(db, month, 'model'),
    byDay: aggregate(db, month, 'day'),
    byProject: aggregate(db, month, 'project'),
    budget: budgetStatus(db, month, totals.cost),
    unpriced: unpricedModels(db, month),
  };

  if (parsed.flags.json === true) {
    print(JSON.stringify(data, null, 2));
    return 0;
  }

  print(renderReport(data));

  if (totals.events === 0) {
    const months = listMonths(db);
    if (months.length > 0) {
      print('');
      print(`账本里已有这些月份：${months.join(', ')}（用 --month 指定）`);
    }
  }
  return 0;
}

function cmdBudget(parsed: ParsedArgs): number {
  const month = resolveMonth(parsed.flags);
  if (month === null) return 1;

  const sub = parsed.positionals[0] ?? 'show';
  const db = openDb();
  const totals = queryTotals(db, month);

  if (sub === 'set') {
    const raw = parsed.positionals[1];
    const amount = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      printErr('用法：token-ledger budget set <金额> [--month YYYY-MM]');
      return 1;
    }
    setBudget(db, month, amount);
    const status = budgetStatus(db, month, totals.cost);
    print(`已设定 ${month} 预算：${formatUsd(amount)}`);
    print(`已花 ${formatUsd(status.spent)} · 剩余 ${formatUsd(status.remaining)}`);
    return 0;
  }

  if (sub === 'clear') {
    const removed = clearBudget(db, month);
    print(removed ? `已清除 ${month} 的预算。` : `${month} 本来就没有预算。`);
    return 0;
  }

  if (sub === 'show') {
    const status = budgetStatus(db, month, totals.cost);
    if (!status.hasBudget) {
      print(`${month} 还没设预算。`);
      print(`试试：token-ledger budget set 50 --month ${month}`);
      return 0;
    }
    print(`Token 账本 · ${month} · 预算`);
    print('─'.repeat(40));
    print(`月预算   ${formatUsd(status.budget)}`);
    print(`已花     ${formatUsd(status.spent)}`);
    print(`剩余     ${formatUsd(status.remaining)}`);
    if (status.overBudget) {
      print(`⚠ 已超支 ${formatUsd(Math.abs(status.remaining))}`);
    } else if (status.daysLeft > 0) {
      print(`含今天还剩 ${status.daysLeft} 天 → 每天还能吃 ${formatUsd(status.dailyAllowance)}`);
    }
    return 0;
  }

  printErr(`未知子命令：budget ${sub}（可用 set / show / clear）`);
  return 1;
}

function cmdExport(parsed: ParsedArgs): number {
  const month = resolveMonth(parsed.flags);
  if (month === null) return 1;

  const format = flagStr(parsed.flags, 'format') ?? 'md';
  if (format !== 'md' && format !== 'csv') {
    printErr('--format 只能是 md 或 csv');
    return 1;
  }

  const db = openDb();
  const totals = queryTotals(db, month);
  const content =
    format === 'md'
      ? renderMarkdown({
          month,
          totals,
          byModel: aggregate(db, month, 'model'),
          byProject: aggregate(db, month, 'project'),
          budget: budgetStatus(db, month, totals.cost),
        })
      : renderCsv(detailRows(db, month));

  const outFile = flagStr(parsed.flags, 'out');
  if (outFile !== undefined) {
    const target = path.resolve(expandHome(outFile));
    fs.writeFileSync(target, `${content}\n`, 'utf8');
    print(`已写入 ${target}`);
    return 0;
  }

  print(content);
  return 0;
}

function cmdRice(parsed: ParsedArgs): number {
  const month = resolveMonth(parsed.flags);
  if (month === null) return 1;
  const bowlSize = flagNum(parsed.flags, 'bowl-size') ?? DEFAULT_BOWL_SIZE;
  if (bowlSize <= 0) {
    printErr('--bowl-size 必须是正数');
    return 1;
  }
  const db = openDb();
  const totals = queryTotals(db, month);
  print(renderRice(month, totals.tokens, bowlSize));
  return 0;
}

function cmdDoctor(parsed: ParsedArgs): number {
  const home = ledgerHome();
  const file = dbFile(home);
  const claudeRoot = path.resolve(expandHome(flagStr(parsed.flags, 'root') ?? defaultClaudeRoot()));
  const logFiles = findJsonlFiles(claudeRoot);
  const pricing = loadPricing(home);

  let events = 0;
  let months: string[] = [];
  if (fs.existsSync(file)) {
    const db = openDb(home);
    events = eventCount(db);
    months = listMonths(db);
  }

  print('token-ledger doctor');
  print('─'.repeat(40));
  print(`版本         ${version()}`);
  print(`Node         ${process.version}`);
  print(`账本目录     ${home}`);
  print(
    `数据库       ${fs.existsSync(file) ? humanSize(fs.statSync(file).size) : '（尚未创建）'} · ${formatInt(events)} 条记录`,
  );
  print(`月份         ${months.length > 0 ? months.join(', ') : '（空）'}`);
  print(`Claude 日志  ${claudeRoot} · ${logFiles.length} 个 .jsonl`);
  print(`价格表       ${pricing.source}${pricing.customFile !== null ? `（${pricing.customFile}）` : ''}`);
  for (const warning of pricing.warnings) print(`  ⚠ ${warning}`);
  return 0;
}

function main(): number {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.flags.version === true || parsed.flags.v === true) {
    print(version());
    return 0;
  }
  if (parsed.flags.help === true || parsed.flags.h === true) {
    print(HELP);
    return 0;
  }

  switch (parsed.command) {
    case 'help':
      print(HELP);
      return 0;
    case 'version':
      print(version());
      return 0;
    case 'scan':
      return cmdScan(parsed);
    case 'import':
      return cmdImport(parsed);
    case 'report':
      return cmdReport(parsed);
    case 'budget':
      return cmdBudget(parsed);
    case 'export':
      return cmdExport(parsed);
    case 'rice':
      return cmdRice(parsed);
    case 'doctor':
      return cmdDoctor(parsed);
    default:
      printErr(`未知命令：${parsed.command}`);
      printErr('');
      printErr(HELP);
      return 1;
  }
}

try {
  process.exitCode = main();
} catch (err) {
  printErr(`出错了：${(err as Error).message}`);
  process.exitCode = 1;
}
