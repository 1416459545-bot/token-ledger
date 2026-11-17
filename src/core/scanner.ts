import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { costOf, resolvePrice } from '../core/pricing.ts';
import type { PriceEntry } from '../core/pricing.ts';
import { getFileState, insertEvents, setFileState, setMeta } from '../core/ledger.ts';
import type { UsageEvent } from '../core/types.ts';
import { findJsonlFiles, parseClaudeFile } from '../sources/claude.ts';

export interface ScanOptions {
  db: DatabaseSync;
  root: string;
  force?: boolean;
  prices: Record<string, PriceEntry>;
}

export interface ScanSummary {
  filesTotal: number;
  filesScanned: number;
  filesSkipped: number;
  lines: number;
  events: number;
  inserted: number;
  skippedLines: number;
  unreadableFiles: string[];
  /** 本次扫描里没查到价格的模型 */
  unpricedModels: string[];
  root: string;
}

/** 给事件补上预估成本；未知模型保持 null（账本不瞎猜）。 */
export function priceEvents(events: UsageEvent[], prices: Record<string, PriceEntry>): {
  priced: UsageEvent[];
  unpricedModels: string[];
} {
  const unpriced = new Set<string>();
  const priced = events.map((event) => {
    const resolved = resolvePrice(event.model, prices);
    if (resolved === null) {
      unpriced.add(event.model);
      return { ...event, provider: 'unknown', costUsd: null };
    }
    const cost = costOf(
      {
        input: event.inputTokens,
        output: event.outputTokens,
        cacheRead: event.cacheReadTokens,
        cacheWrite: event.cacheWriteTokens,
      },
      resolved.entry,
    );
    return { ...event, provider: resolved.entry.provider, costUsd: cost };
  });
  return { priced, unpricedModels: [...unpriced] };
}

/** 扫描 Claude Code 日志并入库。已记录过且未改动的文件直接跳过。 */
export function scanClaude(options: ScanOptions): ScanSummary {
  const { db, root, force = false, prices } = options;
  const files = findJsonlFiles(root);

  const summary: ScanSummary = {
    filesTotal: files.length,
    filesScanned: 0,
    filesSkipped: 0,
    lines: 0,
    events: 0,
    inserted: 0,
    skippedLines: 0,
    unreadableFiles: [],
    unpricedModels: [],
    root,
  };

  const unpriced = new Set<string>();

  for (const file of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      summary.unreadableFiles.push(file);
      continue;
    }

    const previous = getFileState(db, file);
    if (!force && previous !== null && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) {
      summary.filesSkipped += 1;
      continue;
    }

    const parsed = parseClaudeFile(file);
    summary.filesScanned += 1;
    summary.lines += parsed.stats.lines;
    summary.skippedLines += parsed.stats.skipped;
    summary.events += parsed.events.length;

    const { priced, unpricedModels } = priceEvents(parsed.events, prices);
    for (const model of unpricedModels) unpriced.add(model);

    try {
      const inserted = insertEvents(db, priced);
      summary.inserted += inserted;
      setFileState(db, file, stat.mtimeMs, stat.size, inserted);
    } catch (err) {
      summary.unreadableFiles.push(`${file}（入库失败：${(err as Error).message}）`);
    }
  }

  summary.unpricedModels = [...unpriced];
  setMeta(db, 'last_scan_at', new Date().toISOString());
  setMeta(db, 'last_scan_root', path.resolve(root));
  return summary;
}
