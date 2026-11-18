import { execSync } from 'node:child_process';

// 把 ui/app.ts（复用 src 里的 period / html 渲染逻辑）打成浏览器可用的 ESM
execSync(
  'npx esbuild ui/app.ts --bundle --format=esm --target=es2022 --outfile=ui/app.js',
  { stdio: 'inherit' },
);
console.log('built ui/app.js');
