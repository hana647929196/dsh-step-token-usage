# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.0] — 2026-10-05

首个公开版本。

### 功能

- 每一条助手回复上方常显 token 用量胶囊（不再需要悬停，不再只在轮末出现）
- 点击展开该步的逐次模型请求明细：提供方 / 模型、未缓存输入、缓存读取、缓存写入、输出（含推理）、合计、缓存命中率
- `llm/retry` 重试单独成行，显示尝试序号、失败码与原因
- 缺失字段标注为「未上报」，并区分核心字段（`input`/`output`）与可选字段（`cacheRead`/`cacheWrite`）的严重程度
- 中英双语

### 实现

- 通过 `ctx.uiConversation.events.register()` 新增 `step-usage` 对话节点 Definition
- 在 keyed slot `conversation.chat.node` 下注册同名渲染单元
- 不改动、不替换、不 patch 任何官方包
- Host 半为空 `apply()`；纯客户端展示改动，无构建步骤

### 已验证

- 在 **DSH 0.1.7-rc.2** 上实测挂载成功，`conversation.chat.node` 的占有者中出现 `step-usage`
- 49 个真实会话 / 7000+ 个 step 的离线校验通过（`node scripts/verify.mjs`）：
  - 恒等式 `合计 = 未缓存输入 + 缓存读取 + 缓存写入 + 输出` 在 **全部** 样本上成立（撰写时 7040 / 7040）
  - 每一行的 `anchorSeq` 均严格等于其落定的 `assistant/message` 序号
  - 中英词典键集一致（各 32 键）
  - 缺失字段保持 `null`，未被写成 `0`
