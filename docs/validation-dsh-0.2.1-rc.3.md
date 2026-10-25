# DSH 0.2.1-rc.3 兼容验证（2026-10-25）

## 范围

首次验证基于插件 `5108b7f983671497b442965cf5f6392173baf1e9` 的工作区改动，当时包版本为 `0.1.13`，尚未提交、推送或发布。以下保留该次本地验证，不冒充远端 CI 结论。本记录随 `0.1.14` 归档，最终 CI 与发布状态以对应提交、标签和 npm 为准。未升级个人 DSH，未修改 Trellis 模板或三份上游 PR。

官方 [RC.3 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3) 对应 tag `dsh-v0.2.1-rc.3`、SHA `1f81c047fc48fa190a683e469daa699857e9afe8`。

- 现有 `engines.dsh` 和七项 DSH peer 已接纳 RC.3，不增加冗余范围。开发基线仍为 `0.2.0-rc.1`；除发布时递增包版本外，依赖、锁文件、bundle 清单和 `lib/` / `src/` 均无改动。
- 兼容脚本新增一个精确宿主目标：Cordis `4.0.5`、Schemastery `3.18.5`、Include `1.0.10`、Loader `1.0.6`；未知宿主仍拒绝执行。独立测试校验这些配对，准入测试自动遍历全部十三个目标。
- 增加空会话复用后的插件边界回归，更新 Windows/Linux CI 目标及操作说明。不引入 master 尚未发布的 Session/projection、publication、tool admission 或 fork 迁移。

## Windows 自动验证

Node `24.12.0`、pnpm `10.33.0`。冻结离线安装、客户端构建均成功。基线 `pnpm test` 为 149 项：145 通过、0 失败、4 个旧宿主能力跳过。

先添加测试再更新映射，目标测试准确报出缺失 RC.3 配对；更新后执行 `pnpm run test:compat`，十三组独立临时安装均退出 0：

| DSH | 总数 | 通过 | 失败 | 能力跳过 |
|---|---:|---:|---:|---:|
| 0.1.5-rc.2 | 149 | 138 | 0 | 11 |
| 0.1.6-alpha.2 | 149 | 138 | 0 | 11 |
| 0.1.7-rc.1 | 149 | 140 | 0 | 9 |
| 0.1.7-rc.2 | 149 | 143 | 0 | 6 |
| 0.2.0-rc.1 | 149 | 145 | 0 | 4 |
| 0.2.0-rc.2 | 149 | 145 | 0 | 4 |
| 0.2.1-alpha.2 | 149 | 149 | 0 | 0 |
| 0.2.1-alpha.3 | 149 | 149 | 0 | 0 |
| 0.2.1-alpha.4 | 149 | 149 | 0 | 0 |
| 0.2.1-alpha.5 | 149 | 149 | 0 | 0 |
| 0.2.1-rc.1 | 149 | 149 | 0 | 0 |
| 0.2.1-rc.2 | 149 | 149 | 0 | 0 |
| 0.2.1-rc.3 | 149 | 149 | 0 | 0 |

跳过不算通过；保留旧宿主能力判断、所有断言和超时。注册表的一次连接重置由包管理器正常重试成功。

新增回归沿用真实 Session/projection 与既有 pre-step 夹具：切换到其他原生身份不读取原绑定；返回原空会话后，首次提交保留用户消息、使用原指针并只注入一次；提交入历史后不重复注入，任务指针原字节不变。它验证插件边界，不伪造或重新实现宿主导航。真实 AgentLoop、Loader、ToolRuntime、Settings 和 SubagentRuntime 的既有用例仍运行。

完整 checkout 的 `npm pack --dry-run --ignore-scripts` 成功，17 个预期发布文件；不包含 AGENTS.md、测试、兼容夹具或日志。未生成或上传新版发布包。

## Linux 验证

通过 WSLC 使用独立 Linux 容器，非 root `node` 用户、2 CPU、4 GiB 内存，不挂载主机目录、凭据或个人配置，不启动 Docker Desktop。

复用上一轮的验证基础镜像 `sha256:6846928444d90f2fa13093f630495f55314f426171c0fd2da7b15d23f7c1bded`，其官方基础为 `node:24.12.0-bookworm-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99`。本轮覆盖复制全部源码、测试、兼容脚本和构建/打包输入，共 53 个文件，逐一 SHA-256 核对与 Windows checkout 一致；未复制 node_modules、.git 或 .npmrc。

