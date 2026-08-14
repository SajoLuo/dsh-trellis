# dsh-trellis

DeepSeek Harness (dsh) host 插件：把 [Trellis](https://github.com/mindfold-ai/Trellis) 工作流带进 dsh，并尽量沿用 DSH 原生能力补齐 Codex / Claude Code 级体验：

1. **每轮 workflow-state 面包屑注入** — 在每个 `agent/pre-step`，解析项目 `.trellis/workflow.md` 的 `[workflow-state:*]` 块 + 活跃任务状态（no_task / planning / in_progress），把对应面包屑注入会话（与 `dsh-agent-instructions` 的注入管道相同）。未变化不重复注入；被压缩后自动重注入；提示词里出现独立单词 `no-trellis` 可跳过当轮。
2. **隔离的原生会话上下文身份** — 从当前 agent 的 DSH 原生 session header 生成受管的 `DSH_TRELLIS_CONTEXT_ID`，让 `task.py start/create/current` 解析到会话级 active-task 指针，并覆盖从外层 Claude/Codex Trellis 会话继承的普通 `TRELLIS_CONTEXT_ID`；插件命令启动的子进程也显式使用同一个 DSH 身份。
3. **原生子代理同步** — 安装插件后，Trellis 角色可用 DSH continuable 后台子代理；主会话先继续独立工作，耗尽后调用事件驱动的 `trellis_wait`。它监听 DSH 的 `subagent/end`，只在原生 settlement notice 已排入父会话后返回，不用 shell sleep、轮询或 `job_output`。
4. **`/trellis` 命令** — `/trellis-status`（活跃任务 + git 状态）、`/trellis-finish`（只读检查 + 安全收尾清单，不提前清 active-task 指针）。命令输出不进模型历史；真正的会话收尾走技能面 `/trellis-finish-work`，由技能先归档再写 journal。

非 Trellis 项目不注入面包屑；命令只有被用户显式调用时才会检查并返回“未初始化 Trellis”。

这是 Trellis DSH 适配的**可选伴侣插件**，不是使用 `trellis init --dsh` 的前置条件。workflow 会按能力选择路径：存在 `trellis_wait` 时才使用 continuable 后台派发和事件汇合；未安装插件时，依赖结果的子代理从一开始就用 `run_in_background: false` 前台派发。两条路径都禁止 sleep 或轮询，Trellis CLI 也不会自动安装任何 DSH profile 插件。

## 安装

```powershell
# 获取源码
git clone https://github.com/SajoLuo/dsh-trellis.git
cd dsh-trellis
pnpm install --frozen-lockfile

# 装进实际使用的 profile（均在该 profile 下次启动时生效）
dsh plugin --profile web add file:C:/path/to/dsh-trellis
dsh plugin --profile headless add file:C:/path/to/dsh-trellis

# 如果你维护独立的 tui profile，也需要装进该 profile
dsh plugin --profile tui add file:C:/path/to/dsh-trellis
```

配套要求：项目的 Trellis 平台需包含 dsh（`trellis init --dsh`，见 Trellis-DeepSeekHarness 适配分支），且 `.trellis/scripts` 需包含读取原生 `DSH_SESSION_ID` 的适配（已含在同一分支）。插件目标版本为 DSH `0.1.0-rc.6`；升级 DSH 时应重跑本仓测试。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖（整行替换）：

```yaml
- id: dsh-trellis
  config:
    maxBytes: 4096          # 面包屑注入的字节预算（0 = 关闭注入）
    skipKeyword: no-trellis # 提示词中的独立单词可跳过当轮注入（空 = 禁用）
    pythonCmd: ""           # 空 = 自动选择：Windows 先 py -3 再 python；其他系统先 python3 再 python
    commandsEnabled: true
```

## 工作原理

- **状态解析**（`lib/workflow.js`）：向上找项目根 → 读 `.trellis/workflow.md` 解析状态块 → 先看当前会话指针 `.trellis/.runtime/sessions/dsh_<id>.json`。当前指针缺失时只允许 Trellis 官方的“唯一 session 文件”回退；存在 0 个或 2 个以上 session 文件就拒绝猜测，避免多个 DSH 窗口串任务。
- **注入去重**：面包屑带 digest，与最近一次注入相同且仍在可见表面则不重复注入。
- **会话身份**：DSH 原生提供 `DSH_SESSION_ID = agent.session.header.id`，插件通过 `shellEnv` 为每次执行生成 `DSH_TRELLIS_CONTEXT_ID = dsh_<session-id>`。DSH 会先丢弃环境中已有的 `DSH_*` 再重建受管命名空间，因此这个值不会来自外层 host；Trellis beta 适配在普通 `TRELLIS_CONTEXT_ID` 之前解析它，避免嵌套启动时串到外层任务。主会话与子代理仍各自保留 DSH 身份，子代理通过派发 prompt 首行的 `Active task:` 和角色 prelude 取得父任务上下文。
- **取消与生命周期**：命令和 `trellis_wait` 都继承 DSH invocation 的 `AbortSignal`；取消后命令不会继续尝试另一个 Python 启动器，等待工具也会立即注销临时事件监听器。插件卸载时只注销自己的命令、工具和监听器。
- **子代理并发**：workflow 只有在发现 `trellis_wait` 时才使用 DSH 原生 continuable 后台 `subagent`。主会话并行做独立工作；需要汇合时调用一次 `trellis_wait <subagent_id>` 等待原生结算事件。没有该工具时，首次派发直接设置 `run_in_background: false`，绝不留下无法事件汇合的后台子代理。

## 开发

```powershell
pnpm install
pnpm test    # node --test test/*.test.js
```

无构建步骤：纯 ESM JavaScript，`main` 直接指向 `lib/index.js`。

## License

MIT
