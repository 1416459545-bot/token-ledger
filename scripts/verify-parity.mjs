// 交叉验证：TypeScript CLI 与 Rust 桌面端扫描同一批日志，结果必须完全一致。
//
// 为什么重要：两套实现共用一个账本，如果事件 id 或金额有偏差，会造成重复计账或金额漂移。
//
// 用法：
//   cargo build --bin tlscan --manifest-path src-tauri/Cargo.toml
//   node scripts/verify-parity.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const work = path.join(root, '.tmp', 'parity');
fs.rmSync(work, { recursive: true, force: true });

const homeTs = path.join(work, 'ts');
const homeRust = path.join(work, 'rust');
fs.mkdirSync(homeTs, { recursive: true });
fs.mkdirSync(homeRust, { recursive: true });

const claudeDir = path.join(root, 'test', 'fixtures', 'parity', 'claude');
const codexDir = path.join(root, 'test', 'fixtures', 'parity', 'codex');
const sharedEnv = {
  ...process.env,
  CLAUDE_PROJECTS_DIR: claudeDir,
  CODEX_SESSIONS_DIR: codexDir,
};

const exe = path.join(
  root,
  'src-tauri',
  'target',
  'debug',
  process.platform === 'win32' ? 'tlscan.exe' : 'tlscan',
);
if (!fs.existsSync(exe)) {
  console.error('❌ 找不到 tlscan，请先运行：cargo build --bin tlscan --manifest-path src-tauri/Cargo.toml');
  process.exit(1);
}

console.log('▶ TypeScript 扫描…');
execFileSync(process.execPath, ['src/cli.ts', 'scan'], {
  cwd: root,
  env: { ...sharedEnv, TOKEN_LEDGER_HOME: homeTs },
  stdio: 'inherit',
});

console.log('\n▶ Rust 扫描…');
execFileSync(exe, ['scan'], {
  cwd: root,
  env: { ...sharedEnv, TOKEN_LEDGER_HOME: homeRust },
  stdio: 'inherit',
});

const cols = [
  'id', 'ts', 'day', 'month', 'source', 'provider', 'model', 'project',
  'session_id', 'input_tokens', 'output_tokens', 'cache_read_tokens',
  'cache_write_tokens', 'cost_usd',
];

function readRows(home) {
  const db = new DatabaseSync(path.join(home, 'ledger.db'));
  const rows = db.prepare(`SELECT ${cols.join(',')} FROM events ORDER BY id`).all();
  db.close();
  return rows.map((row) => ({ ...row }));
}

const rowsTs = readRows(homeTs);
const rowsRust = readRows(homeRust);

const problems = [];

if (rowsTs.length !== rowsRust.length) {
  problems.push(`记录数不同：TS=${rowsTs.length} Rust=${rowsRust.length}`);
}

const idsTs = new Set(rowsTs.map((r) => r.id));
const idsRust = new Set(rowsRust.map((r) => r.id));
for (const id of idsTs) {
  if (!idsRust.has(id)) problems.push(`只在 TS 的事件：${id}`);
}
for (const id of idsRust) {
  if (!idsTs.has(id)) problems.push(`只在 Rust 的事件：${id}`);
}

const byId = new Map(rowsRust.map((r) => [r.id, r]));
for (const a of rowsTs) {
  const b = byId.get(a.id);
  if (!b) continue;
  for (const col of cols) {
    const va = a[col] ?? null;
    const vb = b[col] ?? null;
    const same =
      typeof va === 'number' && typeof vb === 'number'
        ? Math.abs(va - vb) < 1e-9
        : va === vb;
    if (!same) problems.push(`字段不一致 ${a.id}.${col}：TS=${va} Rust=${vb}`);
  }
}

const sum = (rows) => ({
  events: rows.length,
  tokens: rows.reduce(
    (s, r) => s + r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens,
    0,
  ),
  cost: Math.round(rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0) * 1e6) / 1e6,
});

console.log('\n──────────────── 对拍结果 ────────────────');
console.log('TS   :', JSON.stringify(sum(rowsTs)));
console.log('Rust :', JSON.stringify(sum(rowsRust)));

if (problems.length > 0) {
  console.error(`\n❌ 发现 ${problems.length} 处不一致：`);
  for (const p of problems.slice(0, 20)) console.error('   -', p);
  process.exit(1);
}

if (rowsTs.length === 0) {
  console.error('\n❌ 两边都没有解析出事件，fixture 或解析逻辑有问题');
  process.exit(1);
}

console.log('\n✅ 两套实现完全一致（事件 id、字段、金额）');

