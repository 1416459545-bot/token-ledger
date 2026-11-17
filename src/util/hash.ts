import crypto from 'node:crypto';

/** 短而稳定的内容哈希，用于生成幂等主键。 */
export function shortHash(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}
