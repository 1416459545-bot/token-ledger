import { claudeSource } from './claude.ts';
import { codexSource } from './codex.ts';
import type { UsageSource } from './types.ts';

/** 已支持的数据源。新增数据源：实现 UsageSource，然后加到这个数组。 */
export const SOURCES: UsageSource[] = [claudeSource, codexSource];

export const SOURCE_NAMES: string[] = SOURCES.map((source) => source.name);

export function findSource(name: string): UsageSource | undefined {
  return SOURCES.find((source) => source.name === name);
}

export type { ParseStats, ParseResult, UsageSource } from './types.ts';
