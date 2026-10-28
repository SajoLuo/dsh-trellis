# DSH × Trellis E2E

固定 DSH `0.2.2-alpha.2`、Trellis CLI `0.7.0-beta.4` 和完整依赖锁文件。每次运行创建新的临时 Git 项目、`DSH_HOME`、SDK profile、会话和日志目录。默认测试当前源码打包产物；`--published` 安装 npm 上与根 `package.json` 相同版本的正式包。不会切换或清理开发仓库，不使用个人 DSH 配置或凭据，不推送验收项目。

## 本机运行

需要 Node `24.12.0`、pnpm `10.33.0`、Python 3、Git；Windows 还需 PowerShell 7 的 `pwsh`。Linux 使用 `bash`、`python3`。

```powershell
pnpm install --frozen-lockfile
pnpm --dir e2e install --frozen-lockfile
pnpm run test:e2e             # 正常 prepack 构建并安装当前源码 tarball
pnpm run test:e2e --published # 安装同版本的 npm 发布包
```

默认沿用 DSH 的 `workspace-write` 权限。Windows 在此模式中执行默认 `node --test` 已复现 `spawn EPERM`：命令无法创建测试子进程，E2E 必须失败。诊断软件链路时可显式选择临时非沙箱 profile：

```powershell
pnpm run test:e2e --published --permission danger-full-access
```

这项对照不修改个人权限设置，也不证明 Windows 默认沙箱通过。保留全部 Node 测试、默认测试隔离和业务断言，不用关闭测试隔离、删用例、增加超时等方式凑绿。

## Linux 独立环境

镜像从固定 digest 的官方 Node 基础镜像构建，包含 Python、Git 和原生模块构建工具，以非 root `node` 运行。COPY 只接收清单、锁文件和验收脚本，不复制个人配置；运行时不挂载主机目录或凭据，不映射端口。默认验证正式 npm 包，权限仍是 `workspace-write`。

```powershell
wslc build -f e2e/Dockerfile -t dsh-trellis-e2e .
wslc create --name dsh-trellis-e2e --cpus 2 --memory 4G dsh-trellis-e2e
wslc start dsh-trellis-e2e
wslc logs dsh-trellis-e2e
wslc inspect dsh-trellis-e2e
```

使用新的容器名重复验收，避免误用已有容器的旧输入。必须看到最终报告的两项 `passed` 和容器退出码 `0`；启动成功、依赖安装完成或单项通过都不是完整通过。脚本中任一断言失败会使进程返回非零。没有自动创建定时任务或改写发布 CI。

## 实际经过的链路

本地 HTTP/SSE 服务只编排模型决策，DSH 自身、模型协议适配器、SDK stdio JSON-RPC、工具执行器、Python CLI、Shell、子代理、会话持久化和 Node PTC 子进程全部真实运行。HTTP 服务只监听回环地址；子代理在收到真实 `trellis_wait` 开始事件前保持请求未完成，随后由事件释放，不用 sleep 或反复查询 agent。

Native 和 PTC 各验证：

1. `trellis init --dsh` 初始化新项目；正常安装 tarball / npm 包，完整 SDK initialize。
2. 通过真实 Shell 建档、填写 PRD、整理 implement/check context、验证并绑定任务。即使继承外层 Codex/Trellis 身份，也只写自己的 `dsh_<session-id>` 指针。
3. 无任务与绑定状态各注入一次；稳定状态去重；另一个 SDK session 不借用已有任务。
4. research → implement → check 三个直属 continuable 子代理各只加载自己的角色技能；执行命令并向父代理报告，分别通过真实 `trellis_wait` 汇合。
5. 检查角色命令的成功标志和真实测试结果，不能把 Agent 的 `completed` 或 Shell 的 `isError=false` 当作业务测试通过。
6. 关闭并重启 SDK 进程，恢复相同原生会话，投影重放后不重复注入。
7. 非直属 child 的 wait 必须被拒绝；归档任务、写 journal，Git 工作区干净，父会话恢复 `no_task`。
8. 在另一个 child 和 wait 仍活动时执行 SDK shutdown，等待进程退出 `0`，并检查落盘 child 的 `turn/end=aborted`。不假设 SDK teardown 后仍转发完成通知。

PTC 只向模型公开 `run_code`，通过实际 `tools.*` 绑定执行上述操作。使用未压缩 JSONL 是为了直接核验 shutdown 的持久化事实，仍经官方持久化服务写入和恢复。

## 报告与边界

运行开始打印 `E2E artifacts:`。目录保存 `report.json`、SDK events/wire、模型协议请求、stderr、初始化/安装日志及验收项目；失败同样保存诊断证据。完整成功后报告还打印到 stdout，便于容器验收。临时目录和镜像保留供复现，SDK 进程和本地 HTTP 服务会关闭。

这是一套可重复的完整软件链路测试，模型决策由本地脚本提供，不消耗 API 额度，也不证明真实大模型能自主遵循工作流。真实模型验收需要单独确认其配置与请求预算。Web UI 的表单和启停另由插件单元测试及隔离浏览器验收覆盖；这里不自动化桌面 GUI、跨版本 HMR 或 SSH 工作区。

本轮实际通过项、Windows 默认沙箱失败和原始证据位置见 [2026-10-28 验证记录](../docs/validation-e2e-2026-10-28.md)。
