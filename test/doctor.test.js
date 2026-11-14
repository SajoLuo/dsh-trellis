import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { registerCommands } from "../lib/commands.js";
import { runTrellisDoctor } from "../lib/doctor.js";
import { resolveConfig } from "../lib/config.js";
import { parseWorkflowStateBlocks } from "../lib/workflow.js";

const BETA4_DSH_MD = `# Trellis on DeepSeek Harness (dsh)

dsh is a **class-2 pull-based** Trellis host. It discovers Trellis skills from
the project, uses native continuable sub-agents for isolated implementation and
review roles, and exposes a stable \`DSH_SESSION_ID\` to every managed shell.

| Capability | Without companion plugin | With \`dsh-trellis\` |
| --- | --- | --- |
| Shared and entry skills | Works | Works |
| Session-scoped active task | Works through verified \`DSH_SHELL=1\` + \`DSH_SESSION_ID\`, including nested launches | Managed per-execution identity can forward a distinct child session |
| Implement/check/research roles | Foreground native sub-agent | Background native sub-agent |
| Per-turn workflow breadcrumb | Not available | Injected from \`workflow.md\` |
| Event-driven child wait | Not available | \`trellis_wait\` |
| Utility commands | Not available | \`/trellis-status\`, \`/trellis-finish\` |

## Companion plugin fallback contract

The Trellis adapter does not install a DSH profile plugin. Before dispatching a
role, check whether the \`trellis_wait\` tool is available:

- If available, use DSH's default continuable background mode, continue
  independent work, then call \`trellis_wait\` once per dependent child id and
  consume each native settlement notice before entering the dependent gate.
- If unavailable, dispatch every child with \`run_in_background: false\` from the outset
  so the dependent workflow gate cannot overtake it.

Never replace either path with shell sleep, polling loops, \`job_output\`, or
repeated agent-list polling.

## Notes

- Each \`dsh --profile headless\` invocation creates a fresh DSH session. Do not
  expect an active-task pointer to persist across separate headless calls; keep
  the workflow in one session or explicitly resume its returned session id.
`;

function beta4ResearchSkill(pythonCmd = "python") {
  return `---
name: trellis-agent-research
user-invocable: false
---
# Research Agent

### Step 1: Resolve Current Task

Run \`${pythonCmd} ./.trellis/scripts/task.py current --source\` to get the active task path. Prefer an \`Active task: <path>\` line in the dispatch prompt when present. If no active task is set, ask the user where to write output; do NOT guess.

Ensure \`{TASK_DIR}/research/\` exists before writing findings.
`;
}

