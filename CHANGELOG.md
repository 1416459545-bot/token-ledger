# Changelog

本项目的所有重要变更都会记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

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
