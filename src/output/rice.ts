import { formatTokens } from '../util/format.ts';

/** 默认一碗白饭 = 100 万 tokens。 */
export const DEFAULT_BOWL_SIZE = 1_000_000;

export function bowlsFor(tokens: number, bowlSize: number = DEFAULT_BOWL_SIZE): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  const size = bowlSize > 0 ? bowlSize : DEFAULT_BOWL_SIZE;
  return Math.round((tokens / size) * 100) / 100;
}

export function renderRice(month: string, tokens: number, bowlSize: number = DEFAULT_BOWL_SIZE): string {
  const bowls = bowlsFor(tokens, bowlSize);
  const out: string[] = [];
  out.push(`🍚 白饭账本 · ${month}`);
  out.push('────────────────────────────');

  if (bowls === 0) {
    out.push('这个月一口白饭都没吃上……本鱼替你饿。');
    return out.join('\n');
  }

  out.push(`本月吃掉 ${formatTokens(tokens)} tokens，合 ${bowls} 碗白饭。`);

  const whole = Math.floor(bowls);
  const hasPartial = bowls - whole > 0.05;
  const shown = Math.min(whole, 10);
  let art = '🍚'.repeat(shown);
  if (hasPartial) art += '🥢'; // 正在吃的那一碗
  if (art === '') art = '🥢';
  if (whole > 10) art += ` +${whole - 10} 碗`;
  out.push(art);
  out.push('');

  if (bowls >= 10) out.push('……你这是拿 token 当饭吃啊。');
  else if (bowls >= 3) out.push('胃口不错，本鱼认可你这个饭搭子。');
  else out.push('吃得挺省，留点肚子给下个月。');

  return out.join('\n');
}
