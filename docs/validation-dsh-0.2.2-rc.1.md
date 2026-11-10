# DSH 0.2.2-rc.1 兼容验证（2026-11-11）

本轮交付 `0.1.18`，修改兼容夹具、Settings 测试、CI 和 E2E 依赖；插件运行时代码、主开发基线和 peer/engine 范围未变。适配阶段的完整回归与 E2E 使用版本字段仍为 `0.1.17` 的源码 tarball；发版阶段另对 `0.1.18` 正常 prepack 产物复测。远端 CI 与 npm 最终发布状态以 `v0.1.18` 对应工作流和 registry 为准，不把本地通过冒充发布完成。

## 官方工具链

依据 npm 上各精确版本的 Settings/Scope/Tools、Loader 和 Include manifests 核对，不使用发布说明中的近似版本，也不按版本前缀推断能力。

| 新增目标 | Cordis | Schemastery | Include | Loader |
| --- | --- | --- | --- | --- |
| 0.2.1-rc.5 | 4.0.5 | 3.18.5 | 1.0.10 | 1.0.6 |
| 0.2.2-alpha.3 | 4.0.6-alpha.2 | 3.18.6-alpha.2 | 1.0.11-alpha.2 | 1.0.7-alpha.2 |
| 0.2.2-rc.1 | 4.1.0 | 3.19.0 | 1.1.0 | 1.1.0 |

现有 DSH engine 和所有 npm peer 范围已允许这三组版本，默认 semver 检查通过，不需要放宽范围。三个 0.2.2 目标都显式安装 Native/PTC executor 与工作目录夹具。未知版本仍拒绝，不把未测试的 alpha.4 或 RC.2 自动当作兼容目标。

- [RC.1 官方 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.1)
- [Cordis 配置与生命周期实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/vendor/cordis/src/fiber.ts)
- [Settings 的规范化 fiber 所有权](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/settings/settings/src/index.ts)
- [Session Projection 生命周期与 checkpoint](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/session/session-projection/src/index.ts)

## 设置测试的失败与修正

先在真实 RC.1 依赖夹具运行完整测试，复现 **165 通过、1 失败、0 跳过**：旧测试读取 `fiber.config.enabled.get`，而 Cordis 新版的 `config` 保留原始输入，生效的 volatile 引用位于 `effectiveConfig`。

测试现在按属性能力读取 `effectiveConfig`，旧宿主回退 `config`。alpha.3 还复现了 presentation 尚未注册时就断言数量为 1 的失败；可选注入消费者具有独立生命周期，不能用根 fiber 的 await 冒充消费者已经就绪。测试改为等待真实 configure 调用，并用 `owner.ctx.fiber` 与目标 fiber 的规范化身份核对归属。断言放在测试主体中，避免被宿主当作插件启动异常消费后留下悬空的就绪 Promise。

仍保留相同 volatile 引用、插件实例不重建、相同值更新不重复挂载、provider 卸载释放 policy、命令开关、插件卸载取消旧 wait 等断言。没有删用例、放宽所有权、增加超时或以 sleep 代替生命周期等待。

## Windows 完整回归

环境：Windows、Node `24.22.1`、pnpm `10.33.0`、Python `3.12`。最初发现 PATH 的 pnpm 为 11；正式安装与验证统一使用项目固定的 `10.33.0`。根目录和 E2E 的 frozen-lockfile 检查通过，主 `pnpm-lock.yaml` 与已生成客户端没有内容变更。

`pnpm test`：**160 通过、6 项宿主能力跳过、0 失败**（166 项）。`pnpm run test:compat` 运行全部十八个明确宿主，每个都运行相同的完整测试文件集合：

| DSH | 通过 | 跳过 | 失败 |
| --- | ---: | ---: | ---: |
| 0.1.5-rc.2 | 153 | 13 | 0 |
| 0.1.6-alpha.2 | 153 | 13 | 0 |
| 0.1.7-rc.1 | 155 | 11 | 0 |
| 0.1.7-rc.2 | 158 | 8 | 0 |
| 0.2.0-rc.1 | 160 | 6 | 0 |
| 0.2.0-rc.2 | 160 | 6 | 0 |
| 0.2.1-alpha.2 / alpha.3 / alpha.4 / alpha.5 | 各 164 | 各 2 | 0 |
| 0.2.1-rc.1 / rc.2 / rc.3 / rc.4 / rc.5 | 各 164 | 各 2 | 0 |
| 0.2.2-alpha.2 / alpha.3 / rc.1 | 各 166 | 0 | 0 |

