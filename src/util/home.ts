import os from 'node:os';
import path from 'node:path';

/**
 * 账本数据目录。
 * 默认 `~/.token-ledger`，可用 TOKEN_LEDGER_HOME 覆盖（测试与多账本场景用）。
 */
export function ledgerHome(): string {
  const fromEnv = process.env.TOKEN_LEDGER_HOME;
  if (fromEnv && fromEnv.trim() !== '') {
    return path.resolve(expandHome(fromEnv.trim()));
  }
  return path.join(os.homedir(), '.token-ledger');
}

/** 把开头的 `~` 展开成用户主目录。 */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
