# DSH 0.2.2-rc.2 适配与 0.1.19 验证

日期：2026-11-13。插件以 `main@3c1e032` 为适配基线，发版目标为 `0.1.19`。
初轮源码验收仍使用 `0.1.18` 版本字段打包，但不是 npm 上的 `0.1.18`；后者不包含
本轮 RC.2 等待修正。版本更新后的独立复测见下方发版验证记录。

## 权威契约与变更

官方发布为 [dsh-v0.2.2-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.2)，
tag 为 `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`。npm 的 `next` 已指向
RC.2，`latest` 仍为 RC.1。核对过实际发布包的 SHA-512 和源码/类型：

- [`subagents.listChildren()` 被移除](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/docs/upgrade-guide/v0.2.1-rc.2/subagent-service-methods/guide.zh.md)。
  RC.2 通过 `sessionQuery.observeSession()` 读取直接目录；观察对象必须释放。
- [`subagent` 返回名称](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/docs/upgrade-guide/v0.2.2-alpha.3/subagent-names/guide.zh.md)，
  `send_message` 参数为 `agent`，`startActivation()` 的请求字段改为平铺。
  名称不等于 Session id，不能据此生成 Trellis 会话身份。
- [生命周期通知](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/packages/subagent/subagent/src/manager.ts)
  在运行时树根分派，`parentSessionId` 保留直接创建者。
