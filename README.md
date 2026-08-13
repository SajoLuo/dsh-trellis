# dsh-trellis

DeepSeek Harness (dsh) host 插件：把 [Trellis](https://github.com/mindfold-ai/Trellis) 工作流带进 dsh，补齐 Codex 级体验的三块机制：

1. **每轮 workflow-state 面包屑注入** — 在每个 `agent/pre-step`，解析项目 `.trellis/workflow.md` 的 `[workflow-state:*]` 块 + 活跃任务状态（no_task / planning / in_progress），把对应面包屑注入会话（与 `dsh-agent-instructions` 的注入管道相同）。未变化不重复注入；被压缩后自动重注入；提示词里出现独立单词 `no-trellis` 可跳过当轮。
2. **会话上下文身份** — 注册 `DSH_TRELLIS_CONTEXT_ID`（`dsh_<session-id>`）到每个 agent shell，配合 Trellis 上游补丁，让 `task.py start/create/current` 解析到会话级 active-task 指针。
3. **`/trellis:*` 命令** — `/trellis:start`、`/trellis:continue`、`/trellis:finish-work`，直接运行项目脚本并展示结果（命令输出不进模型历史）。

非 Trellis 项目（无 `.git` 祖先含 `.trellis/workflow.md`）自动静默，零开销。

## 安装

```powershell
# 装进 web profile（下次启动 dsh web 生效）
dsh plugin --profile web add file:C:/path/to/dsh-trellis

# headless 同理（立即生效）
dsh plugin --profile headless add file:C:/path/to/dsh-trellis
```

配套要求：项目的 Trellis 平台需包含 dsh（`trellis init --dsh`，见 Trellis-DeepSeekHarness 适配分支），且 `.trellis/scripts` 需包含读取 `DSH_TRELLIS_CONTEXT_ID` 的补丁（已含在同一适配分支）。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖（整行替换）：

```yaml
- id: dsh-trellis
  config:
    maxBytes: 4096          # 面包屑注入的字节预算（0 = 关闭注入）
    skipKeyword: no-trellis # 提示词中的独立单词可跳过当轮注入（空 = 禁用）
    pythonCmd: python       # /trellis 命令用的 Python（Windows: python）
    commandsEnabled: true
    sessionEnvEnabled: true
```

## 工作原理

- **状态解析**（`lib/workflow.js`）：向上找 `.git` 项目根 → 读 `.trellis/workflow.md` 解析状态块 → 活跃任务判定：先看会话指针 `.trellis/.runtime/sessions/dsh_<id>.json`，再全局扫描 `tasks/*/task.json`（in_progress 优先于 planning，按 mtime）。
- **注入去重**：面包屑带 digest，与最近一次注入相同且仍在可见表面则不重复注入。
- **会话身份**：`DSH_TRELLIS_CONTEXT_ID = dsh_<session.header.id>`（sanitize 规则与 task.py 一致），主会话与子代理 shell 都能拿到（子代理拿自己的 id，指针解析按会话隔离，prelude 回退到派发 prompt 里的 `Active task:` 行）。

## 开发

```powershell
pnpm install
pnpm test    # node --test test/*.test.js
```

无构建步骤：纯 ESM JavaScript，`main` 直接指向 `lib/index.js`。
