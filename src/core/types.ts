/**
 * 账本的核心数据结构。
 *
 * 设计原则：一条 UsageEvent 只描述「一次 API 调用的 token 消耗」，
 * 不持有任何 prompt / 回复正文。隐私承诺从数据结构层面保证。
 */
export interface UsageEvent {
  /** 稳定主键，用于幂等去重，例如 `claude:msg_01ABC...` */
  id: string;
  /** ISO 8601 时间戳 */
  ts: string;
  /** 数据来源，例如 `claude-code` */
  source: string;
  /** 模型提供方，例如 `anthropic` */
  provider: string;
  /** 原始模型名，例如 `claude-opus-5-5` */
  model: string;
  /** 归属项目名（通常是工作目录名），可能为空 */
  project: string | null;
  /** 会话标识，可能为空 */
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** 预估成本（美元）。未定价模型为 null。 */
  costUsd: number | null;
}

export type GroupBy = 'day' | 'model' | 'project' | 'source';

export interface AggregateRow {
  key: string;
  events: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  unpriced: number;
}

export interface Totals {
  events: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  cost: number;
  unpriced: number;
}
