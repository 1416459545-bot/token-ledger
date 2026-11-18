import type { UsageEvent } from '../core/types.ts';

/**
 * 事件级 JSONL 导出：与 `import` 的通用格式完全兼容，
 * 因此「导出 → 在另一台机器 import」就能合并两个账本。
 *
 * 只导出 token 数字与元数据，不含任何 prompt / 回复内容。
 */
export function renderJsonl(events: UsageEvent[]): string {
  return events
    .map((event) =>
      JSON.stringify({
        ts: event.ts,
        source: event.source,
        provider: event.provider,
        model: event.model,
        project: event.project,
        session_id: event.sessionId,
        input_tokens: event.inputTokens,
        output_tokens: event.outputTokens,
        cache_read_tokens: event.cacheReadTokens,
        cache_write_tokens: event.cacheWriteTokens,
      }),
    )
    .join('\n');
}