合计 **2913 通过、75 项旧宿主能力跳过、0 失败**。跳过不是通过；新 RC.1 和 alpha.3 的 166 项均实际执行。客户端构建、Node 语法检查、`npm pack --dry-run --ignore-scripts`、`git diff --check` 通过。

Windows/Linux 的 CI OS 矩阵保留，兼容步骤改为无版本参数的 `pnpm run test:compat`，直接使用完整清单；独立测试期望仍逐项核对版本与工具链，避免第二份 CI 参数列表再次漏项。发布工作流在 tag 的精确 SHA 上重跑两个 OS 的完整矩阵，全部成功后才允许 OIDC 发布。Linux 本地验证及 E2E 按用户选择留待恢复环境后执行。

## RC.1 E2E

E2E 固定 DSH `0.2.2-rc.1`、Trellis `0.7.0-beta.4`。RC.1 的 app-boot 声明 Group peer `~1.1.0`；原锁文件曾复用不匹配的 alpha Group，现显式固定 `@deepseek-ai/cordis-plugin-group@1.1.0` 并重建锁文件，不以 peer warning 豁免替代正确依赖。

| Windows 临时 profile / 源码包版本 | Native | Node PTC |
| --- | --- | --- |
| workspace-write（默认），0.1.17 适配阶段 | check 阶段失败：默认 `node --test` 创建子进程报 `spawn EPERM` | Native 失败后未进入 |
| danger-full-access（隔离对照），0.1.18 发版复测 | 通过，33 次回环请求 | 通过，34 次回环请求 |

对照使用 `pnpm run test:e2e --permission danger-full-access`，只影响新建的临时 DSH_HOME/profile；没有修改个人 DSH 设置。Native/PTC 均经过真实 SDK、正常插件 tarball 安装、Python/Shell、三个角色子代理及 `trellis_wait`、任务身份隔离、面包屑去重、进程重启/恢复、非法 child 拒绝、任务归档与 journal、活动 child/wait 的关闭取消及落盘检查。角色命令成功标记和真实 Node 测试均有断言，SDK 退出码为 0。

默认沙箱失败保留为失败，没有关闭 Node 测试隔离或降低业务断言。完整访问对照通过不表示默认沙箱通过。模型决策由本地 HTTP/SSE 脚本提供，不调用付费模型，也不证明真实大模型自主遵循工作流。桌面 GUI、跨版本代码 HMR、SSH 工作区未在本轮覆盖。

## 原始证据

以下目录都在本机 `%TEMP%`，保留供检查，不提交运行日志和临时验收项目：

- `dsh-rc1-before-fix-20261111.log`：RC.1 的原始设置失败。
- `dsh-rc1-new-hosts-20261111.log`：RC.5 通过与 alpha.3 的初始就绪断言失败。
- `dsh-rc1-baseline-final-20261111.log`、`dsh-rc1-all-hosts-final-20261111.log`：最终基线及全部十八宿主回归。
- `dsh-rc1-root-install-final-20261111.log`、`dsh-rc1-e2e-frozen-20261111.log`：固定 pnpm 的锁文件安装验证。
- `dsh-trellis-e2e-RSEKQu`：默认沙箱失败的 report、wire、stderr、模型请求与验收项目。
- `dsh-trellis-e2e-B14cx9`：最终 Native/PTC 完整访问对照的 report、事件、模型请求、安装日志与验收项目。
- `dsh-0.1.18-baseline-20261111.log`、`dsh-0.1.18-rc1-20261111.log`：版本更新后的基线 160 通过 / 6 跳过，以及 RC.1 全部 166 通过。
- `dsh-trellis-e2e-UJSHdV`、`dsh-0.1.18-e2e-20261111.log`：0.1.18 正常 prepack 的 tarball，以及 Native/PTC 发版复测的完整报告和原始材料；两项均通过。

E2E 安装仍报告官方依赖中的 OpenTelemetry API peer 范围冲突（1.10.0 与 SDK 的 `<1.10.0`），以及未启用的 Google/protobuf 构建脚本；没有通过 override 或批准无关脚本掩盖它们。测试使用关闭遥测的回环模型路径，这不代表这些外部提供商或遥测功能已验证。

本轮没有安装 WSL/WSLC、启动 Docker、升级个人 DSH、修改 Trellis 源码/WIP或调用真实模型。Linux 本地 E2E 仍是待补验证，不能用 alpha.2 的历史 Linux 结果代替；发布时的 Windows/Linux 兼容回归由 OIDC 工作流在精确 tag SHA 上重新执行。
