# Changelog

本项目的所有重要变更都会记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.5.0] - 2026-11-17

### Added

- `export --format html`：单文件 HTML 看板
  - 完全自包含（零外部 CSS/JS/字体/图片），断网可开，自动适配深浅色
  - 每日用量柱状图 + 按模型/项目/数据源表格 + 预算进度条
  - 默认写入 `token-ledger-<月份>.html`，避开 PowerShell `>` 的 UTF-16 问题
  - 所有模型名/项目名做 HTML 转义，防止注入

## [0.4.0] - 2026-11-17

### Added

- **GitHub Action**（composite，仓库根目录 `action.yml`）：在 PR 中评论 token 用量与预估花费
  - 同一条评论按 marker 幂等更新，不会每次运行都刷一条
  - 找不到数据时明确说明原因，而不是贴 0
  - 支持 `import-file` 导入本地用量文件
- `comment` 命令：`--dry-run` 可在本地预览评论内容

## [0.2.0] - 2026-11-17

### Added

- **Codex CLI 数据源**：解析 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
  - 按 `total_token_usage` 做增量差分计费，同一回合重复发出的 `token_count` 不会重复记账
  - `input_tokens` 中拆出缓存命中（`cached_input_tokens`）与缓存写入（`cache_write_input_tokens`）
  - 模型取自 `turn_context.payload.model`，项目名取自 `cwd`
- 多数据源架构：`scan --source claude-code|codex|all`，`doctor` 列出各数据源状态
- `import <file.jsonl>`：通用 JSONL 用量导入。任何工具导出的用量都能进账本，主键为内容哈希，重复导入不重复记账

### Fixed

- 跨平台项目名推断：`cwd` 含 Windows 反斜杠时，在 macOS / Linux 上会退化成整条路径（现改为同时识别 `\` 与 `/`）

## [0.1.0] - 2026-11-17

第一周目标达成：**能记账、能看账、能管预算**。

### Added

- `scan`：扫描 Claude Code 会话日志（`~/.claude/projects/**/*.jsonl`）并入库
  - 增量扫描（按 `mtime + size` 跳过未变文件），`--force` 全量重扫
  - 幂等入库，重复扫描不会重复记账
  - 跳过 `<synthetic>` 合成消息、零消耗消息与坏行
  - 兼容 `cache_creation_input_tokens` 与嵌套 `cache_creation` 两种缓存字段
- `report`：按模型 / 项目 / 天聚合，支持 `--month`、`--by`、`--json`
- `budget set|show|clear`：月度预算、余额、剩余天数、日均还能花多少
- `export`：导出 Markdown 或 CSV 账单
- `rice`：白饭彩蛋，1 碗 = 100 万 tokens
- `doctor`：诊断日志路径、数据量、价格表状态
- 价格表：内置常见模型族，支持 `~/.token-ledger/prices.json` 覆盖
- 未知模型成本记为 `n/a`，绝不瞎猜
- 隐私设计：只存 token 数字与元数据，不保存任何 prompt 内容
- 零运行时依赖（`node:sqlite` + `node:test`），无需构建步骤

### Known issues

- 仅支持 Claude Code 一个数据源
- 不支持代理模式与 Web 看板
