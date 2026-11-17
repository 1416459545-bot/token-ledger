import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { costOf, resolvePrice } from '../core/pricing.ts';
import type { PriceEntry } from '../core/pricing.ts';
import { getFileState, insertEvents, setFileState, setMeta } from '../core/ledger.ts';
import type { UsageEvent } from '../core/types.ts';
import type { UsageSource } from '../sources/types.ts';

/** 给事件补上预估成本；未知模型保持 null（账本不瞎猜）。 */
export function priceEvents(
  events: UsageEvent[],
  prices: Record<string, PriceEntry>,
): { priced: UsageEvent[]; unpricedModels: string[] } {
  const unpriced = new Set<string>();
  const priced = events.map((event) => {
    const resolved = resolvePrice(event.model, prices);
    if (resolved === null) {
      unpriced.add(event.model);
      return { ...event, costUsd: null };
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
    // 数据源自带的 provider 优先（例如通用导入里显式写了 provider）
    const provider = event.provider !== 'unknown' ? event.provider : resolved.entry.provider;
    return { ...event, provider, costUsd: cost };
  });
  return { priced, unpricedModels: [...unpriced] };
}

export interface ScanSourceResult {
  name: string;
  label: string;
  root: string;
  filesTotal: number;
  filesScanned: number;
  filesSkipped: number;
  lines: number;
  events: number;
  inserted: number;
  skippedLines: number;
  unreadableFiles: string[];
  unpricedModels: string[];
}

export interface ScanOptions {
  db: DatabaseSync;
  sources: UsageSource[];
  force?: boolean;
  prices: Record<string, PriceEntry>;
  /** 仅在只扫描一个数据源时生效 */
  rootOverride?: string;
}

export interface ScanSummary {
  results: ScanSourceResult[];
  inserted: number;
}

/** 扫描一个数据源并入库。已记录过且未改动的文件直接跳过。 */
function scanOne(
  source: UsageSource,
  options: { db: DatabaseSync; root: string; force: boolean; prices: Record<string, PriceEntry> },
): ScanSourceResult {
  const { db, root, force, prices } = options;
  const files = source.findFiles(root);

  const result: ScanSourceResult = {
    name: source.name,
    label: source.label,
    root,
    filesTotal: files.length,
    filesScanned: 0,
    filesSkipped: 0,
    lines: 0,
    events: 0,
    inserted: 0,
    skippedLines: 0,
    unreadableFiles: [],
    unpricedModels: [],
  };

  const unpriced = new Set<string>();

  for (const file of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      result.unreadableFiles.push(file);
      continue;
    }

    const previous = getFileState(db, file);
    if (!force && previous !== null && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) {
      result.filesSkipped += 1;
      continue;
    }

    const parsed = source.parseFile(file);
    result.filesScanned += 1;
    result.lines += parsed.stats.lines;
    result.skippedLines += parsed.stats.skipped;
    result.events += parsed.events.length;

    const { priced, unpricedModels } = priceEvents(parsed.events, prices);
    for (const model of unpricedModels) unpriced.add(model);

    try {
      const inserted = insertEvents(db, priced);
      result.inserted += inserted;
      setFileState(db, file, stat.mtimeMs, stat.size, inserted);
    } catch (err) {
      result.unreadableFiles.push(`${file}（入库失败：${(err as Error).message}）`);
    }
  }

  result.unpricedModels = [...unpriced];
  return result;
}

export function scanSources(options: ScanOptions): ScanSummary {
  const { db, sources, force = false, prices, rootOverride } = options;
  const results: ScanSourceResult[] = [];

  for (const source of sources) {
    const root = rootOverride !== undefined && sources.length === 1 ? rootOverride : source.defaultRoot();
    results.push(scanOne(source, { db, root, force, prices }));
  }

  setMeta(db, 'last_scan_at', new Date().toISOString());
  return { results, inserted: results.reduce((sum, result) => sum + result.inserted, 0) };
}
