## 这个 PR 做了什么

<!-- 一句话说清改了什么 -->

## 为什么

<!-- 解决什么问题？可以关联 issue：#123 -->

## 怎么验证

<!-- 贴命令、输出片段，或说明新增的测试 -->

```bash
node --test test
node src/cli.ts scan && node src/cli.ts report
```

## 检查清单

- [ ] `node --test test` 全绿
- [ ] 在真实日志上跑过 `scan` + `report`，数字合理
- [ ] **没有提交** `ledger.db`、用户日志或任何隐私数据（日志请脱敏）
- [ ] 用户可见的变更已更新 `CHANGELOG.md`
- [ ] 新增逻辑有对应测试
- [ ] 没有引入运行时依赖（本项目坚持零依赖）
