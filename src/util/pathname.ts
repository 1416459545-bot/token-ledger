/**
 * 取路径最后一段，**同时兼容 Windows 反斜杠与 POSIX 斜杠**。
 * 不能用 path.basename：它只认当前平台的分隔符，在 Linux 上遇到 `C:\work\alpha` 会原样返回。
 */
export function lastSegment(p: string): string {
  const parts = p
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter((segment) => segment !== '');
  return parts.length > 0 ? parts[parts.length - 1] : '';
}
