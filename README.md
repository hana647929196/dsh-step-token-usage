# dsh-step-token-usage

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![DSH](https://img.shields.io/badge/DSH-0.1.7--rc.2-4c6ef5)](#兼容性)

**把 token 用量常显在每一条助手回复上，点开即可查看该步的逐次模型请求明细（含重试）。不改动任何官方包。**

> A DSH Web GUI plugin that puts an always-visible token pill on **every** assistant reply, expanding into that step's exact per-request ledger (retries included). No shipped package is patched. · [English](README.en.md)

---

## 它解决什么问题

在「设置 → 性能与用量」里选了 **详细** 之后，DSH 官方只在 **每一轮的末尾** 显示一个用量胶囊，而且默认还要 **悬停** 才出现。一轮中间那几十次工具调用请求花了多少 token，你完全看不到。

而真实成本恰恰就在那里。在本机实测的一个真实会话里：

| 轮次 | 模型请求次数 | 未缓存输入 | 缓存读取 | 输出 | 合计 |
|---|---|---|---|---|---|
| 1 | 38 | 59,254 | 1,815,936 | 6,995 | **1,882,185** |
| 2 | 14 | 13,817 | 980,864 | 2,947 | **997,628** |

一轮 38 次请求、接近 190 万 token —— 数字是真的（每次工具调用都要重发上下文），但只看轮末那个胶囊，你无从知道它从哪来。

这个插件把用量 **下沉到每一个助手步骤**：每条回复各显示自己那一次请求的 token，点开还能看到这一步内部的逐次请求与重试。

## 功能

- 📌 **常显**：每条助手回复上方一个用量胶囊，不需要悬停
- 🧮 **逐条**：显示该次请求的 token 构成 —— 未缓存输入、缓存读取、输出
- 🔍 **点开看逐次请求**：提供方 / 模型、未缓存输入、缓存读取、缓存写入、输出（含推理）、合计、缓存命中率
- 🔁 **重试可见**：`llm/retry` 的尝试序号、失败码与原因单独成行，不与成功请求混淆
- 🚫 **缺失即标注，绝不补零**：提供方没上报的字段显示「未上报」，并说明合计的来历
- 🌐 **中英双语**，跟随 DSH 语言设置
- 🧩 **不冲突**：会话级汇总胶囊与官方轮次汇总都保持原样

## 截图

> **待补**：本仓库作者的环境无法对 GUI 截图，`docs/` 下暂缺示意图。建议补两张 —— 折叠态（每条回复上的胶囊）与展开态（逐次请求明细）。

## 安装

### 从 GitHub 直接安装（推荐）

```bash
dsh plugin --profile web add github:hana647929196/dsh-step-token-usage

# 锁定版本 tag（推荐）
dsh plugin --profile web add github:hana647929196/dsh-step-token-usage#v1.0.0
```

装完**刷新页面**即可。若未生效，重启 `dsh web`。

> 本插件是**纯 JavaScript 的客户端插件，没有构建步骤**，所以不需要 `pnpm run dev:web`。作者本机实测：安装完成后热加载当场生效，连页面刷新都不需要。

### 从源码本地打包

```bash
cd dsh-step-token-usage
npm pack
dsh plugin --profile web add dsh-step-token-usage-1.0.0.tgz
```

### 手动安装（无 pnpm 时）

1. 把整个包拷贝到 `~/.dsh/profiles/web/node_modules/dsh-step-token-usage`
2. 在 profile 的 `package.json` 里把 `"dsh-step-token-usage"` 追加进 `dsh.profile.bundles`
3. 在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: step-token-usage
      name: 'dsh-step-token-usage'
```

## 用法

安装后无需任何配置。每条助手回复上方会出现一行胶囊：

```
🗄 用量 27.4K  ▾   · 未缓存 26.1K · 缓存读 1.2K · 输出 174
```

点它展开该步的明细：

```
逐次模型请求                                    第 3 轮 · 第 59 步
─────────────────────────────────────────────────────────────
重试 1/5   deepseek-official   TRANSPORT
  DeepSeek Messages transport failed
  该次请求未上报用量
─────────────────────────────────────────────────────────────
请求 1     deepseek-official / deepseek-flash
  未缓存输入                                     1,354
  缓存读取                                     167,808
  缓存写入                                           0
  输出                                             330
  合计                                         169,492
```

- **中间步骤**（工具调用轮）会和它们的正文一起折叠进该轮的「工作过程」里 —— 展开工作过程就能看到每一步的胶囊，和官方折叠行为一致。
- **最终回答那一步**的胶囊始终直接可见。

## 数据口径

- **数据源**：会话持久日志里 `assistant/message` 事件自带的 `data.usage`，即提供方上报的精确值。插件不估算、不外推。
- **一个 step 通常就是一次计费请求**：本机 7033 个 step 的实测中，一个 step 从不多于一条 `assistant/message`。
- **合计**优先使用提供方上报的 `totalTokens`；只有在它缺失时才按分项加和，并在界面上注明「合计为各分项加和」。
- **恒等式**：`合计 = 未缓存输入 + 缓存读取 + 缓存写入 + 输出` 在作者本机 **全部** 已存样本上成立（撰写时 7040 / 7040）。
- **未缓存输入**即 `inputTokens`，**不包含**缓存部分。

## 设计取舍

有两处决定不是随意选的，这里说清楚，避免后来者"顺手优化"时踩坑。

### 1. 胶囊排在回复正文的上方，而不是下方

这不是排版偏好，是被引擎规则逼出来的，`anchorSeq` 只能取一个值：**该步落定的 `assistant/message` 序号**。

- 只要 **小一点**：节点会被判定为「工作过程成员」，折叠进该轮默认收起的进程组里 —— 最终回答那一步的胶囊就默认看不见了，直接废掉这个插件的核心诉求。
- 只要 **大一点**：官方轮尾会认为「后面还有内容」（`hasLaterChatNode`），从而把 **分支 / fork 按钮置灰**，破坏既有功能。
- **正好相等**能同时避开两者：既不被折叠，也不算「后续内容」。

代价是排序落到引擎的 context-key 比较上，于是胶囊排在 assistant 行**之前**。所以它看起来像回复的「请求成本表头」。

### 2. 缺失数据标注，而不是补零

提供方没给的字段一律留 `null`，界面显示「未上报」。并且区分了严重程度：

- `input` / `output` 缺失 → 警告（计费口径本身不完整）
- `cacheRead` / `cacheWrite` 缺失 → 中性说明（部分提供方不报缓存）
- `reasoningTokens` 缺失 → **完全忽略**

最后一条是实测倒逼的：`reasoningTokens` 几乎从不单独上报，如果把它算作"缺失"，那么 **每一条** 都会弹出缺失警告，真正的异常反而被淹没。

## 与 `dsh-conversation-stats` 的区别

生态里已经有一个 [`dsh-conversation-stats`](https://github.com/wellcover/dsh-conversation-stats)，两者互补而非重复：

| | dsh-conversation-stats | 本插件 |
|---|---|---|
| 位置 | 顶部新增「会话统计」tab | 内联在对话流里 |
| 范围 | 跨会话总览、可复盘 | 当前对话、逐条 |
| 维度 | 轮/步/调用数、LLM 与工具耗时、模型分布 | 每条回复的 token 构成、逐次请求、重试 |
| 典型用法 | 事后统计与对比 | 边看边理解「这次为什么这么贵」 |

**两者可以同时安装**：它新增一个 view tab，本插件只新增一种对话行，互不占用。

## 兼容性

- 实测于 **DSH 0.1.7-rc.2**。
- 依赖两个文档化的扩展点，不依赖任何私有实现：
  - `ctx.uiConversation.events.register()` 注册对话节点 Definition
  - `conversation.chat.node` 这个 keyed slot 注册渲染单元（官方契约明确写着「a kind with no occupant renders no row」，即新增 kind 不会与官方冲突）
- **不 import 任何 DSH 客户端包**（不 require `dsh-client-ui-primitives` 等），只从浏览器模块表取 `react`。因此官方包升级不会因为导入路径变化而崩。
- 样式只使用 `--dsw-alias-*` / `--dsh-*` 主题 token，全部带 fallback，明暗主题自适应。
- **升级注意**：如果未来 DSH 改动了「工作过程折叠」或「轮尾分支可用性」的判定规则，胶囊的排序位置可能需要重新核对。`scripts/verify.mjs` 会对 `anchorSeq` 做断言，升级后跑一次就能发现。

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 对话里看不到胶囊 | 确认插件已挂载：`conversation.chat.node` 的占有者里应出现 `step-usage`；刷新页面，仍无则重启 `dsh web` |
| 只有最新一轮有胶囊 | 更早的轮次还没加载到窗口内，向上滚动触发翻页即可 |
| 某条回复显示「用量未上报」 | 该步确实没有提供方用量（通常是中断或请求失败），这是如实显示 |
| 中间步骤看不到胶囊 | 它们和正文一起被官方折叠进「工作过程」，展开那一组即可 |
| 装了插件但官方轮尾的按钮要悬停才出现 | 已知的轻微副作用，刷新页面后恢复；**分支按钮不受影响**（详见上文「设计取舍」） |

## 工作原理

**Host 半（`lib/index.js`）**：空的 `apply()`。本插件是纯客户端展示改动，不需要路由、服务、投影或配置项，Host 半只是让这个包成为一个可挂载的 DSH 插件。

**Client 半（`lib/client.js`）**：以 `window.__ModuleLoader__.load` 注册的懒工厂（`react` 取自浏览器模块表，无 JSX、无构建）。`apply` 里做三件事：

1. 注册中英词典到 `ctx.locale`
2. 用 `ctx.uiConversation.events.register()` 注册 kind 为 `step-usage` 的 Definition —— 匹配 `step/start`、`assistant/message`(append)、`llm/retry`，按 `${turn}:${step}` 聚合
3. 在 `conversation.chat.node` 这个 keyed slot 下注册同名渲染单元

**数据流**是纯函数式的：Definition 的 state 只保存 `turn`/`step` 身份，全部账目在物化时从 `context.matches` 直接折叠出来（`deriveStepUsage`），因此窗口从半步中间开始、没有 `step/start` 时同样正确。

## 开发与验证

仓库自带一个离线校验脚本，它把 Client 半挂在假的 module loader 与 Cordis 上下文上，然后把 Definition 跑遍本机所有会话日志，检查那些在浏览器里很难肉眼看出的性质：

```bash
npm run verify
# 等价于（npm 不可用时）：
node scripts/verify.mjs
# 指定 DSH_HOME：
DSH_HOME=/path/to/dsh_home node scripts/verify.mjs
```

它会断言：Definition 与渲染单元注册在同一个 kind 上、中英词典键集一致、每一行的 `anchorSeq` 都等于其落定消息、用量样本不自相矛盾、缺失字段没有被写成 0。

作者本机（49 个会话）的结果，以下为撰写时的快照，数字会随会话继续增长：

```
steps 7048 | materialized 7043 | withUsage 7040 | withoutUsage 3
requests 7042 | retries 6
missingCore 0 | missingOptional 11
invariantOk 7040 | invariantBad 0 | anchorBad 0
OK — no invariant broken.
```

## License

[MIT](./LICENSE)
