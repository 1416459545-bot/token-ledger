# 贡献指南

先谢谢你愿意花时间。这个项目很小，所以规矩也尽量少。

## 环境

- Node.js **≥ 22.18**（需要原生 TypeScript 类型剥离）
- **不需要** `npm install` —— 本项目零运行时依赖，测试用 Node 内置的 `node:test`

```bash
node --test
node src/cli.ts doctor
```

## 你可以怎么帮

1. **报 Bug** —— 用 Bug 模板，附上 `node src/cli.ts doctor` 的输出（**请先打码路径里的用户名**）。
2. **加数据源** —— 现在只支持 Claude Code。Codex CLI、Gemini CLI 等都在 Roadmap 上，见下方「新增数据源」。
3. **补价格表** —— 发现新模型没价格？欢迎在 `src/core/pricing.ts` 里加一行，或写 `prices.json` 示例。
4. **改文档** —— 包括中文错别字。这个项目的中文文档比代码还重要。

## 新增数据源

1. 在 `src/sources/` 下新建 `xxx.ts`，实现 `UsageSource` 接口（见 `src/sources/types.ts`）：
   - `name` / `label`
   - `defaultRoot()` —— 日志默认目录（支持环境变量覆盖更好）
   - `findFiles(root)` —— 递归找出该源的日志文件
   - `parseFile(filePath)` → `{ events: UsageEvent[], stats }`
2. 在 `src/sources/index.ts` 的 `SOURCES` 数组里注册。
3. 解析器必须遵守三条铁律：
   - **只取 token 数字和元数据，绝不读取 prompt / 回复正文**
   - 坏行只计数、不中断（真实日志里一定有脏数据）
   - 事件主键必须稳定且幂等：`xxx:<message.id>` 或内容哈希
4. 补 `test/` 下的 fixture + 测试，并在 README 的「支持」列表里打勾。

> 判定标准很简单：`node src/cli.ts scan && node src/cli.ts report` 能在真实日志上跑出合理的数字。

## 代码风格

- TypeScript 严格模式，但**不引入构建步骤**：不写 `enum`、`namespace`、参数属性，type-only 导入一律用 `import type`。
- 相对导入必须带 `.ts` 后缀（Node 原生要求）。
- 表格输出请用 `src/output/table.ts`，它按**显示宽度**对齐（中文和 emoji 是双宽）。
- 金额一律保留 6 位小数（`round6`），避免 `0.12000000000000001` 漏进 JSON。

## 提交与 PR

- 提交信息用 Conventional Commits：`feat:` / `fix:` / `docs:` / `test:` / `chore:`。
- 一个 PR 只做一件事。
- PR 描述里写清楚：**改了什么、为什么、怎么验证的**。
- 测试必须全绿：`node --test test`。

## 行为准则

参与即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。技术讨论可以尖锐，人身攻击不行。

## 关于「估算值」

成本永远是估算。不要试图让价格表「绝对精确」——provider 的计费规则、缓存折扣、批量折扣都在变。**宁可标 `n/a`，也不要编一个看起来很准的数字。**