const BETA4_WORKFLOW_MD = `# Trellis Workflow Guide

Sub-agent dispatch protocol applies to all platforms and all sub-agents, including native Codex \`SubagentStart\` context injection with child-side pull fallback, class-2 Gemini/Qoder/Copilot/Reasonix/Trae/Grok/Kimi Code/DeepSeek Harness, hook-backed ZCode/Snow, and \`trellis-research\`: every dispatch prompt starts with \`Active task: <task path from task.py current>\` before role-specific instructions. On Grok Build, use \`spawn_subagent\` with \`subagent_type\` set to the Trellis agent name (e.g. \`trellis-implement\`). On Kimi Code, dispatch the built-in \`coder\` / \`explore\` sub-agent with the matching \`.kimi-code/skills/trellis-<role>/SKILL.md\` instructions. On DeepSeek Harness, tell the child to load the matching \`.dsh/skills/trellis-agent-<role>/SKILL.md\` exactly once, then choose the synchronization path by capability. If the optional companion plugin exposes \`trellis_wait\`, dispatch \`subagent\` in its default continuable background mode, continue independent work, and call \`trellis_wait\` once per dependent child id when a dependent gate is next; each call returns only after DSH has queued that child's native settlement notice. Without \`trellis_wait\`, dispatch each child with \`run_in_background: false\` from the outset so no dependent gate can overtake it. Never simulate waiting with shell sleep, polling loops, \`job_output\`, repeated \`list_agents\`, or another long-running command, and never leave a background child without an event-driven wait path.

[workflow-state:in_progress]
Tools: \`trellis-implement\` / \`trellis-research\` name sub-agent roles dispatched through your platform's sub-agent mechanism, not skills the main session loads itself (on Claude Code: use the Task/Agent tool, never the Skill tool). \`trellis-update-spec\` is a skill. \`trellis-check\` exists as both; prefer the Agent/role form when verifying after code changes.
On DeepSeek Harness, role instructions ship as collision-free \`trellis-agent-implement\` / \`trellis-agent-check\` / \`trellis-agent-research\` skills under \`.dsh/skills/\`. The main session must not load them itself: tell the child to load the matching role skill exactly once. If \`trellis_wait\` is available, use the default background mode, do independent work, then call \`trellis_wait\` once per dependent child id and consume each native settlement notice before entering the dependent gate. If it is unavailable, dispatch every child with \`run_in_background: false\` from the outset. Do not poll, sleep, or start a background child without an event-driven wait path.
Flow: \`trellis-implement\` -> \`trellis-check\` -> \`trellis-update-spec\` -> commit (Phase 3.4) -> \`/trellis:finish-work\`.
Main-session default: dispatch implement/check sub-agents. Sub-agent self-exemption: if already running as \`trellis-implement\`, do NOT spawn another \`trellis-implement\` or \`trellis-check\`; if already running as \`trellis-check\`, do NOT spawn another \`trellis-check\` or \`trellis-implement\`. Dispatch is main session only.
Dispatch prompt starts with \`Active task: <task path from task.py current>\`. Read context: jsonl entries -> \`prd.md\` -> \`design.md if present\` -> \`implement.md if present\`.
[/workflow-state:in_progress]

## Phase 1
- **DeepSeek Harness**: tell the child to load \`trellis-agent-research\` exactly once. If \`trellis_wait\` is available, use the default continuable background mode, dispatch independent questions concurrently when useful, continue unrelated work, then call \`trellis_wait\` once per child id and consume each settlement notice before advancing. Without \`trellis_wait\`, dispatch each required child with \`run_in_background: false\`; do not poll or sleep.

## Phase 2.1
- **DeepSeek Harness**: tell the child to load \`trellis-agent-implement\` exactly once. If \`trellis_wait\` is available, use the default background mode, continue independent work, then wait once for that child id and consume its successful native settlement notice before Phase 2.2. Without \`trellis_wait\`, dispatch that child with \`run_in_background: false\`. Do not poll or sleep.

## Phase 2.2
- **DeepSeek Harness**: tell the child to load \`trellis-agent-check\` exactly once. If \`trellis_wait\` is available, use the default background mode, continue independent work, then wait once for that child id and consume its successful native settlement notice before Phase 3. Without \`trellis_wait\`, dispatch that child with \`run_in_background: false\`. Do not poll or sleep.
`;

const BETA4_CLI_ADAPTER = `        elif self.platform == "dsh":
            return ["dsh", "--profile", "tui", "--resume", session_id]
        else:
            return ["claude", "--resume", session_id]
`;

const BETA4_META_SKILL = `- Platform directories: \`.claude/\`, \`.dsh/\`. DeepSeek Harness keeps shared workflow skills under \`.agents/skills/\` and DSH-private commands plus \`trellis-agent-*\` role skills under \`.dsh/skills/\`; with the optional \`dsh-trellis\` plugin its continuable subagents use event-driven settlement waits, otherwise required children are dispatched in the foreground from the start.`;

const BETA4_META_AGENTS = `| DeepSeek Harness | \`.dsh/skills/trellis-agent-*/SKILL.md\` (role prompts as child-only skills; optional \`trellis_wait\` enables continuable background settlement; without it, dispatch every child with \`run_in_background: false\` from the outset) |`;

const BETA4_META_PLATFORM_MAP = `| DeepSeek Harness | \`--dsh\` | \`.dsh/\` | \`.agents/skills/\` (shared) + \`.dsh/skills/\` | None — role prompts are collision-free \`trellis-agent-*\` skills under \`.dsh/skills/\` | None installed by Trellis (pull-based roles; optional \`dsh-trellis\` adds event-driven wait, otherwise foreground dispatch) |`;

