# DSH 0.2.1-rc.2 兼容验证（2026-10-18）

## 范围与判断

首次验证于 2026-10-18，基于插件 `32706f7e571ed0b985c2c8930e919e7ca8905347` 的工作区改动。当时包版本为 `0.1.12`，尚未提交、推送或发布；以下保留当日的本地结果，不是远端 CI 结论。本记录随 `0.1.13` 归档，最终 CI 与发布状态以该版本的提交、标签和 npm 为准。未升级个人 DSH，未读取个人模型凭据或会话，未修改 Trellis 模板和另行跟进的上游 PR。

核对官方 [RC.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)（tag `dsh-v0.2.1-rc.2`，SHA `687f282e8625c6b8d11ff58211a90524be2e4317`）以及 alpha.3 / alpha.4 / alpha.5 / RC.1 的发布包：

- 现有 `engines.dsh` 与七项 DSH peer 已接纳这些目标，不需要再堆叠版本范围。新增测试验证本插件的声明，不复刻或代替宿主准入检查器。
- RC.1 / RC.2 的 Cordis、Schemastery、Include、Loader 已发布稳定版本，不能继续沿用 alpha 依赖组合。兼容脚本改为十二个精确宿主的封闭映射，未知目标拒绝执行。
- 保留 `0.2.0-rc.1` 开发依赖基线及旧宿主能力跳过；插件 `lib/` / `src/` 运行时代码不变。仅增加开发期 semver 依赖、测试与 CI 目标，更新操作说明。

## Windows 自动测试

环境：Windows，Node `24.12.0`，pnpm `10.33.0`。`pnpm install --frozen-lockfile --ignore-scripts --offline`、客户端构建和 `npm pack --dry-run --ignore-scripts` 均成功。打包仅包含既有发布文件及 README，不加入兼容夹具、凭据或测试日志。

开发基线 `pnpm test`：147 项，143 通过、0 失败、4 个能力跳过。随后在独立临时副本逐个安装宿主并执行同一套完整插件测试，退出码均为 0：

| DSH | 总数 | 通过 | 失败 | 能力跳过 |
|---|---:|---:|---:|---:|
| 0.1.5-rc.2 | 147 | 136 | 0 | 11 |
| 0.1.6-alpha.2 | 147 | 136 | 0 | 11 |
| 0.1.7-rc.1 | 147 | 138 | 0 | 9 |
| 0.1.7-rc.2 | 147 | 141 | 0 | 6 |
| 0.2.0-rc.1 | 147 | 143 | 0 | 4 |
| 0.2.0-rc.2 | 147 | 143 | 0 | 4 |
| 0.2.1-alpha.2 | 147 | 147 | 0 | 0 |
| 0.2.1-alpha.3 | 147 | 147 | 0 | 0 |
| 0.2.1-alpha.4 | 147 | 147 | 0 | 0 |
| 0.2.1-alpha.5 | 147 | 147 | 0 | 0 |
| 0.2.1-rc.1 | 147 | 147 | 0 | 0 |
| 0.2.1-rc.2 | 147 | 147 | 0 | 0 |

旧宿主的跳过不算通过，只表明缺少对应新版能力。未删测试、放宽断言、增加超时或强制准入。一次注册表连接重置由包管理器正常重试成功，不隐藏运行失败。

测试沿用真实 AgentLoop、ToolRuntime、Loader、Session/projection 和 SubagentRuntime，覆盖目录 A→B→A、原生 ID、恢复/分叉、面包屑压缩后重注入、Settings 重挂及卸载清理、失败工具历史恢复、直接子代理结算与取消；本地脚本化模型不调用外部服务。新增回归独立列出十二个宿主的精确依赖预期，校验 manifest 不被原地修改、未知宿主 fail-closed，以及本插件 engine / peer 的预发布匹配。

## Linux 验证

通过 WSLC 运行隔离 Linux 容器，不启动 Docker Desktop，不挂载主机目录、凭据或个人 DSH 配置。仅复制源码、测试和构建所需文件，非 root 执行验证。基础镜像为官方 `node:24.12.0-bookworm-slim`，固定 digest `sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99`。

最终镜像 ID：`sha256:6846928444d90f2fa13093f630495f55314f426171c0fd2da7b15d23f7c1bded`。Node `24.12.0`、pnpm `10.33.0`、Python `3.11.2`；冻结安装、客户端构建、基线与十二组完整测试均通过，容器最终退出码 0。每组通过/失败/跳过数与 Windows 表完全一致，RC.2 为 147 通过、0 失败、0 跳过。

