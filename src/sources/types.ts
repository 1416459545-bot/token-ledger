import type { UsageEvent } from '../core/types.ts';

/** 一个数据源的解析统计。 */
export interface ParseStats {
  /** 参与解析的非空行数 */
  lines: number;
  /** 被跳过的行数（无关行 / 坏行 / 零消耗） */
  skipped: number;
  /** 成功解析出的用量事件数 */
  events: number;
}

export interface ParseResult {
  events: UsageEvent[];
  stats: ParseStats;
}

/**
 * 一个数据源 = 「去哪儿找文件」+「怎么把文件解析成用量事件」。
 * 新增数据源只要实现这个接口，然后在 sources/index.ts 注册。
 */
export interface UsageSource {
  /** 稳定标识，写进 events.source，也用于 --source */
  name: string;
  /** 人类可读名称 */
  label: string;
  defaultRoot(): string;
  findFiles(root: string): string[];
  parseFile(filePath: string): ParseResult;
}