本轮镜像为 `sha256:cbf508c0a2eac06375f4d2f47e0a2ab0e2cd6c57899fc6c5ccf85abb19bbed20`，Node `24.12.0`、pnpm `10.33.0`、Python `3.11.2`。首轮在 alpha.5 安装依赖时停滞，停止该临时容器，保留其缓存并重启完整验证；该次退出 137，不算通过。最终重跑冻结安装、构建、基线及十三组完整测试均成功；每组计数与上方 Windows 表一致，RC.3 为 149 通过、0 失败、0 跳过。完整打包 dry-run 为 17 个文件。容器 `662d536fee6696d6b395f782b29d6e23d5711a6562c823c8d172285502a3d287` 最终 `exited`、退出码 0，无挂载。

镜像在整理本文及 README 最终文档链接前构建；所测生产代码、测试、脚本、清单及锁文件与最终工作区一致。最终 Windows checkout 另做完整打包清单复核，不把文档链接差异当作运行时代码验证。

## 隔离 RC.3 Web profile

在临时 npm 前缀安装完整 `@deepseek-ai/dsh@0.2.1-rc.3`，使用独立 `DSH_HOME` 和随机回环端口。正常执行 `dsh plugin --profile web add file:C:/.../dsh-trellis` 成功，没有强制版本准入。不登录账号、不配置 API Key，不发送模型请求。

真实浏览器验证：

- 插件详情只有一份六字段表单；同时保存 `maxBytes=3072`、`skipKeyword=skip-rc3`，页面及临时 profile 的 `cordis.patch.yml` 读回一致。
- 单独恢复 `maxBytes` 为继承值 `4096`，磁盘删除该覆盖、保留 `skipKeyword`。保存 `enabled=false` 后表单仍可编辑。
- 组件停用后表单卸载，重新启用只恢复一份，配置保留；整包停用/启用有同样结果。页面重载后仍为 `4096`、`skip-rc3`、功能停用。
- 最后恢复 `enabled` 的继承值；整包和组件运行中，磁盘仅保留测试用 `skipKeyword` 覆盖。这些开关测试不当作不同代码版本的 HMR 证明。
- 标准预设的空会话保存草稿 A。通过“创建你的插件”指定 Creator 预设，另开空会话 B，没有接管 A 的草稿；给 B 写入不同草稿后，New Session 复用了已有的 B、切回标准预设，并保留 B 的草稿。刷新页面后草稿仍在。
- 对照临时宿主的原生 Session/projection 记录：始终只有两个 ID，B 的同一 ID 从 `cordis` 变为 `standard`，没有第三个会话；两者仍为空会话、0 回合、0 面包屑。不能假定 New Session 总会创建新 ID，或固定返回最早创建的空会话。

浏览器页和本轮独立 Web 进程已关闭，个人 DSH 未重启或升级。

## 契约与未覆盖项

[RC.3 新会话迁移说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/docs/upgrade-guide/v0.2.1-rc.2/new-session-blank-reuse/guide.md) 明确：无选项的新会话可能复用空白 Session；显式 `agentPreset` 不接管其他预设的空会话；驻留 Agent 不保证重新组合刚修改的预设定义。本插件继续使用宿主实际原生 ID，不重置、复制任务绑定，也不调用这些导航 API。

本轮未验证修改预设定义后重启重组、不同代码版本的插件 HMR、完整 SDK JSON-RPC / PTC 或付费模型派发；不把本地脚本化模型测试写作这些端到端证明。现有 [RC.2 验证记录](validation-dsh-0.2.1-rc.2.md) 保留为历史证据，不冒充本轮结果。首次验证时尚未触发远端 CI；`0.1.14` 以对应提交的结果为准。

本机日志、容器输入和浏览器截图保留在 `%TEMP%/dsh-trellis-rc3-6f92d3918e224f3b82fdd9ff8b88665f`，不入库；各 Windows 宿主夹具另由兼容脚本打印路径。

## 0.1.14 发布准备复核（2026-10-25）

- 包版本及当前安装示例更新为 `0.1.14`；不改变依赖基线、peer / engine 范围或生产代码。
- 冻结离线安装和客户端构建成功；完整基线再次为 149 项、145 通过、0 失败、4 个旧宿主能力跳过，构建后的 `lib/` / `src/` 无差异。
- 重新安装独立 RC.3 夹具，149 通过、0 失败、0 跳过。十三组跨平台首轮证据保留在上文，发布提交另由 Windows/Linux CI 跑完整矩阵，不将 CI 配置等同于通过。
- 完整 checkout 的打包 dry-run 为 17 个预期文件，排除 AGENTS.md、测试、夹具和日志。最终 CI 与 npm 发布以 [`v0.1.14`](https://github.com/SajoLuo/dsh-trellis/tree/v0.1.14) 对应提交为准。