首次构建先遇到 `/work` 的非 root 写权限错误，修正临时镜像目录归属；构建阶段安装又长时间无进展，因此取消该次构建，将同样的冻结安装移到运行阶段以记录详细日志，随后完整链路通过。没有修改插件生产代码或测试断言，也未把此前失败/取消算作通过。WSLC 提示宿主缺少 swap limit 能力，实际使用 4 GiB 内存限制和 2 CPU；未导致测试失败。

Linux `npm pack --dry-run --ignore-scripts` 退出 0；容器上下文只含执行所需文件，因此其 15 文件清单不作为完整发布包证明。完整 Windows checkout 的 dry-run 为 17 文件（含 README 与 LICENSE），发布清单以该结果为准。未实际生成或上传发布包。

## 隔离 RC.2 Web profile

另在临时 npm 前缀安装完整 `@deepseek-ai/dsh@0.2.1-rc.2`，以独立 `DSH_HOME` 和回环随机端口启动 Web。正常执行 `dsh plugin --profile web add file:C:/.../dsh-trellis`，版本准入成功，没有 `allow-version`。不登录账号、不配置 API Key、不发送外部模型请求。

已通过真实浏览器确认：

- 插件详情中仅一份六字段配置表单。
- 同时保存 `maxBytes=3072` 与 `skipKeyword=skip-rc2`，页面读回及独立 profile 的 `cordis.patch.yml` 一致。
- 单独恢复 `maxBytes` 为继承值 `4096`，磁盘删除该覆盖，保留 `skipKeyword`。
- 保存 `enabled=false` 后表单仍可编辑，不被整包卸载。
- 组件停用时表单卸载，重新启用只恢复一份表单，保留已保存覆盖。
- 整包停用时表单卸载，重新启用恢复；浏览器重载后重新打开详情，仍是 `4096` / `skip-rc2` 与已保存的功能开关值。
- 最后恢复 `enabled` 的继承值，整包和组件均运行中；页面显示单份表单。未把这些开关/重载结果写作不同代码版本的 HMR 证明。

## 操作契约与未覆盖项

- [engines.dsh 迁移](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.md)：alpha.4 起显式 engine 优先，缺省才回退 DSH peer。测试本插件声明和真实正常安装，不宣称覆盖宿主全部负向准入分支。
- [插件管理器](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/plugin-manager/README.md)：运行中满足条件的更新可 HMR；外部 CLI 快照刷新应重启，跨宿主 release 应刷新 Web。组件开关不等于代码热替换。本轮不宣称验证了不同代码版本的包替换或跨宿主页面刷新。
- [AgentPreset](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/upgrade-guide/v0.2.1-alpha.1/subagent-preset-composition/guide.md)：不再发送已移除的 persona/toolFilter，尊重宿主预设列表与 fork 继承。本插件未使用移除字段，无需新增运行时兼容分支。
- [SDK](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/sdk/server/README.md)：session/resume 恢复原生 ID、历史及有效目录；session/wait 是 SDK RPC，不等同模型工具。已有原生 Session 回归不能替代完整 JSON-RPC 恢复、真实 PTC 执行或付费模型派发的端到端验收，本轮未宣称完成这些验证。
- [技能缓存](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/client/ui-skill/README.md)：插件管理器变化的失效通知不等同磁盘技能变化通知；init/update 后按宿主预设切换或重连刷新，不加全局缓存补丁。
- [可选插件索引](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/user/guide/plugin-market.md)：Discover 索引与 Trellis marketplace 不同，普通安装不需要额外脚本或索引。10 月 18 日验证阶段未发布 npm；`0.1.13` 的发布仅涉及本插件，不创建公共索引或改动三份上游 PR。

本机完整日志和临时夹具保留在 `%TEMP%/dsh-trellis-rc2-a63b1d6dcdca494690171fd7f50dd2d2`；各宿主兼容夹具另由脚本打印路径。日志不入库。

## 0.1.13 发布准备复核（2026-10-20）

- 包版本及当前安装示例更新为 `0.1.13`；不修改已有 peer / engine 范围、宿主开发基线或运行时代码。
- 重新执行冻结离线安装、客户端构建和完整基线：147 项，143 通过、0 失败、4 个能力跳过；构建后 `lib/` / `src/` / bundle 入口无差异。
- 重新安装独立 RC.1、RC.2 夹具，各为 147 通过、0 失败、0 跳过。十二组跨平台首轮结果保留在上文，发布提交另由 Windows/Linux CI 跑完整矩阵，不把新增 CI 配置当作已通过。
- 完整 checkout 的 `npm pack --dry-run --ignore-scripts` 成功，17 个预期文件，未混入日志、测试夹具或凭据。发布状态以 [`v0.1.13`](https://github.com/SajoLuo/dsh-trellis/tree/v0.1.13) 对应提交的 CI 和 npm 为准。
