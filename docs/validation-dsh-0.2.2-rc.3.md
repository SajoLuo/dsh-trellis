# DSH 0.2.2-rc.3 兼容验证

日期：2026-11-14。插件版本：`0.1.20`。

## 官方契约与改动范围

官方 [RC.3 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3)
新增实验性聊天导入插件，并修复 Windows 桌面应用内更新重启。
同日只读检查对 RC.2/RC.3 的 18 个关键 npm 包逐一校验 tarball integrity，并比较
发布的运行代码及类型；仅归一化版本字符串后没有差异。包括 Settings、AgentLoop、
LLM、Session/Query/Projection、子代理、Commands、WorkingDirectory、两个 executor
及配置客户端包。官方 master 的未发布迁移不作为本次 RC.3 的契约。

RC.3 继续使用 Cordis `4.1.0`、Schemastery `3.19.0`、Include/Loader `1.1.0`。
本次补齐显式兼容清单、独立期望值和 executor/工作目录夹具，CI 默认从该清单运行
二十个宿主，不另复制一份版本列表。运行时代码、peer/engine、根锁文件、开发基线、
插件清单格式和安装命令不变。

先在真实 RC.3 上保留原测试运行，复现 `addition-only` 动态工具用例失败：测试只把
RC.2 识别为移除/空工具集后重建声明的宿主。现在明确列出 RC.2 与 RC.3；旧宿主仍按
原协议检查，未知 RC.4 继续拒绝生成测试清单，不按版本排序猜测行为。

E2E 固定官方 DSH RC.3、Trellis `0.7.0-beta.4` 和完整锁文件。锁文件按 RC.2/RC.3
版本名归一化比较后，仅新增官方聊天导入包；其余非 DSH 包版本及元数据无变化。
没有添加 override 或批准无关安装脚本。

## Windows 本地结果

环境：Node `24.22.1`、pnpm `10.33.0`、Python `3.12.10`。
所有兼容宿主均在独立临时副本安装，未改个人 DSH。

| 验证 | 结果 |
| --- | --- |
| 原 RC.3 动态工具预期 | 复现 `addition-only` 用例失败，未吞错 |
| 正常客户端构建 | 通过，生成的发布代码没有语义变化 |
| 开发基线 `0.2.0-rc.1` | 176 通过 / 7 能力跳过 / 0 失败 |
| RC.3 完整套件 | 183 通过 / 0 跳过 / 0 失败 |
| 二十宿主完整矩阵 | 3660 项：3567 通过 / 93 能力跳过 / 0 失败 |

真实 Loader 的 Settings 生效配置/重挂/卸载、三种动态工具更新能力、pre-step 消息
注入及投影恢复/分叉/压缩、精确身份、子代理目录和具名嵌套等待均由同一套回归执行。
旧宿主缺少公开 API 时的能力跳过不计入执行通过。

## SDK E2E

通过正常 prepack 构建并安装实际 `0.1.20` tarball，使用新建的 Git 项目、独立
`DSH_HOME`/SDK profile 和回环 HTTP/SSE 脚本化模型。DSH、SDK、Shell、Python CLI、
子代理、持久化及 Node PTC 均真实运行；不使用个人配置或外部模型额度。

| 模式 | 权限 | 结果 |
| --- | --- | --- |
| Native | 默认 `workspace-write` | 失败，check 角色的 `node --test` 子进程报 `spawn EPERM` |
| PTC | 默认 `workspace-write` | 未执行，按原规则在 Native 失败后退出 |
| Native | 临时 `danger-full-access` 对照 | 通过，33 次回环模型请求，SDK 正常退出 |
| PTC | 临时 `danger-full-access` 对照 | 通过，34 次回环模型请求，SDK 正常退出 |

两项对照都覆盖任务建档/绑定、面包屑去重、外来会话隔离、三角色技能、具名启动回执、
`send_message({ agent: "lead" })`、按名称等待并核对原生 Session id、真实 Shell 测试、
SDK 进程重启恢复、非法 child 拒绝、归档/journal 和关闭时取消活动 child/wait 的落盘事实。
身份回执仍按整行精确匹配。未放宽断言、增加超时或关闭 Node 测试隔离。

非沙箱对照不证明默认沙箱通过；不验证真实大模型自主遵循工作流。Linux E2E 按用户
决定稍后安排，不把 Windows 结果或历史 Linux 记录当作本轮 Linux E2E。桌面 GUI、
隔离 Web 浏览器、跨版本 HMR 和 SSH 工作区本轮未运行。

官方依赖仍有 OpenTelemetry API `1.10.0` 与 SDK `<1.10.0` 的 peer 提示，Google/protobuf
未启用的构建脚本仍被跳过。测试关闭遥测，不覆盖这些外部提供商功能。

## 原始证据与发布门槛

本机 `%TEMP%/dsh-0.1.20-release-20261114` 保存安装、构建、基线、完整矩阵、修复前
失败、默认/对照 E2E 日志、退出码，以及逐宿主汇总和锁文件比较。

- 默认沙箱 E2E：`%TEMP%/dsh-trellis-e2e-cwkoGr`。
- Native/PTC 对照：`%TEMP%/dsh-trellis-e2e-2Tz2bO`。
- 官方包比较：`%TEMP%/dsh-upstream-monitor-20261114/published-package-comparison.json`。

发版工作流必须在 `v0.1.20` 的精确提交重跑 Windows/Linux 全部二十宿主、基线、
客户端构建与打包检查，全部测试任务成功后才以既有 npm OIDC 发布。以上是本地验证，
不代替远端 CI、registry 实际版本、包哈希与来源证明的核对。

Trellis/marketplace 原 PR 和另行准备的 RC.2 模板工作区保持原状，不随插件发版提交。
