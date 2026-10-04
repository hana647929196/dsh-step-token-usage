# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] — 2026-10-05

### 变更

- **展开的明细从内联面板改为浮动弹框**，与官方「本轮用量」弹框同一套样式：
  - 同一 `stat-dialog` 表面 —— `--dsw-specific-menu` 底色（浅色 `#f8f9faf0` / 深色 `#303136f0`）、`--dsw-menu-backdrop-filter`（`blur(40px) saturate(150%)`）、`--dsw-elevation-prominent` 投影
  - 同一 `z-index:1100`、`--dsw-radius-lg` 圆角、16px 内边距、12px/18px 字号行高、`min(300px,100vw-24px)` ~ `min(440px,100vw-24px)` 宽度
  - 同一结构：标题（左图标+文案，右数值）+ 分隔线 + 两列 `dt`/`dd` 字段网格，数值右对齐并用 `tabular-nums`
  - 触发按钮也对齐官方胶囊的尺寸与悬停态（28px 高、`radius-sm`、`label-tertiary`）
- 弹框经 `ReactDOM.createPortal` 挂到 `document.body`，`position: fixed` 锚定在胶囊上方并做视口夹取；滚动、缩放、弹框自身尺寸变化时重新定位
- 点击弹框外部或按 `Esc` 关闭（与官方弹框一致的交互）
- 数值带官方单位后缀，形如 `2,264 tok`；字段名沿用官方（未缓存输入 / 缓存读取 / 缓存写入 / 输出 / 合计 / 缓存命中）
- 新增 `轮次 / 步` 字段以便定位；多请求步骤按 `请求 N` 分区，重试按 `重试 N/M` 分区

### 实现

- 因为插件不能 import 官方客户端包，弹框样式与两个交互行为（`useAnchoredPosition` 的 `side:"top"` / `align:"start"` / gap 8 / margin 12 定位算法、`useDismissOnOutsidePointer` 的外部点击关闭）是**照抄并改写**到插件内的，类名统一在 `stu-` 前缀下，只引用主题 token

### 验证

- 离线校验脚本新增**无头渲染断言**：直接调用已注册的渲染组件、检查产出的元素树，断言弹框结构（portal / `role="dialog"` / 标题 / 分隔线 / 两列字段网格）、数值带单位后缀、**缺失字段不会被显示成 0 且会在脚注里被点名**、以及重试分区包含失败码与原因

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
