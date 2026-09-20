# dsh-trellis

DeepSeek Harness (dsh) host 插件：把 [Trellis](https://github.com/mindfold-ai/Trellis) 工作流带进 dsh，并尽量沿用 DSH 原生能力补齐 Codex / Claude Code 级体验：

1. **每轮 workflow-state 面包屑注入** — 在每个 `agent/pre-step`，解析项目 `.trellis/workflow.md` 的 `[workflow-state:*]` 块 + 活跃任务状态（no_task / task_error / planning / in_progress），把对应面包屑注入会话（与 `dsh-agent-instructions` 的注入管道相同）。未变化不重复注入；被压缩后自动重注入；提示词里出现独立单词 `no-trellis` 可跳过当轮。
2. **隔离的原生会话上下文身份** — 从当前 agent 的 DSH 原生 session header 生成受管的 `DSH_TRELLIS_CONTEXT_ID`，让 `task.py start/create/current` 解析到会话级 active-task 指针，并在子代理身份不同于 shell 自身 session 时优先使用被转发的身份；插件命令启动的子进程也显式使用同一个 DSH 身份。
3. **原生子代理同步** — 安装插件后，Trellis 角色可用 DSH continuable 后台子代理；主会话先继续独立工作，耗尽后可调用事件驱动的 `trellis_wait`。它监听 DSH 的 `subagent/end`，利用 lifecycle 自带的 run/provider/output-block 元数据返回 `completed / failed / aborted / unknown` 的 fail-closed 结论。`error`、`max-tokens`、`refusal` 和未来未知失败原因都不会被误报成通过。rc.8 在父会话 idle 时也会用原生 settlement notice 唤醒，因此已经结束当前轮时无需额外调用 wait。
4. **`/trellis` 命令** — `/trellis-status`（活跃任务 + git 状态）、`/trellis-finish`（只读检查 + 安全收尾清单，不提前清 active-task 指针）。命令输出不进模型历史；真正的会话收尾走技能面 `/trellis-finish-work`，由技能先归档再写 journal。rc.8 下两条零输入命令使用 `recordInput: false`，并显式拒绝参数和图片附件，避免静默忽略输入。
5. **Web 配置菜单** — DSH `0.1.6-alpha.2` 的“插件 → trellis”详情页直接显示全部六个配置项；旧版 RC 继续使用“设置 → 插件 → 插件配置”卡片。支持分阶段编辑、恢复 profile 配置层和保存后读回确认。配置里的 `enabled=false` 会停用工作流功能但保留表单；插件管理器的整包或组件开关则会连同表单一起卸载。

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

对 `tui` profile 使用同样的 update。替换已加载的包版本后，需重启对应 DSH 进程；不要把新版插件管理器的实时开关误当作代码版本热更新。

DSH `0.1.6-alpha.2` 也可从 Web 侧栏“插件 → 添加插件”安装包。Web 安装后需要手动启用；CLI `add` 默认启用。安装命令仍是 `dsh plugin --profile <name> add <package>`，无需增加额外安装脚本。

如果要从源码开发或验证尚未发布的版本，可以改用本地 `file:` 安装：

```powershell
git clone https://github.com/SajoLuo/dsh-trellis.git
cd dsh-trellis
pnpm install --frozen-lockfile
pnpm run build:client
dsh plugin --profile headless add file:C:/path/to/dsh-trellis
```

`file:` 插件会作为 profile 内的 pnpm 快照安装；拉取源码更新后，尤其是版本新增文件时，需要先 remove 再 add 刷新该 profile。

配套要求：项目的 Trellis 平台需包含 dsh（`trellis init --dsh`，见 Trellis-DeepSeekHarness 适配分支），且 `.trellis/scripts` 需包含读取原生 `DSH_SESSION_ID` 的适配（已含在同一分支）。Host peer 范围显式覆盖 DSH `0.1.0-rc.6+`、`0.1.1-rc.1+`、`0.1.2-alpha.1+`、`0.1.3-alpha.1+`、`0.1.5-alpha.1+` 与 `0.1.6-alpha.2+` 六条已知预发布线，避免 npm 的 prerelease 语义把新版 Host 误判为不兼容。本仓开发基线固定为 `0.1.6-alpha.2`，另用隔离依赖回归 `0.1.5-rc.2`；这不代表逐个重新验证了所有历史版本。Host 侧 Settings 桥同时兼容旧版包级 helper 与当前 provider 方法，Web 配置界面只在具备 settings/client surface 的 profile 中加载。

运行时需要 profile 提供 `sessionProjections` 服务；该依赖由插件的 `inject` 声明。自定义或精简 profile 若未组装此服务，需先加载 `@deepseek-ai/dsh-session-projection`，否则插件会等待依赖，不会退回直接扫描历史。

### 0.1.7：DSH 0.1.6-alpha.2 适配

- 跟随[官方插件页 slot 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.2/packages/client/ui-plugin-manager/README.md)，第三方包配置注册到 `plugins.bundle.config`，以 `dsh-trellis` 包名为 key；详情页直接渲染表单，不重复包装标题和折叠卡片。保留旧 `settings.plugin.item` keyed/list 两种形态，按实际存在的 slot 延迟注册并随 owner 卸载。
- 依照[官方插件管理器规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.2/packages/boot/plugin-manager/README.md)，保留 `dsh.bundle.patch` 安装入口，增加 `dsh.manifestVersion: 1` 与 `engines.dsh` 兼容性声明。`engines.dsh` 在该宿主版本中是声明信息，不是运行时兼容性检查器。
- 升级开发依赖和锁文件；测试依赖使用新名 `dsh-ptc-runtime`，RC 回归隔离副本继续使用 `dsh-code-runtime`。`dsh.client.inject` 保留旧宿主需要的依赖信息；新宿主实际运行时模块请求仍由编译产物决定，不额外安装一份 Web 壳。
- 加固实时卸载：取消所有正在等待的 `trellis_wait`、注销结算监听器、拒绝旧工具引用继续执行；清除尚未消费的 Trellis 面包屑，但保留用户输入。异步 pre-step continuation 在卸载后不再注入。Settings 保存遇到断连或拒绝时显示失败、保留草稿并允许重试。
- 本轮不改变 Trellis 的任务绑定、Python 脚本或生成模板；继续保留 0.1.6 的精确会话指针和 `task_error` 行为。

### 既有 DSH 0.1.5-rc.2 对齐

- 已迁移：面包屑使用 `sessionProjections` 的纯 fold，在恢复或分叉时重建状态、按已提交事件增量更新，不再调用 Session 的 `eventAt()` / `snapshotEvents()` / `ownEvents()` 或访问旧事件集合。当前 DSH 注册 Host-only projection；旧版 registry 通过 projection snapshot 兼容，仅包含序号和 payload 哈希，不传输工作流正文。
- 已修复：恢复会话、插件或 Settings 重载后的首轮也会去重；以最后一条仍可见的面包屑判断，避免 A → B → A 状态切换被旧记录误抑制。压缩移除后会重新注入，字节预算变化导致的正文变化也会重新注入。
- 前瞻适配：[上游同步历史读取弃用决策](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md) 已进入主线，但 RC.2 仍提供这些方法；本次提前解除依赖，不代表 RC.2 已删除接口。插件不负责迁移磁盘会话格式。
- 已核对：插件不依赖 0.1.5 移除的 `ctx.agent` 或可构造 `Inbox`；pre-step 从事件载荷取得 agent，工具从 `exec.agent` 取得调用方，待处理消息只使用 `agent.inbox` 当前公开的 `nextStep`、`prepend`、`replace` 与 `remove`。
- 已采用：command lifecycle 的 `recordInput`、command attachment envelope 的 fail-closed 输入检查、`subagent/end` 的 run/provider/final-output 元数据，以及 report-before-settlement 与 idle-parent 原生唤醒语义。
- 已接入：Host `dsh-trellis` settings namespace 与 `dsh.client` 浏览器卡片。保存值写入 DSH 的 `settings.yaml` 用户层，并实时重挂插件 runtime；settings provider 单独重载时退回 loader 配置，插件自身卸载时则不会错误重挂 runtime。没有 settings 服务的 profile 继续使用原有 loader 配置。当前可选 Settings 生命周期由 `settings.installSection()` 承担；插件仍在运行时兼容旧版 helper。
- 已对齐：`dsh.client.inject` 指向的三个 DSH client 包与 React 都只作为浏览器构建输入保留在 `devDependencies`，发布安装不会重复解析 Web 壳已经提供的模块。
- 保持可选：`trellis_wait` 仍是“父会话还在当前轮里、需要明确同步点”时的工具；已经 yield 的父会话直接由 DSH 原生 settlement notice 唤醒。
- 保持直接归属：`trellis_wait` 继续使用 `listChildren(parent.id)` 验证 direct continuable child；这与 0.1.5 修正后的可继续子代理归属一致，不会把子代理误当作根会话参与调度。

## 配置

支持 Settings provider 的 DSH Web profile，在 `0.1.6-alpha.2` 打开“插件 → trellis”，旧版 RC 打开“设置 → 插件 → 插件配置 → Trellis 工作流”。保存内容进入该 DSH_HOME 的 `settings.yaml`，优先级高于 profile 组合层并立即生效。

Headless、rc.6 或需要声明部署默认值时，仍可在 profile 的 `cordis.patch.yml` 里覆盖（整行替换）；Web 卡片的“恢复配置文件值”会清除用户层字段并重新继承这里的值：

```yaml
- id: dsh-trellis
  config:
    maxBytes: 4096          # 面包屑注入的字节预算（0 = 关闭注入）
    skipKeyword: no-trellis # 提示词中的独立单词可跳过当轮注入（空 = 禁用）
    pythonCmd: ""           # 空 = 自动选择：Windows 先 py -3 再 python；其他系统先 python3 再 python
    commandsEnabled: true
```

### 0.1.6：Trellis 会话隔离与任务错误兼容

- 跟随 [Trellis #608](https://github.com/mindfold-ai/Trellis/pull/608)：只读取当前 DSH 会话的精确指针。缺少身份或匹配指针时返回 `no_task`，不再借用唯一的其他会话；也不从派发提示词反向建立会话绑定。子代理继续通过明确的 `Active task:` 派发上下文读取任务。
- 对齐 [官方 `task_error` 工作流](https://github.com/mindfold-ai/marketplace/commit/62a77c9b57fb8bb081c110394bce08b6ebc6e09a)：已绑定任务的 `task.json` 缺失、不可读、JSON 损坏或状态为空时，保留任务路径，提示先修复记录，不把它当成“没有任务”。不修改或删除任何任务与指针。
- 旧项目没有 `[workflow-state:task_error]` 块时，插件提供保守的修复提示；恢复有效记录后，下一轮自动恢复正常状态。因此无需先更新 Trellis CLI 才能使用本插件的修复。
- 插件修复不替代 Trellis Python 脚本升级：旧版 `task.py current/finish` 的回退策略、归档恢复和上下文清单检查仍由项目中的 `.trellis/scripts` 实现。

## 工作原理

- **状态解析**（`lib/workflow.js`）：向上找项目根 → 读 `.trellis/workflow.md` 解析状态块 → 只读当前会话指针 `.trellis/.runtime/sessions/dsh_<id>.json`，不枚举其他会话。指针缺失时返回 `no_task`；指向的任务记录不可读时返回 `task_error` 并保留路径。修复记录或重新绑定任务后会在下一轮重新解析。
- **注入去重**（`lib/breadcrumb-projection.js`）：投影仅保存面包屑的事件序号和 source/content 指纹，与 DSH 已维护的 `session.surface.nodes` 一起确定最后可见面包屑。恢复、分叉和重载均从 projection 重建；不缓存“本进程最后注入”的临时判断，也不扫描完整事件历史。
- **会话身份**：DSH 原生提供 `DSH_SESSION_ID = agent.session.header.id`，并先丢弃环境中已有的 `DSH_*` 再重建受管命名空间。Trellis beta 因此会在同时看到 `DSH_SHELL=1` 与 `DSH_SESSION_ID` 时优先解析当前 DSH 身份，即使没有插件也不会被外层 host 继承的 `TRELLIS_CONTEXT_ID` 串任务。插件通过 `shellEnv` 为每次执行额外生成 `DSH_TRELLIS_CONTEXT_ID = dsh_<session-id>`，用于转发可能不同于 shell 自身 session 的子代理身份；主会话与子代理仍各自保留 DSH 身份，子代理通过派发 prompt 首行的 `Active task:` 和角色 prelude 取得父任务上下文。
- **Headless 会话**：默认每次 `dsh --profile headless` 调用都会创建新 DSH session。需要跨轮保留 active-task 指针时，应保持同一会话，或在支持的宿主上用 `--session-id` 明确继续已有会话；不能把多个未指定身份的独立调用当成同一 session。
- **取消与生命周期**：命令和 `trellis_wait` 都继承 DSH invocation 的 `AbortSignal`；取消后命令不会继续尝试另一个 Python 启动器，等待工具也会立即注销临时事件监听器。`trellis_wait` 只在收到配对的结算事件时声明 `settlementNoticeQueued=true`；仅从 catalog 看到 inactive 时保持 `unknown`，不猜任务通过。插件卸载或 Settings 重挂时，还会取消自己的活跃等待和待消费面包屑，不删除用户消息或任务记录。
- **子代理并发**：workflow 只有在发现 `trellis_wait` 时才使用 DSH 原生 continuable 后台 `subagent`。主会话并行做独立工作；需要汇合时调用一次 `trellis_wait <subagent_id>` 等待原生结算事件。没有该工具时，首次派发直接设置 `run_in_background: false`，绝不留下无法事件汇合的后台子代理。

## 开发

```powershell
pnpm install
pnpm run build:client
pnpm test    # node --test test/*.test.js
pnpm run test:compat 0.1.5-rc.2  # 临时副本中安装旧宿主并运行同一套测试
# 不传版本参数时，隔离回归 RC.2 和 alpha.2 两个宿主
```

GitHub Actions 配置在 Windows / Linux 的 Node 24 环境执行锁定的 alpha.2 安装、客户端构建、测试、隔离 RC.2 回归和打包检查；其中包含真实 Session/projection 服务的增量驱动、恢复、分叉、压缩和 checkpoint 回归，以及真实临时项目中的精确身份绑定、跨会话隔离、任务记录损坏/修复、解绑与 Settings 重载回归。另有编译客户端的 React 渲染、slot owner 迟到/重载和资源清理测试。

`test:compat` 不改当前 checkout 的依赖，临时副本保留在系统临时目录并打印路径供检查。发布前还应使用隔离 `DSH_HOME` 启动真实 Web profile，验证配置保存/读回、整包及组件开关、重新挂载和卸载；不复用个人凭据或会话。0.1.7 的 Windows 本地验收已覆盖这些浏览器路径。

Host half 是直接由 `main` 加载的 ESM JavaScript；Web half 通过 tsdown 生成 DSH lazy-CJS factory 到 `lib/client.js`。`pnpm pack` 会在 prepack 阶段自动重建客户端 bundle。

## License

MIT
