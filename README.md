# dsh-trellis

DeepSeek Harness (dsh) host 插件：把 [Trellis](https://github.com/mindfold-ai/Trellis) 工作流带进 dsh，并尽量沿用 DSH 原生能力补齐 Codex / Claude Code 级体验：

1. **每轮 workflow-state 面包屑注入** — 在每个 `agent/pre-step`，解析项目 `.trellis/workflow.md` 的 `[workflow-state:*]` 块 + 活跃任务状态（no_task / planning / in_progress），把对应面包屑注入会话（与 `dsh-agent-instructions` 的注入管道相同）。未变化不重复注入；被压缩后自动重注入；提示词里出现独立单词 `no-trellis` 可跳过当轮。
2. **隔离的原生会话上下文身份** — 从当前 agent 的 DSH 原生 session header 生成受管的 `DSH_TRELLIS_CONTEXT_ID`，让 `task.py start/create/current` 解析到会话级 active-task 指针，并在子代理身份不同于 shell 自身 session 时优先使用被转发的身份；插件命令启动的子进程也显式使用同一个 DSH 身份。
3. **原生子代理同步** — 安装插件后，Trellis 角色可用 DSH continuable 后台子代理；主会话先继续独立工作，耗尽后可调用事件驱动的 `trellis_wait`。它监听 DSH 的 `subagent/end`，利用 lifecycle 自带的 run/provider/output-block 元数据返回 `completed / failed / aborted / unknown` 的 fail-closed 结论。`error`、`max-tokens`、`refusal` 和未来未知失败原因都不会被误报成通过。rc.8 在父会话 idle 时也会用原生 settlement notice 唤醒，因此已经结束当前轮时无需额外调用 wait。
4. **`/trellis` 命令** — `/trellis-status`（活跃任务 + git 状态）、`/trellis-finish`（只读检查 + 安全收尾清单，不提前清 active-task 指针）。命令输出不进模型历史；真正的会话收尾走技能面 `/trellis-finish-work`，由技能先归档再写 journal。rc.8 下两条零输入命令使用 `recordInput: false`，并显式拒绝参数和图片附件，避免静默忽略输入。
5. **Web 配置菜单** — DSH rc.8 的“设置 → 插件 → 插件配置”会显示 Trellis 工作流卡片，可分阶段编辑全部六个配置项、恢复 profile 配置层并保存。写入经过 namespace revision fencing 和保存后读回确认；配置实时生效，禁用插件后卡片仍保留，可直接重新启用。

非 Trellis 项目不注入面包屑；命令只有被用户显式调用时才会检查并返回“未初始化 Trellis”。

这是 Trellis DSH 适配的**可选伴侣插件**，不是使用 `trellis init --dsh` 的前置条件。workflow 会按能力选择路径：存在 `trellis_wait` 时才使用 continuable 后台派发和事件汇合；未安装插件时，依赖结果的子代理从一开始就用 `run_in_background: false` 前台派发。两条路径都禁止 sleep 或轮询，Trellis CLI 也不会自动安装任何 DSH profile 插件。

## 安装

```powershell
# 装进实际使用的 profile（均在该 profile 下次启动时生效）
dsh plugin --profile web add dsh-trellis
dsh plugin --profile headless add dsh-trellis

# 如果你维护独立的 tui profile，也需要装进该 profile
dsh plugin --profile tui add dsh-trellis
```

`dsh plugin` 会把插件安装到指定 profile；每个实际使用的 profile 都需要单独安装。升级到 npm 上的最新版本：

```powershell
dsh plugin --profile web update dsh-trellis
dsh plugin --profile headless update dsh-trellis
```

对 `tui` profile 使用同样的 update，并在该 profile 下次启动时生效。

如果要从源码开发或验证尚未发布的版本，可以改用本地 `file:` 安装：

```powershell
git clone https://github.com/SajoLuo/dsh-trellis.git
cd dsh-trellis
pnpm install --frozen-lockfile
pnpm run build:client
dsh plugin --profile headless add file:C:/path/to/dsh-trellis
```

`file:` 插件会作为 profile 内的 pnpm 快照安装；拉取源码更新后，尤其是版本新增文件时，需要先 remove 再 add 刷新该 profile。

配套要求：项目的 Trellis 平台需包含 dsh（`trellis init --dsh`，见 Trellis-DeepSeekHarness 适配分支），且 `.trellis/scripts` 需包含读取原生 `DSH_SESSION_ID` 的适配（已含在同一分支）。插件以 DSH `0.1.0-rc.8` 作为开发/测试基线；Host 功能的 peer dependency 下限仍是 `rc.6`，用于兼容已安装的旧 profile，Web 配置卡片则只在具备 settings/client surface 的 rc.8 profile 中加载。

### DSH rc.8 对齐说明

- 已采用：command lifecycle 的 `recordInput`、command attachment envelope 的 fail-closed 输入检查、`subagent/end` 的 run/provider/final-output 元数据、rc.8 的 report-before-settlement 与 idle-parent 原生唤醒语义。
- 已接入：Host `dsh-trellis` settings namespace 与 `dsh.client` 浏览器卡片。保存值写入 DSH 的 `settings.yaml` 用户层，并实时重挂插件 runtime；rc.6 不具备该服务时自动退回原有 loader 配置，不影响 Host 插件加载。
- 保持可选：`trellis_wait` 仍是“父会话还在当前轮里、需要明确同步点”时的工具；已经 yield 的父会话直接由 DSH 原生 settlement notice 唤醒。
- 暂不接入：Agent Teams 在 rc.8 仍位于 `packages/experimental` 且不随正式 npm family 发布。Trellis 不应为此引入私有依赖；等它进入公开稳定面后再评估共享 task board / mailbox 映射。

## 配置

DSH rc.8 Web profile 直接打开“设置 → 插件 → 插件配置 → Trellis 工作流”。保存内容进入该 DSH_HOME 的 `settings.yaml`，优先级高于 profile 组合层并立即生效。

Headless、rc.6 或需要声明部署默认值时，仍可在 profile 的 `cordis.patch.yml` 里覆盖（整行替换）；Web 卡片的“恢复配置文件值”会清除用户层字段并重新继承这里的值：

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
- **会话身份**：DSH 原生提供 `DSH_SESSION_ID = agent.session.header.id`，并先丢弃环境中已有的 `DSH_*` 再重建受管命名空间。Trellis beta 因此会在同时看到 `DSH_SHELL=1` 与 `DSH_SESSION_ID` 时优先解析当前 DSH 身份，即使没有插件也不会被外层 host 继承的 `TRELLIS_CONTEXT_ID` 串任务。插件通过 `shellEnv` 为每次执行额外生成 `DSH_TRELLIS_CONTEXT_ID = dsh_<session-id>`，用于转发可能不同于 shell 自身 session 的子代理身份；主会话与子代理仍各自保留 DSH 身份，子代理通过派发 prompt 首行的 `Active task:` 和角色 prelude 取得父任务上下文。
- **Headless 会话**：每次 `dsh --profile headless` 调用都是新的 DSH session。需要跨轮保留 active-task 指针时，应保持同一会话或显式 resume 返回的 session id，不能把多个独立 headless 调用当成同一 session。
- **取消与生命周期**：命令和 `trellis_wait` 都继承 DSH invocation 的 `AbortSignal`；取消后命令不会继续尝试另一个 Python 启动器，等待工具也会立即注销临时事件监听器。`trellis_wait` 只在收到配对的结算事件时声明 `settlementNoticeQueued=true`；仅从 catalog 看到 inactive 时保持 `unknown`，不猜任务通过。插件卸载时只注销自己的命令、工具和监听器。
- **子代理并发**：workflow 只有在发现 `trellis_wait` 时才使用 DSH 原生 continuable 后台 `subagent`。主会话并行做独立工作；需要汇合时调用一次 `trellis_wait <subagent_id>` 等待原生结算事件。没有该工具时，首次派发直接设置 `run_in_background: false`，绝不留下无法事件汇合的后台子代理。

## 开发

```powershell
pnpm install
pnpm run build:client
pnpm test    # node --test test/*.test.js
```

Host half 是直接由 `main` 加载的 ESM JavaScript；Web half 通过 tsdown 生成 DSH lazy-CJS factory 到 `lib/client.js`。`pnpm pack` 会在 prepack 阶段自动重建客户端 bundle。

## License

MIT