async function writeTree(root, entries) {
  for (const [rel, content] of Object.entries(entries)) {
    const full = join(root, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
}

async function seedBeta4Project(root, { pythonCmd = "python", eol = "\n" } = {}) {
  const applyEol = (s) => (eol === "\r\n" ? s.replace(/\r?\n/g, "\r\n") : s);
  await writeTree(root, {
    ".dsh/DSH.md": applyEol(BETA4_DSH_MD),
    ".dsh/skills/trellis-agent-implement/SKILL.md": applyEol("---\nname: trellis-agent-implement\n---\n"),
    ".dsh/skills/trellis-agent-research/SKILL.md": applyEol(beta4ResearchSkill(pythonCmd)),
    ".trellis/workflow.md": applyEol(BETA4_WORKFLOW_MD),
    ".trellis/scripts/task.py": applyEol("# task script placeholder\n"),
    ".trellis/scripts/common/active_task.py": applyEol("# DSH_TRELLIS_CONTEXT_ID support\n"),
    ".trellis/scripts/common/cli_adapter.py": applyEol(BETA4_CLI_ADAPTER),
    ".agents/skills/trellis-meta/SKILL.md": applyEol(BETA4_META_SKILL),
    ".agents/skills/trellis-meta/references/platform-files/agents.md": applyEol(BETA4_META_AGENTS),
    ".agents/skills/trellis-meta/references/platform-files/platform-map.md": applyEol(BETA4_META_PLATFORM_MAP),
  });
}

test("trellis-doctor --check detects beta.4 drift without writing and --fix repairs idempotently while preserving CRLF", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-trellis-doctor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await seedBeta4Project(root, { pythonCmd: "py -3", eol: "\r\n" });

  const beforeGuide = await readFile(join(root, ".dsh/DSH.md"), "utf8");
  const checkRes = await runTrellisDoctor(root, { fix: false });
  assert.equal(checkRes.kind, "success");
  assert.deepEqual(checkRes.summary, {
    ok: 0,
    drift: 7,
    fixed: 0,
    warn: 0,
    skip: 0,
  });
  assert.match(checkRes.text, /Run \/trellis-doctor --fix/);
  assert.equal(await readFile(join(root, ".dsh/DSH.md"), "utf8"), beforeGuide);

  const fixRes = await runTrellisDoctor(root, { fix: true });
  assert.equal(fixRes.kind, "success");
  assert.deepEqual(fixRes.summary, {
    ok: 0,
    drift: 0,
    fixed: 7,
    warn: 0,
    skip: 0,
  });
  assert.match(fixRes.text, /Updated 7 DSH template file\(s\)/);

  const repairedGuide = await readFile(join(root, ".dsh/DSH.md"), "utf8");
  assert.ok(repairedGuide.includes("\r\n"), "CRLF line endings should be preserved");
  assert.ok(!/[^\r]\n/.test(repairedGuide), "must not mix bare LF into CRLF file");
  assert.match(repairedGuide, /\/trellis-doctor/);
  assert.match(repairedGuide, /DSH 0\.2\.1-alpha\.2\+/);
  assert.match(repairedGuide, /subagent `name`/);
  assert.match(repairedGuide, /--session-id <id>/);

  const repairedResearch = await readFile(join(root, ".dsh/skills/trellis-agent-research/SKILL.md"), "utf8");
  assert.match(repairedResearch, /Check the dispatch prompt first/);
  assert.match(repairedResearch, /py -3 \.\/\.trellis\/scripts\/task\.py current --source/);

  const repairedWorkflow = await readFile(join(root, ".trellis/workflow.md"), "utf8");
  assert.ok(repairedWorkflow.includes("\r\n"));
  assert.ok(!/dispatch .* with `run_in_background: false`/i.test(repairedWorkflow));
  assert.match(repairedWorkflow, /# Trellis Workflow Guide/);
  assert.match(repairedWorkflow, /On Grok Build, use `spawn_subagent`/);
  const blocks = parseWorkflowStateBlocks(repairedWorkflow.replace(/\r\n/g, "\n"));
  const inProgress = blocks.get("in_progress");
  assert.ok(inProgress, "in_progress block must remain parseable");
  assert.ok(Buffer.byteLength(inProgress, "utf8") < 4096, "in_progress block must fit default maxBytes");
  assert.match(inProgress, /subagentId/);

  const repairedAdapter = await readFile(join(root, ".trellis/scripts/common/cli_adapter.py"), "utf8");
  assert.match(repairedAdapter, /\["dsh", "--profile", "headless", "--session-id", session_id\]/);
  assert.match(repairedAdapter, /\["claude", "--resume", session_id\]/);

  // Idempotent second fix & check
  const fixAgain = await runTrellisDoctor(root, { fix: true });
  assert.deepEqual(fixAgain.summary, {
    ok: 7,
    drift: 0,
    fixed: 0,
    warn: 0,
    skip: 0,
  });
  assert.match(fixAgain.text, /All checked Trellis DSH templates are up to date\./);

  const checkAgain = await runTrellisDoctor(root, { fix: false });
  assert.deepEqual(checkAgain.summary, {
    ok: 7,
    drift: 0,
    fixed: 0,
    warn: 0,
    skip: 0,
  });
});

test("trellis-doctor preserves LF line endings and supports python3 / python launchers", async (t) => {
  for (const pythonCmd of ["python3", "python"]) {
    const root = await mkdtemp(join(tmpdir(), "dsh-trellis-doctor-lf-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await seedBeta4Project(root, { pythonCmd, eol: "\n" });

    const res = await runTrellisDoctor(root, { fix: true });
    assert.equal(res.summary.fixed, 7);

    const skill = await readFile(join(root, ".dsh/skills/trellis-agent-research/SKILL.md"), "utf8");
    assert.ok(!skill.includes("\r\n"), "LF files must stay LF");
    assert.match(skill, new RegExp(`Otherwise run \`${pythonCmd} \\./\\.trellis/scripts/task\\.py current --source\``));

    const recheck = await runTrellisDoctor(root, { fix: false });
    assert.equal(recheck.summary.ok, 7);
    assert.equal(recheck.summary.drift, 0);
  }
});

test("trellis-doctor warns on missing .dsh templates or 0.6.17 active_task.py and leaves customized files untouched", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-trellis-doctor-warn-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeTree(root, {
    ".trellis/workflow.md": "# Custom workflow without standard DSH blocks\n",
    ".trellis/scripts/task.py": "# 0.6.17 task.py\n",
    ".trellis/scripts/common/active_task.py": "# Legacy resolve without DSH context var\n",
  });

  const res = await runTrellisDoctor(root, { fix: true });
  assert.equal(res.kind, "success");
  assert.equal(res.summary.warn, 2);
  assert.equal(res.summary.skip, 1);
  assert.equal(res.summary.fixed, 0);
  assert.match(res.text, /\[warn\] \.dsh\/: missing DSH templates/);
  assert.match(res.text, /\[warn\] \.trellis\/scripts\/common\/active_task\.py: missing DSH_TRELLIS_CONTEXT_ID/);
  assert.match(res.text, /\[skip\] \.trellis\/workflow\.md: customized content left untouched/);
  assert.equal(
    await readFile(join(root, ".trellis/workflow.md"), "utf8"),
    "# Custom workflow without standard DSH blocks\n",
  );
});

test("trellis-doctor command validates arguments, attachments, working directory, aborts, and write failures", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "dsh-trellis-doctor-cmd-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await seedBeta4Project(root);

  const commands = new Map();
  const workingDirectory = {
    async ensure() {
      return root;
    },
  };
  const ctx = {
    get(name) {
      return name === "workingDirectory" ? workingDirectory : undefined;
    },
    commands: {
      register(command) {
        commands.set(command.name, command);
        return () => commands.delete(command.name);
      },
    },
  };

  const dispose = registerCommands(ctx, resolveConfig({ projectRootMarkers: [".trellis"] }));
  t.after(dispose);

  const doctor = commands.get("trellis-doctor");
  assert.ok(doctor);
  assert.equal(doctor.recordInput, false);

  const badArg = await doctor.handler({
    agent: { ctx, session: { header: { cwd: tmpdir(), id: "s1" } } },
    rawInput: " --unknown",
    attachments: [],
  });
  assert.equal(badArg.kind, "error");
  assert.match(badArg.text, /Usage: \/trellis-doctor \[--check \| --fix\]/);

  const badImg = await doctor.handler({
    agent: { ctx, session: { header: { cwd: tmpdir(), id: "s1" } } },
    rawInput: "--check",
    attachments: [{ type: "image", mimeType: "image/png", data: "abc" }],
  });
  assert.equal(badImg.kind, "error");
  assert.match(badImg.text, /does not accept image attachments/);

  const checkOut = await doctor.handler({
    agent: { ctx, session: { header: { cwd: tmpdir(), id: "s1" } } },
    rawInput: " --check ",
    attachments: [],
  });
  assert.equal(checkOut.kind, "success");
  assert.match(checkOut.text, /Found 7 outdated DSH template file\(s\)/);

  const fixOut = await doctor.handler({
    agent: { ctx, session: { header: { cwd: tmpdir(), id: "s1" } } },
    rawInput: " --fix ",
    attachments: [],
  });
  assert.equal(fixOut.kind, "success");
  assert.match(fixOut.text, /Updated 7 DSH template file\(s\)/);

  const abortController = new AbortController();
  abortController.abort();
  const aborted = await runTrellisDoctor(root, { signal: abortController.signal });
  assert.equal(aborted.kind, "error");
  assert.equal(aborted.text, "Trellis command cancelled.");

  const writeFailRoot = await mkdtemp(join(tmpdir(), "dsh-trellis-doctor-err-"));
  t.after(() => rm(writeFailRoot, { recursive: true, force: true }));
  await seedBeta4Project(writeFailRoot);
  const failingFs = {
    async exists(p) {
      try {
        await readFile(p);
        return true;
      } catch {
        return false;
      }
    },
    async readFile(p) {
      try {
        return await readFile(p, "utf8");
      } catch {
        return null;
      }
    },
    async writeFile() {
      throw new Error("EACCES: read-only filesystem");
    },
  };
  const writeErr = await runTrellisDoctor(writeFailRoot, { fs: failingFs, fix: true });
  assert.equal(writeErr.kind, "error");
  assert.match(writeErr.text, /Failed to update \.dsh\/DSH\.md: EACCES: read-only filesystem/);
});