- [`addition-only` 请求投影](https://github.com/deepseek-ai/deepseek-harness/blob/ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c/packages/llm/llm/src/content.ts)
  在工具移除或从空集合增加工具时重建声明。新测试检查对应的立即声明及无冗余 developer
  消息，同时保留工具启停、持久化历史、回放、分叉、压缩与面包屑断言。

等待工具保持 `subagent_id` 参数和输出结构，按实际服务能力选择旧目录 API 或 RC.2
路径。新路径先在树根订阅，异步解析名称并读取直接目录，按直接父级过滤事件；查询期间
捕获的结算只能在归属与创建代次验证通过后使用。结果中的 `subagentId` 是原生 Session id。
缺失/损坏目录、外部或非直接子级、旧代次、取消及卸载均失败关闭；inactive 仍为 unknown，
不宣称完成通知已投递。

不改运行时 peer/engine 范围、根依赖锁、开发基线、插件清单格式或安装命令。RC.2 的
隔离工具链为 Cordis `4.1.0`、Schemastery `3.19.0`、Include/Loader `1.1.0`。
Settings、投影及消息注入沿用公开接口并接受本轮完整回归。CI 默认从单一清单运行
十九个明确宿主，不复制第二份版本列表。

## Windows 测试结果

环境：Node `24.22.1`、pnpm `10.33.0`、Python `3.12`，所有宿主依赖在独立临时副本安装。

| 验证 | 结果 |
| --- | --- |
| 修复前 RC.2 原始套件 | 161 通过 / 6 失败；实际复现等待目录、平铺启动参数、动态工具预期不匹配 |
| 开发基线 `0.2.0-rc.1` | 175 通过 / 7 能力跳过 / 0 失败 |
| RC.2 完整套件 | 182 通过 / 0 跳过 / 0 失败 |
| 十九个宿主的完整矩阵 | 共 3458 项：3365 通过 / 93 能力跳过 / 0 失败 |

旧宿主的跳过包括不具备 named-nested API 的新增真实嵌套用例，不能算作执行通过。
新增回归覆盖名称/目录查询期间结算、查询失败与卸载、观察对象清理、错误父级事件、
复用 Session id，以及真实 AgentLoop 的 completed/failed/aborted 和具名嵌套生命周期。
旧宿主路径仍执行原来的直接子级、取消、回放等测试。

独立检查的基线及真实 RC.2 目录/activation/动态工具目标测试亦通过。客户端由正常
prepack 构建。Windows/Linux 发版 CI 会在 `v0.1.19` 的精确 tag SHA 上执行这十九个目标，
远端结果以对应工作流为准；Linux 本地 E2E 按用户决定稍后安排。

## 0.1.19 发版前复测

版本字段更新到 `0.1.19` 后，重新执行开发基线测试：175 通过 / 7 能力跳过；
重新安装独立 RC.2 宿主并运行完整套件：182 通过 / 0 跳过 / 0 失败。
再次通过正常 prepack 打包并安装实际 `0.1.19` tarball，在独立 SDK profile 中运行
Native/PTC E2E：临时 `danger-full-access` 对照分别 33 / 34 次回环请求，两项均通过、
SDK 正常退出，包含最终收紧的身份整行和启动回执精确断言。

证据位于 `%TEMP%/dsh-0.1.19-baseline-20261113.log`、
`dsh-0.1.19-rc2-20261113.log`、`dsh-0.1.19-e2e-20261113.log` 和
`dsh-trellis-e2e-ADISN2`。默认 Windows 沙箱限制仍按下方失败记录披露。
发版工作流会在精确标签提交上重跑 Windows/Linux 完整矩阵，再以 OIDC 发布；
其执行结果与 npm 上的 `0.1.19` 是最终发布凭据，不以本文的本地通过代替。

## SDK E2E

初轮使用正常 prepack 的源码 tarball、DSH RC.2、已发布 Trellis `0.7.0-beta.4`，独立
`DSH_HOME`/profile/项目和回环 HTTP/SSE 脚本化模型。新 Trellis 模板在独立工作区另做
生成回归，未将其未提交 gitlink 拼入本次 SDK 环境。

| 模式 | 权限 | 结果 |
| --- | --- | --- |
| Native | 默认 `workspace-write` | 失败：check 角色的真实 `node --test` 子进程创建报 `spawn EPERM` |
| PTC | 默认 `workspace-write` | 未执行：Native 失败后按原规则退出 |
| Native | 临时 `danger-full-access` 对照 | 通过，33 次回环模型请求，SDK 正常退出 |
| PTC | 临时 `danger-full-access` 对照 | 通过，34 次回环模型请求，SDK 正常退出 |

两项对照都验证实际具名启动回执、按名称等待、向 `lead` 报告、解析后的子 Session id、
Shell 的精确 `dsh_<session-id>`、三个角色技能与真实命令、任务绑定、外部会话隔离、
面包屑去重、进程重启/恢复、非法 child 拒绝、归档/journal，以及关闭时取消活动 child/wait
并落盘。没有关闭 Node 测试隔离、删测试、增加超时或放宽失败断言。

独立复查进一步收紧了名称回执的 `meta.kind/name` 和单独 text 块精确匹配，以及 Shell
身份整行相等断言。对两套已保存的真实事件重新离线验收均通过，附加 `-foreign` 后缀
的反例被拒绝；没有为此重复启动 SDK。最终等待相关 38 项测试及 E2E 脚本语法检查通过。

非沙箱对照通过不能证明默认沙箱通过。模型决策由本地脚本编排，不验证真实大模型自主
遵守指令；本轮也不覆盖桌面 GUI、跨版本 HMR、SSH 工作区或 Linux E2E。

## Trellis / marketplace 生成说明同步

文案和生成回归位于独立干净起点的工作区，分别基于原 #657 的
`15235ead76fb108ad9626953aefbdc938524c54b` 和 #20 的
`7e8f2cb64e5fde9160fc8991b71e0b8b419af7a1`。原 PR 分支和原仓库身份/归档 WIP
保持不动。DSH guide、bundled meta、shared workflow、dogfood 与 marketplace 镜像
同步具名协议、可见 schema 能力门槛、直属 continuable 归属及 Session 身份边界。
gitlink 尚未改成未发布的工作区内容。

目标 DSH/同步/shared 测试 74 项全部通过，lint/typecheck/build 通过；独立检查另跑
DSH/同步 20 项通过，三份 workflow 归一 LF 后相等。GitNexus 修改前 impact 为 LOW，
最终变更检测为 LOW、零受影响执行流程。

完整模板测试仍非全绿：适配工作区 330 通过 / 10 失败，干净原始 head 328 通过 /
相同的 10 失败。新增两项 RC.2 回归均通过。失败集合由九项 OMP Windows `/tmp`
夹具及一项 OpenCode 路径断言组成；未删改、跳过或拼入 Windows companion 修复。
这些结果不把原 #657 转为 ready。详细工作区、补丁和基线证据见现有 Trellis 任务的
`research/rc2-template-adaptation-20261113.md`。

DSH E2E 安装的官方依赖仍提示 OpenTelemetry API `1.10.0` 与 SDK 的 `<1.10.0` peer 范围不匹配，
并跳过未启用的 Google/protobuf 构建脚本。未通过 override、批准无关脚本或关闭断言
掩盖这些提示。本次遥测关闭且模型只走回环，不证明相关外部提供商和遥测功能已验证。

## 原始证据

以下路径位于本机 `%TEMP%`，不提交日志、临时项目或包缓存：

- `dsh-rc2-before-20261113.log`：原始六项失败。
- `dsh-rc2-second-fix-20261113.log`：RC.2 完整套件通过。
- `dsh-rc2-baseline-20261113.log`、`dsh-rc2-all-hosts-20261113.log`：基线与十九宿主矩阵。
- `dsh-rc2-matrix-summary-20261113.json`：各宿主统计与精确临时副本路径。
- `dsh-rc2-independent-baseline-20261113.log`、`dsh-rc2-independent-native-20261113.log`：独立验证。
- `dsh-rc2-independent-final-waits-20261113.log`、`dsh-rc2-independent-e2e-offline-20261113.json`：最终等待回归、收紧断言的原始事件重验与反例。
- `dsh-trellis-e2e-AERZ5W`、`dsh-rc2-e2e-default-20261113.log`：默认沙箱失败的完整材料。
- `dsh-trellis-e2e-ztPO4J`、`dsh-rc2-e2e-control-20261113.log`：Native/PTC 对照的 tarball、报告和原始事件。
- `dsh-upstream-monitor-20261113`：官方 npm 元数据、已校验发布包和公开 API 对比。

适配阶段没有提交、推送或发布包；后续按用户明确授权发布 `0.1.19`。
本轮不升级个人 DSH、不安装 WSL/WSLC、不调用付费模型。
