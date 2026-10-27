# dsh-trellis

DeepSeek Harness (dsh) host 插件：把 [Trellis](https://github.com/mindfold-ai/Trellis) 工作流带进 dsh，并尽量沿用 DSH 原生能力补齐 Codex / Claude Code 级体验：

1. **每轮 workflow-state 面包屑注入** — 在每个 `agent/pre-step`，解析项目 `.trellis/workflow.md` 的 `[workflow-state:*]` 块 + 活跃任务状态（no_task / task_error / planning / in_progress），把对应面包屑注入会话（与 `dsh-agent-instructions` 的注入管道相同）。未变化不重复注入；被压缩后自动重注入；提示词里出现独立单词 `no-trellis` 可跳过当轮。
2. **隔离的原生会话上下文身份** — 从当前 agent 的 DSH 原生 session header 生成受管的 `DSH_TRELLIS_CONTEXT_ID`，让 `task.py start/create/current` 解析到会话级 active-task 指针，并在子代理身份不同于 shell 自身 session 时优先使用被转发的身份；插件命令启动的子进程也显式使用同一个 DSH 身份。
3. **原生子代理同步** — 安装插件后，Trellis 角色可用 DSH continuable 后台子代理；主会话先继续独立工作，耗尽后可调用事件驱动的 `trellis_wait`。它监听 DSH 的 `subagent/end`，利用 lifecycle 自带的 run/provider/output-block 元数据返回 `completed / failed / aborted / unknown` 的 fail-closed 结论。`error`、`max-tokens`、`refusal` 和未来未知失败原因都不会被误报成通过。rc.8 在父会话 idle 时也会用原生 settlement notice 唤醒，因此已经结束当前轮时无需额外调用 wait。
4. **`/trellis` 命令** — `/trellis-status`（活跃任务 + git 状态）、`/trellis-finish`（只读检查 + 安全收尾清单，不提前清 active-task 指针）。命令输出不进模型历史；真正的会话收尾走技能面 `/trellis-finish-work`，由技能先归档再写 journal。rc.8 下两条零输入命令使用 `recordInput: false`，并显式拒绝参数和图片附件，避免静默忽略输入。
5. **Web 配置菜单** — DSH `0.1.7-rc.1` 的“插件 → dsh-trellis”详情页直接显示全部六个配置项；保留 `0.1.6-alpha.2` 详情页与旧版 RC 卡片。新版支持带修订号的原子保存、恢复 profile 继承值和冲突时保留草稿。配置里的 `enabled=false` 会停用工作流功能但保留表单；插件管理器的整包或组件开关则会连同表单一起卸载。

非 Trellis 项目不注入面包屑；命令只有被用户显式调用时才会检查并返回“未初始化 Trellis”。

这是 Trellis DSH 适配的**可选伴侣插件**，不是使用 `trellis init --dsh` 的前置条件。存在 `trellis_wait` 时可使用 continuable 后台派发和事件汇合。未安装插件时，只有工具 schema 明确支持 `run_in_background` 的旧宿主才设置 `run_in_background: false`；DSH `0.2.1-alpha.2` 已移除该参数，统一立即返回 child ID，应让父会话结束当前轮、由原生完成通知唤醒，或直接在主会话完成工作。收到 child ID 不代表依赖步骤通过；没有可用的事件汇合或可靠原生通知路径时不要派发。所有路径都禁止 sleep 或轮询，Trellis CLI 不会自动安装任何 DSH profile 插件。

## 安装

```powershell
# 装进实际使用的 profile；CLI 修改在下次启动时加载
dsh plugin --profile web add dsh-trellis
dsh plugin --profile headless add dsh-trellis

# 如果你维护独立的 tui profile，也需要装进该 profile
dsh plugin --profile tui add dsh-trellis
```

`dsh plugin` 会把插件安装到指定 profile；每个实际使用的 profile 都需要单独安装。

DSH `0.2.0-rc.2` 的 macOS / Windows 桌面端可在菜单栏“Manage dsh command”中安装或管理内置 `dsh` 命令，无需单独安装 Node 或 pnpm。先用 `dsh --version` 确认 PATH 中实际调用的版本；旧的全局 CLI 可能与桌面端不同。桌面端默认使用 `desktop` profile，其他 profile 仍需分别安装。

新版本刚发布时，插件页预览的版本可能与安装器最终选择的版本不同。需要本版插件 `0.1.15` 时，在插件页输入 `dsh-trellis@0.1.15`，或显式安装到实际使用的 profile：

```powershell
dsh plugin --profile desktop add dsh-trellis@0.1.15
# Web / headless 用户将 desktop 替换为对应 profile 名称。
```

DSH `0.2.0-rc.2` 发布说明曾引入 pnpm 11；其默认新版本等待期为 24 小时，裸包名可能暂时解析到较旧版本。不要仅凭“RC.2”推断其他版本的包管理器：以实际宿主和解析结果为准。显式版本安装仍须通过版本准入，不需要关闭全局等待期或绕过兼容性检查。参见 [DSH 0.2.0-rc.2 更新说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2) 与 [pnpm 11 发布说明](https://pnpm.io/blog/releases/11.0)。

日常升级命令：

```powershell
dsh plugin --profile web update dsh-trellis
dsh plugin --profile headless update dsh-trellis
```

对 `tui` profile 使用同样的 update。CLI 在进程外修改 profile 后，应重启对应 DSH 进程。`0.2.1-alpha.3` 起，运行中的插件管理器可对满足 HMR 条件的包执行代码热替换；无法热替换时会提示需要重启，以实际结果为准。整包/组件开关只证明卸载与重挂，不等同于包代码已更新。更换 DSH 宿主 release 后，还需按页面提示刷新浏览器，避免旧 Web 壳连接新宿主。参见[插件管理器生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/plugin-manager/README.md)。

DSH `0.1.6-alpha.2` 也可从 Web 侧栏“插件 → 添加插件”安装包。Web 安装后需要手动启用；CLI `add` 默认启用。安装命令仍是 `dsh plugin --profile <name> add <package>`，无需增加额外安装脚本。

如果要从源码开发或验证尚未发布的版本，可以改用本地 `file:` 安装：

```powershell
git clone https://github.com/SajoLuo/dsh-trellis.git
cd dsh-trellis
pnpm install --frozen-lockfile
pnpm run build:client
dsh plugin --profile headless add file:C:/path/to/dsh-trellis
```

`file:` 插件会作为 profile 内的 pnpm 快照安装；拉取源码更新后，尤其是版本新增文件时，需要先 remove 再 add 刷新该 profile。外部 CLI 刷新快照后重启对应进程，不要假定源码目录变化会自动热更新。

配套要求：项目的 Trellis 平台需包含 dsh（`trellis init --dsh`，见 Trellis-DeepSeekHarness 适配分支），且 `.trellis/scripts` 需包含读取原生 `DSH_SESSION_ID` 的适配（已含在同一分支）。现有 `engines.dsh` 和 Host peer 范围已接纳 `0.2.1-rc.4`，无需为每个预发布标签追加范围。`0.2.1-alpha.4` 起宿主优先检查显式 `engines.dsh`，仅未声明时才回退 DSH peer；其 `includePrerelease: true` 规则与 npm 默认匹配不同。通过准入不等于实际兼容，不应使用 `allow-version` 绕过缺失的 API。开发基线固定为 `0.2.0-rc.1`，隔离回归目标见开发章节的十四个明确宿主，不代表测试了范围内所有版本。Web 配置只在具备对应 client surface 的 profile 中加载。参见[官方版本声明迁移说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md)。

运行时需要 profile 提供 `sessionProjections` 服务；该依赖由插件的 `inject` 声明。自定义或精简 profile 若未组装此服务，需先加载 `@deepseek-ai/dsh-session-projection`，否则插件会等待依赖，不会退回直接扫描历史。

### 0.1.15：DSH 0.2.1-rc.4 兼容回归

- 为 npm 发布的 RC.4 增加精确工具链映射、独立预期和 Windows/Linux CI 目标；保留生产代码、依赖基线及现有版本范围。未知 RC.5 仍拒绝执行。
- 十四个宿主的本地跨平台结果及隔离 Web 验证范围见 [RC.4 验证记录](docs/validation-dsh-0.2.1-rc.4.md)；不将本地通过写作远端 CI 或新版已发布。

### 0.1.14：DSH 0.2.1-rc.3 兼容回归

- 为 RC.3 增加精确工具链映射、独立预期和 Windows/Linux CI 目标；版本准入测试自动覆盖新增目标。保留开发基线、peer / engine 范围及生产代码，未知宿主仍拒绝执行。
- 补充复用空白 Session 后首次提交的插件边界回归：保持原生身份及精确任务指针、保留提交文本、只注入一次面包屑。该自动测试不代替真实 New Session UI 验收。
- RC.3 的新会话语义与本轮实际验证范围见 [RC.3 验证记录](docs/validation-dsh-0.2.1-rc.3.md)；本地通过不等于远端 CI 或已发布版本通过。

### 0.1.13：DSH 0.2.1-rc.2 兼容回归

- 补齐 alpha.3 / alpha.4 / alpha.5 / RC.1 / RC.2 的隔离回归与 Windows/Linux CI 目标，按各版实际发布的 Cordis、Schemastery、Include 和 Loader 精确配对；未知宿主直接拒绝，不猜测依赖组合。
- 新增版本准入声明和依赖矩阵回归。保留 `0.2.0-rc.1` 开发基线、现有 peer / engine 范围及插件运行时代码，不新增清单格式、安装脚本或强制升级路径。
- 修正安装、热替换、AgentPreset、SDK 会话和技能缓存边界说明。本版仅更新插件仓库；不改 Trellis 模板、现有项目或另行跟进的上游 PR。实际验证范围见 [RC.2 验证记录](docs/validation-dsh-0.2.1-rc.2.md)，远端 CI 与发布状态以对应标签和 npm 为准。

### 0.1.11：DSH 0.2.0-rc.2 兼容验证

- 增加 `0.2.0-rc.2` 隔离回归与 Windows/Linux CI 目标；本地 RC.1 / RC.2 均为 130 项通过、无失败或跳过，RC.2 独立 Web profile 验收通过。
- 现有 `^0.2.0-rc.1` 已覆盖 RC.2，无需扩展 peer 或新增运行时补丁。开发基线仍为锁定的 RC.1。
- 补充桌面内置 CLI、profile 区别及显式版本安装说明。本版不包含 Trellis CLI 的归档与嵌套身份补丁，它们在独立适配分支中维护。范围与限制见[RC.2 验证记录](docs/validation-dsh-0.2.0-rc.2.md)；远端 CI 和发布状态以对应标签为准。

### 0.1.12：DSH 0.2.1-alpha.2 适配

- 面包屑和两条命令按每次调用读取 agent 作用域的 `workingDirectory.ensure()`，支持切换项目/worktree及目录恢复；仅旧宿主没有服务时才使用原始 `header.cwd`。目录验证失败不偷偷回退旧项目，原生 session ID 不随目录改变。
- `trellis_wait` 只证明匹配的执行结算；完成通知投递另由宿主负责。兼容字段 `settlementNoticeQueued=false` 表示未证明入队，**不表示确认未投递**。通过依赖门禁前仍需检查子代理报告或 transcript；inactive 快照保持 unknown。
- 为 DSH、Cordis 和 Schemastery 显式声明已验证 alpha peer 范围，保留 RC 开发基线及旧宿主范围；移除无直接用途的 `dsh-invariants` 开发依赖。新增 alpha.2 精确工具链隔离回归与 CI 目标，不升级本机 DSH。
- alpha 用户可显式安装 `dsh-trellis@0.1.12`。Trellis 模板在独立适配工作区同步，不包含在 npm 插件包中，也不是官方 Trellis npm 升级；现有项目的 workflow 不会被插件自动改写。测试结果及边界见 [alpha.2 验证记录](docs/validation-dsh-0.2.1-alpha.2.md)，远端 CI 与发布状态以对应标签为准。

### 0.1.10：DSH 0.2.0-rc.1 适配

- 七项 DSH peer 和 `engines.dsh` 新增 `^0.2.0-rc.1`；旧的 `^0.1.7-rc.1` 不接纳 0.2。开发依赖及锁文件升级到 0.2，Windows/Linux CI 配置继续覆盖四条旧宿主线。使用 0.2 宿主时请安装插件 0.1.10 或更新版本，0.1.9 不包含这项适配。
- 跟随宿主的失败工具历史恢复，新增真实 AgentLoop 回归：工具尚未启动时记录 `TOOL_NOT_STARTED`，已执行但结果未提交时记录 `TOOL_OUTCOME_UNKNOWN`；保留原始错误和已提交结果，继续会话不自动重试等待，也不重复注入面包屑。
- 已用隔离 DSH Web 验证正常版本准入、配置保存与读回、恢复继承值、整包/组件开关、冲突保留草稿以及页面重载。无需改变运行时代码、插件清单形态、安装命令或 Trellis 模板。完整范围见[验证记录](https://github.com/SajoLuo/dsh-trellis/blob/v0.1.10/docs/validation-dsh-0.2.0-rc.1.md)。

### 0.1.9：DSH 0.1.7-rc.2 兼容验证

- 新增 RC.2 隔离回归及 Windows/Linux CI 覆盖，修复兼容测试把非 RC.1 宿主错误归为旧版 Cordis 依赖的逻辑。
- 使用真实 AgentLoop、Loader 和 Session 验证动态工具增删、Settings 重挂、面包屑去重、恢复/分叉及压缩后的重新注入；补充等待目录失败与卸载清理回归。
- 本版不改变插件运行时代码、peer 范围、安装命令或 Trellis 生成模板；保留 RC.1 开发基线及两条旧宿主回归。验证范围与限制见[详细记录](https://github.com/SajoLuo/dsh-trellis/blob/v0.1.9/docs/validation-dsh-0.1.7-rc.2.md)。

### 0.1.8：DSH 0.1.7-rc.1 适配

- 按[新版 Settings 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/settings/settings/README.md)声明六个 `.volatile()` 配置字段，读取 live Config，并由 Loader 的 `loader/volatile-update` 通知更新工作流注册。Settings 仅持有当前插件 fiber 的自定义页面策略；迟到、替换或卸载该服务不会重置配置。旧宿主保留原 helper/provider 路径。
- Web 改用 `configForms.get(entryId)`，保留旧 `settingsScope` 兼容分支。新版一次提交全部字段与编辑开始时的 revision，冲突或断连保留草稿；冲突后先放弃更改、读入新值，再重新编辑。旧宿主继续使用逐字段写入。
- 适配父会话 `subagentCatalog`：目录只证明直接归属和 continuable 模式，当前驻留状态另读 Session store，并校验创建时间和父会话，防止复用 id 串会话。查询期间捕获的 `subagent/end` 优先于 inactive 快照；冷子代理仍返回 unknown，不猜成功。旧目录格式继续支持。
- 保留单文件 `dsh.bundle.patch`、`manifestVersion: 1` 和 profile 安装命令；无需增加安装脚本。不改变 Trellis 生成模板及已有任务绑定。
- 本轮按本地工作区验证；不宣称支持新版 DSH 的 SSH 远程工作区文件访问。

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

支持 Settings 的 DSH Web profile，在新版打开“插件 → dsh-trellis”，旧版 RC 打开“设置 → 插件 → 插件配置 → Trellis 工作流”。`0.1.7-rc.1` 起（含 `0.2.0-rc.1`）保存到当前 profile 的 `cordis.patch.yml`，全局 patch 和命令行覆盖仍优先，无法生效的表单写入会被拒绝；旧宿主仍保存到 `settings.yaml`。

升级前备份 `settings.yaml` 和各 profile 配置。新版宿主会把旧文件改名为 `settings.yaml.imported`，并向**首次启动的 profile** 按 entry id 一次性导入；拒绝的 section 只保留在备份文件，不会自动重试。插件不会自行重命名、删除或跨 profile 复制配置；应先安装兼容插件，再启动迁移，并核对其他 profile 的需要。

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
- **RC.3 的新会话按钮**：Web/Desktop 的 New Session 可能重新打开未启动、未归档的空白 Session 及其未发送草稿，并非总会创建新 ID；插件继续按实际原生 ID 查找任务指针，不重置或复制绑定。复用且仍驻留的 Agent 也不保证采用刚修改的预设定义；需要重建组合时，按宿主说明重启后再打开空白会话。指定预设的客户端集成应传入 `agentPreset`，避免接管其他预设的草稿。本插件不调用这些导航 API。参见[官方迁移说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/docs/upgrade-guide/v0.2.1-rc.2/new-session-blank-reuse/guide.md)。
- **工作目录**：优先读取当前 agent 的可选 `workingDirectory` 服务，跟随宿主提交的目录切换/恢复；仅服务不存在时回退 session header。服务故障不会触发旧目录操作。切换目录不会替换会话身份，不会复制任务指针；新目录按同一身份查找自己的指针。
- **取消与生命周期**：命令和 `trellis_wait` 都继承 DSH invocation 的 `AbortSignal`；取消后命令不会继续尝试另一个 Python 启动器，等待工具也会立即注销临时事件监听器。结算事件不能单独证明父会话通知入队，因此 `settlementNoticeQueued` 保守返回 false（未验证）；仅从 catalog 看到 inactive 时保持 `unknown`，不猜任务通过。插件卸载或 Settings 重挂时，还会取消自己的活跃等待和待消费面包屑，不删除用户消息或任务记录。
- **子代理并发**：主会话先做独立工作，需要汇合时用 `trellis_wait` 等待直接 continuable 子代理的结算。以实际工具目录、schema 和 PTC/SDK 绑定为准，不假定它一定是顶层直接可调用的模型工具。无插件时根据实际工具 schema 选择旧宿主前台参数，或 alpha.2 的父会话 yield/原生通知路径；不存在可靠事件路径时主会话直接做工作。SDK 的 `session/wait` 不是可以假定存在的模型工具。所有路径都必须检查结果后才能推进依赖步骤。
- **AgentPreset 与 SDK**：新宿主通过 `agentPreset` 组合子代理策略，不再发送移除的 `persona` / `toolFilter`；模型侧仅在宿主公开可用列表时使用 `agent_preset`，fork 保持宿主原生的预设继承，不自行拼接身份。SDK `session/resume` 恢复原生 session ID、历史和有效目录，本身不派发模型回合；初始化的模型路由不是新的 Trellis 身份。插件不保存或搬运模型凭据。参见[预设迁移](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.md)与[SDK 契约](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/sdk/server/README.md)。
- **技能目录刷新**：alpha.5 的技能缓存修正响应插件管理器变化，不等于任意磁盘 `SKILL.md` 修改或外部 CLI 更新都会推送刷新。执行 `trellis init/update` 后，按宿主的预设切换或重连路径刷新技能目录；本插件不增加全局缓存失效补丁。可选 Discover 使用独立插件索引，并非 Trellis marketplace gitlink；普通包安装无需创建索引。参见[技能缓存](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/ui-skill/README.md)和[插件索引](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/user/guide/plugin-market.md)。

## 开发

```powershell
pnpm install
pnpm run build:client
pnpm test    # node --test test/*.test.js
pnpm run test:compat 0.1.5-rc.2  # 临时副本中安装旧宿主并运行同一套测试
pnpm run test:compat 0.1.7-rc.2  # RC.2 动态工具与面包屑集成回归
pnpm run test:compat 0.2.0-rc.2  # 保留 0.2.0 RC.2 回归
pnpm run test:compat 0.2.1-alpha.2 # 新工作目录与统一 activation 契约
pnpm run test:compat 0.2.1-rc.2 # 保留 RC.2 隔离回归
pnpm run test:compat 0.2.1-rc.3 # RC.3 隔离回归
pnpm run test:compat 0.2.1-rc.4 # RC.4 隔离回归
pnpm run test:compat # 默认跑全部十四个显式目标
```

GitHub Actions 配置在 Windows / Linux 的 Node 24 环境执行锁定的 `0.2.0-rc.1` 安装、客户端构建、测试、其余十三个宿主的隔离回归及打包检查。测试覆盖真实 Session/projection 的恢复、分叉、压缩和 checkpoint，临时项目的精确绑定与任务错误恢复，以及新版真实 Loader 的 volatile 更新、子代理目录/查询/驻留状态；新版专属测试在旧宿主明确跳过。另有编译客户端 React 渲染、slot 生命周期、原子保存与拒绝写入测试。配置了 CI 目标不等于远端 CI 已运行，结果以对应提交为准。

RC.2 集成用例运行真实 AgentLoop、Loader、ToolRuntime 和 Session，以本地脚本化模型响应验证三种 `toolUpdate` 能力：不支持、`addition-only`、`in-history`。覆盖插件启停的工具增删消息、Settings 重挂不重复注入、混合历史的恢复/分叉投影，以及 surface 替换后重建工具基线并重新注入面包屑。等待工具另覆盖目录损坏/不存在及卸载期间查询失败的错误保留与监听器清理。该验证不调用外部模型，也不替代 Web 浏览器或真实子代理派发验收；详情见 [2026-09-28 验证记录](https://github.com/SajoLuo/dsh-trellis/blob/main/docs/validation-dsh-0.1.7-rc.2.md)。

0.2 集成用例另以真实 AgentLoop / ToolRuntime / Session 和实际 `trellis_wait` 验证失败工具历史的补齐顺序、错误分类、监听器清理及继续会话的消息配对。只注入 scheduler 故障和本地模型响应，不增加运行时补丁或自动重试；旧宿主按 `ToolCallRecovery` 能力明确跳过。还覆盖“目录查询期间收到成功结算、随后查询失败”的竞争，查询错误不能被伪装成成功。

`test:compat` 不改当前 checkout 的依赖，临时副本保留在系统临时目录并打印路径供检查。十四个目标采用以下明确配对，不按“非最新版本”猜测；未知宿主必须先核对官方包并补齐测试。

| DSH 目标 | Cordis | Schemastery | Include | Loader |
|---|---|---|---|---|
| 0.1.5-rc.2、0.1.6-alpha.2 | 4.0.2 | 3.18.2 | 1.0.7 | 1.0.3 |
| 0.1.7-rc.1 / rc.2、0.2.0-rc.1 / rc.2 | 4.0.4 | 3.18.4 | 1.0.9 | 1.0.5 |
| 0.2.1-alpha.2 | 4.0.5-alpha.1 | 3.18.5-alpha.1 | 1.0.10-alpha.1 | 1.0.6-alpha.1 |
| 0.2.1-alpha.3 / alpha.4 / alpha.5 | 4.0.5-alpha.2 | 3.18.5-alpha.2 | 1.0.10-alpha.2 | 1.0.6-alpha.2 |
| 0.2.1-rc.1 / rc.2 / rc.3 / rc.4 | 4.0.5 | 3.18.5 | 1.0.10 | 1.0.6 |

发布前还应使用隔离 `DSH_HOME` 启动真实 Web profile，验证配置保存/读回、整包及组件开关、重新挂载和卸载；不复用个人凭据或会话。代码 HMR、外部 CLI 快照刷新和浏览器跨宿主 release 刷新是不同验收项，不能用一次开关测试代替。当前结果与未覆盖项见 [2026-10-27 RC.4 验证记录](docs/validation-dsh-0.2.1-rc.4.md)，[RC.3 记录](docs/validation-dsh-0.2.1-rc.3.md)与 [RC.2 记录](docs/validation-dsh-0.2.1-rc.2.md)保留为历史证据。

Host half 是直接由 `main` 加载的 ESM JavaScript；Web half 通过 tsdown 生成 DSH lazy-CJS factory 到 `lib/client.js`。`pnpm pack` 会在 prepack 阶段自动重建客户端 bundle。

## 自动发布

`.github/workflows/publish.yml` 使用 npm [Trusted Publishing / OIDC](https://docs.npmjs.com/trusted-publishers/)，不保存长期 `NPM_TOKEN`。需先在 npm 的 `dsh-trellis` 包设置中绑定 GitHub 用户 `SajoLuo`、仓库 `dsh-trellis`、工作流文件名 `publish.yml`，并允许 `npm publish`；不需要单独的 dist-tag 管理权限。首次配置需要维护者交互确认。

发布流程仅允许在本仓库的 `main` 手动触发，指定已有的稳定版标签。标签必须位于 main 历史中，且包名、标签版本、main 的包版本一致。工作流解析出不可变提交 SHA，让现有 Windows/Linux 完整测试矩阵和发布构建都使用同一个 SHA；测试失败或跳过整个测试任务时不发布。只有发布任务拥有 OIDC 权限，普通 push / PR 不会触发发布。

启用后，由发布操作者执行，例如：

```powershell
gh workflow run publish.yml --repo SajoLuo/dsh-trellis --ref main -f tag=v0.1.16
```

GitHub-hosted runner 通过 OIDC 获取临时发布凭据并生成 provenance。这里的授权属于指定发布流程；本机直接运行 `npm publish` 仍按 npm 的交互认证规则执行。首次 OIDC 真发布前，不把配置或本地检查视为认证已经验证成功。

## License

MIT
