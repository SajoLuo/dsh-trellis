# DSH 0.2.2-alpha.2 兼容验证（2026-10-28）

## 范围与依据

基于 `a28a724a8ecd71159ca0dcf5db8c112b9355e1b1` 的工作区适配；包版本暂保留 `0.1.16`，本轮没有提交、推送、打标签或发布。已发布的 `0.1.16` 不含本文所述运行时修正。Trellis 模板、上游 PR、个人 DSH CLI 和桌面端均未修改。

依据官方 npm 发布包核对，而非把 GitHub master 或旧 RC 的类型当作 Alpha.2 契约：

- [DSH 元数据](https://registry.npmjs.org/@deepseek-ai%2Fdsh/0.2.2-alpha.2)：Cordis `4.0.6-alpha.1`、Schemastery `3.18.6-alpha.1`、Include `1.0.11-alpha.1`、Loader `1.0.7-alpha.1`。
- [Session projection](https://registry.npmjs.org/@deepseek-ai%2Fdsh-session-projection/0.2.2-alpha.2)：`register()` 的新返回值是异步 `ProjectionHandle`，提供 `stateOf(session)` 和异步 `dispose()`。发布运行时仍有 callable thenable 兼容层；旧的按 key 读取会触发弃用提示。
- [Tools](https://registry.npmjs.org/@deepseek-ai%2Fdsh-tools/0.2.2-alpha.2)、[Native executor](https://registry.npmjs.org/@deepseek-ai%2Fdsh-tool-executor-native/0.2.2-alpha.2)、[PTC executor](https://registry.npmjs.org/@deepseek-ai%2Fdsh-tool-executor-ptc/0.2.2-alpha.2)：注册与执行器分离，执行器拥有整批调度。PTC runtime 包仍存在，不能因拆分而移除。

## 修改与复现

- 面包屑等待投影注册完成后再读取所取得的句柄；旧同步 registry 保留按 key / snapshot 的兼容分支。注册失败不会误读另一注册者的状态，并回收已注册的命令、工具、环境贡献和 pre-step 监听器。
- 支持注册尚未完成时卸载、迟到句柄清理，以及已取得句柄的异步释放。`apply()` 只返回就绪的 `Promise<void>`，不把 handle 交给 Cordis 当作 effect disposer。
- 全矩阵首次运行发现旧 Cordis 的同步 effect disposer 也带 `then`，其解析值不是新 handle。改为检查句柄能力，并补独立回归；最终矩阵全部重跑。没有按版本前缀猜接口。
- 新增工具执行器夹具；旧失败历史用例在新 executor 的 pipeline 边界注入故障，保留未启动/结果未知分类、原错误、监听器清理和继续会话不重放工具的全部断言。
- 为 npm 默认 semver 补齐 DSH、Cordis、Schemastery 的新预发布基数，并独立验证所有已认证目标均满足 engine/peer。没有使用 `includePrerelease` 覆盖测试结果或 `allow-version`。
- 精确宿主映射与独立预期增加 Alpha.2；Windows/Linux CI 都增加该目标。独立断言确认：开发基线加十四个隔离参数恰好覆盖十五个宿主，无重复或遗漏。开发依赖和锁文件保持原基线。

先新增目标预期时，缺失 Alpha.2 映射的两项测试按预期失败。隔离新宿主随后复现缺失 executor、旧 scheduler 入口失效的问题；修正后才运行下方最终完整矩阵。

## Windows / Linux 最终矩阵

两边使用 Node `24.12.0`、pnpm `10.33.0`。正常冻结安装、客户端构建、完整基线、`pnpm run test:compat` 全十五组和打包 dry-run 均成功。每组运行同一套完整测试，逐项结果在两边一致：

| DSH | 总数 | 通过 | 失败 | 能力跳过 |
| --- | ---: | ---: | ---: | ---: |
| 0.1.5-rc.2 | 163 | 150 | 0 | 13 |
| 0.1.6-alpha.2 | 163 | 150 | 0 | 13 |
| 0.1.7-rc.1 | 163 | 152 | 0 | 11 |
| 0.1.7-rc.2 | 163 | 155 | 0 | 8 |
| 0.2.0-rc.1 | 163 | 157 | 0 | 6 |
| 0.2.0-rc.2 | 163 | 157 | 0 | 6 |
| 0.2.1-alpha.2 | 163 | 161 | 0 | 2 |
| 0.2.1-alpha.3 | 163 | 161 | 0 | 2 |
| 0.2.1-alpha.4 | 163 | 161 | 0 | 2 |
| 0.2.1-alpha.5 | 163 | 161 | 0 | 2 |
| 0.2.1-rc.1 | 163 | 161 | 0 | 2 |
| 0.2.1-rc.2 | 163 | 161 | 0 | 2 |
| 0.2.1-rc.3 | 163 | 161 | 0 | 2 |
| 0.2.1-rc.4 | 163 | 161 | 0 | 2 |
| 0.2.2-alpha.2 | 163 | 163 | 0 | 0 |

旧能力跳过不计为通过。新增的两项 split executor 用例只在存在 `tools.setExecutor` 时运行，其余原有能力判断保持。未删除或过滤必需用例、放宽断言、增加测试超时或跳过钩子。

新增 PTC 用例使用真实 `PtcExecutor`、工具 registry、pipeline 和 `trellis_wait`，由确定性的测试 runtime 调用 SDK binding。验证 `run_code` 是唯一直接可调用的工具、直接调用 wait 返回 `UNKNOWN_TOOL`、canonical JSON 保留 `unknown` 和未验证通知标志。这不代表测试了 Node PTC 子进程、沙箱隔离或完整 SDK JSON-RPC。

Linux 使用 WSLC、非 root `node` 用户、2 CPU、4 GiB 内存，无主机挂载或端口映射；Python `3.11.2`。未启动 Docker Desktop。本轮最终镜像 `sha256:e760720019ddc6addbbbed7c89e7ffe449a6e3f7c97e8ad83cf881b4af77199b`，容器 `2f59f87a4b86cff58c099140cd77de9b20478a0ee326d0908bb0d0cc4d3bf4bd` 最终 `exited / 0`。npm 安装期间的少量连接重置由安装器重试后成功；不计为测试通过。

最终镜像输入逐文件 SHA-256 与 checkout 核对无差异；随后仅整理 README 和本文。两边打包清单均为 17 个预期文件，没有 AGENTS.md、测试、夹具、日志或本机配置。工作区的原有未跟踪 AGENTS.md 保留。

## 隔离 Web 实际加载

在临时 npm 前缀正常安装完整 `@deepseek-ai/dsh@0.2.2-alpha.2`，CLI 读回该版本。使用全新 `DSH_HOME` 和 Web profile，正常 `dsh plugin --profile web add file:...` 成功，没有兼容豁免。安装快照的 13 个 `lib/` 文件与 checkout 的 SHA-256 全部一致。

真实浏览器确认：

- 六个配置控件各一份，插件显示一个组件运行中。版本标签 `0.1.16` 是尚未递增的本地包元数据，不代表 npm 上的同版本含有本次修改。
- 同次保存 `maxBytes=3072`、`skipKeyword=skip-alpha22`，配置生效；组件卸载后表单消失，重新挂载保留两项值。
- 保存功能 `enabled=false` 后表单仍可编辑；页面刷新并重新进入插件详情后，开关及两项值读回一致。
- 恢复三项继承值后，读回 `enabled=true`、`4096`、`no-trellis`；磁盘 patch 不再包含这三项测试配置覆盖。整包停用/启用也会卸载/重挂表单，最终只挂载一份，组件运行中。
- 浏览器未捕获 error/warn，服务日志没有插件加载或投影注册错误。开关操作会短暂禁用控件，最终状态以异步完成后的页面和磁盘 patch 为准。

本轮页面和 Web 进程已关闭，回环监听消失。没有登录、读取个人会话或配置模型密钥；未向外部模型发送请求。

## 证据和未覆盖项

原始日志、完整 `matrix-results.json`、输入哈希、容器回执、安装快照与 `alpha2-web-settings.png` 保留在本机 `%TEMP%/dsh-trellis-alpha22-a50488a8b1af4104a76a7b1d962ff8b7`。Web 日志包含本轮临时回环访问令牌，不复制到仓库或公开报告。

本地验证不等于远端 CI 已运行。尚未提交或发布；未升级个人桌面端、验证跨 release 浏览器刷新或跨代码版本 HMR，未测试付费模型、SSH 远程工作区或完整 SDK / Node PTC 沙箱。上述边界不以历史 RC 证据冒充本轮通过。

## 0.1.17 发布准备

上述记录保留首次验证时的版本与范围。发布准备将包版本和当前安装示例递增为 `0.1.17`，不改变已验证的生产代码、依赖基线或锁文件。发布工作流继续使用指定标签的不可变 SHA 重跑 Windows/Linux 完整矩阵，通过后才以 OIDC 发布；最终状态以 `v0.1.17` 和 npm 注册表为准。
