# 发布包 E2E 验证（2026-10-28）

## 发布状态

`dsh-trellis@0.1.17` 已通过既有 OIDC 工作流发布，`latest` 读回 `0.1.17`，npm 提供 SLSA provenance。发布提交 `af9043fcc7241298d190fb02d679736cf44d9443`、标签 `v0.1.17`；[发布工作流](https://github.com/SajoLuo/dsh-trellis/actions/runs/40641894372) 的 release、Windows/Linux test 和 publish 均为 success。本轮无需交互式 npm 认证。

E2E 开发环境另行提交；它不改变上述标签、运行时代码或已发布 tarball，也不再次发布同一版本。

## 环境和结果

使用 `--published` 正常安装 npm 上的 `dsh-trellis@0.1.17`。DSH 固定为 `0.2.2-alpha.2`、Trellis CLI 为 `0.7.0-beta.4`，完整工具依赖锁定在 `e2e/pnpm-lock.yaml`。运行方法见 [E2E 说明](../e2e/README.md)。

| 平台 / 权限 | Native | Node PTC | 结论 |
| --- | --- | --- | --- |
| Linux / workspace-write | 通过，33 次本地协议请求 | 通过，34 次本地协议请求 | 正常默认权限下的完整软件链路通过 |
| Windows / danger-full-access 临时对照 | 通过，33 次本地协议请求 | 通过，34 次本地协议请求 | 证明软件链路；不代表默认沙箱通过 |
| Windows / workspace-write | check 阶段失败 | 未进入后续模式 | 默认 `node --test` 创建子进程报 `spawn EPERM`，保留为失败 |

所有模型请求均发送到本轮回环 HTTP/SSE 服务，不消耗外部模型额度。DSH 模型协议适配器、SDK 服务、工具、Python、Shell、子代理、持久化和 Node PTC 子进程都是真实组件；没有替换宿主或等待工具。

Linux 独立镜像实际从固定 digest 的官方 `node:24.12.0-bookworm-slim` 构建，而非依赖本机之前的私有验证镜像。测试用户为非 root `node`，2 CPU、4 GiB，无主机挂载、凭据或端口映射。最终镜像 `sha256:e09baa060fc1e6b94341f62ec54f1895d8dc59622faa0b6160b3b7858e6dadc0`；容器 `763a6e8ee7e46cbffc0eeb17e08ad5d19eda6ae1a8538ae05726838488a542c2` 最终退出码 `0`。

## 验收事实

- 官方 CLI `trellis init --dsh` 创建独立 Git 项目；正常创建任务、填写 PRD、整理 implement/check context、验证清单并记录分支。没有使用空 context 或分支校验豁免。
- 真实 DSH Shell 写入且只使用自己的 `dsh_<session-id>` 指针。环境中故意设置的外层 Codex/Trellis 身份没有接管任务。另一个根 session 保持 `no_task`。
- 根会话无任务和绑定状态各注入一次；稳定状态去重。重启 SDK 进程并 `session/resume` 后仍去重，未复制身份或重新派发模型回合来冒充恢复。
- research、implement、check 三个直属 continuable child，各只加载自己的角色技能。研究只写研究材料，实施写实现，检查执行真实 Node 测试；报告经 `send_message` 发给父会话。
- 子代理 HTTP 请求由真实 wait 开始事件释放，三次 `trellis_wait` 均取得 completed 的实际结算；没有 shell sleep、轮询 agent、前台替代或直接调用内部 tool.execute。
- PTC 只公开 `run_code`，上述技能、Shell、派发、等待和报告通过真实 Node 子进程及生成的 `tools.*` 绑定执行。
- 非直属 child 的 wait 必须返回错误。任务结束后正式归档并写 journal，Git 工作区干净，根会话回到 `no_task`。
- 在另一个 child 和 wait 仍活动时关闭 SDK；进程退出 `0`，落盘 child 的 `turn/end` 为 aborted。检查持久化事实，不假定卸载 SDK 后仍转发 wire completion 通知。

验收脚本同时检查角色命令的成功标记、实际文件和 Node 测试，不能单凭 Agent 的 completed、模型的成功声明或 Shell 的 `isError=false` 判绿。本轮 Windows 默认沙箱的失败正由这些断言捕获；未以 `--test-isolation=none`、删测试、改断言或增加超时掩盖。

## 证据与限制

- 最终 Windows 对照运行：`%TEMP%/dsh-trellis-e2e-rGA9Ob`；默认沙箱失败证据：`%TEMP%/dsh-trellis-e2e-V3Py0k`。
- Linux 构建、最终日志和 inspect：`%TEMP%/dsh-trellis-e2e-linux-63679ec233f346ea89c6f8ea80c9b7d3`。容器内本轮报告目录 `/tmp/dsh-trellis-e2e-slJgcJ`。
- 每轮保留 report、wire/session events、模型协议请求、stderr、安装日志和验收项目。成功和失败证据分开保存；SDK/HTTP 服务结束，容器停止。

模型决策使用确定性本地脚本；这验证完整软件链路，不证明真实大模型能自主遵循 Trellis 工作流。真实模型请求尚未执行，仍需确认配置与预算。本套测试不覆盖桌面 GUI、跨代码 HMR、SSH 工作区、全部压缩/分叉组合；相关插件回归和上一轮隔离 Web 验收分别保留在对应验证记录。
