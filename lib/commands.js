/**
 * Human-facing /trellis commands: status and finish.
 *
 * Command names follow the dsh grammar (lowercase letters, digits, `_`, `-`;
 * no `:`), and deliberately avoid the skill names (`trellis-start`,
 * `trellis-continue`, `trellis-finish-work`): a command sharing a skill name
 * would shadow the skill's slash-pipeline injection. The Trellis session
 * rituals stay on the skill surface; these commands cover the deterministic,
 * zero-token side — pointer inspection and wrap-up.
 *
 * @module dsh-trellis/commands
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { findProjectRoot } from "./workflow.js";
import { nodeFs } from "./node-fs.js";
import { dshContextKey } from "./session-env.js";

const execFileAsync = promisify(execFile);

/** Platform-aware Python launch candidates. An explicit config disables fallback. */
export function pythonCandidates(config, platform = process.platform) {
  if (config.pythonCmd) return [{ command: config.pythonCmd, prefixArgs: [] }];
  if (platform === "win32") {
    return [
      { command: "py", prefixArgs: ["-3"] },
      { command: "python", prefixArgs: [] },
    ];
  }
  return [
    { command: "python3", prefixArgs: [] },
    { command: "python", prefixArgs: [] },
  ];
}

/** Run a project Trellis script with bounded time and output. */
export async function runTrellisScript(
  config,
  root,
  sessionId,
  scriptArgs,
  dependencies = {},
) {
  const execute = dependencies.execFile ?? execFileAsync;
  const platform = dependencies.platform ?? process.platform;
  const signal = dependencies.signal;
  const contextKey = dshContextKey(sessionId);
  const env = {
    ...process.env,
    ...(contextKey
      ? {
          TRELLIS_CONTEXT_ID: contextKey,
          DSH_TRELLIS_CONTEXT_ID: contextKey,
          DSH_SHELL: "1",
          DSH_SESSION_ID: sessionId,
        }
      : {}),
  };
  const script = join(root, ".trellis", "scripts", "task.py");
  const candidates = pythonCandidates(config, platform);
  for (const [index, candidate] of candidates.entries()) {
    const args = [...candidate.prefixArgs, script, ...scriptArgs];
    try {
      const { stdout, stderr } = await execute(candidate.command, args, {
        cwd: root,
        env,
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 256 * 1024,
        ...(signal ? { signal } : {}),
      });
      const text = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
      return { kind: "success", text };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") {
        return { kind: "error", text: "Trellis command cancelled." };
      }
      const missing = error?.code === "ENOENT";
      if (missing && index < candidates.length - 1) continue;
      const attempted = candidates
        .slice(0, index + 1)
        .map(({ command, prefixArgs }) => [command, ...prefixArgs].join(" "))
        .join(", ");
      const message = missing
        ? `Python command not found (tried: ${attempted}). Set the plugin's pythonCmd config to a Python 3 executable.`
        : `Trellis script failed via ${[candidate.command, ...candidate.prefixArgs].join(" ")}: ${error?.message ?? String(error)}`;
      return { kind: "error", text: message };
    }
  }
  return {
    kind: "error",
    text: "No Python command candidates are configured.",
  };
}

/**
 * Register the /trellis command family.
 * @param {object} ctx - cordis context exposing `ctx.commands`.
 * @param {object} resolved - normalized plugin config.
 * @returns {() => void} disposer.
 */
export function registerCommands(ctx, resolved, dependencies = {}) {
  const fs = dependencies.fs ?? nodeFs;
  const execute = dependencies.execFile ?? execFileAsync;
  const platform = dependencies.platform ?? process.platform;
  const disposers = [];

  const withoutInput = (invocation, fn) => {
    const rawInput = invocation.rawInput ?? "";
    const attachments = invocation.attachments ?? [];
    if (rawInput.trim() !== "" || attachments.length > 0) {
      return {
        kind: "error",
        text: "This Trellis command does not accept arguments or image attachments.",
      };
    }
    return fn();
  };

  const withProject = async (invocation, fn) => {
    const cwd = invocation.agent?.session?.header?.cwd ?? process.cwd();
    const root = await findProjectRoot(cwd, resolved.projectRootMarkers, fs);
    if (root === null) {
      return {
        kind: "error",
        text: "No project root found from the configured markers.",
      };
    }
    const workflow = join(root, ".trellis", "workflow.md");
    const taskScript = join(root, ".trellis", "scripts", "task.py");
    if (!(await fs.exists(workflow)) || !(await fs.exists(taskScript))) {
      return {
        kind: "error",
        text: "No Trellis project found (expected .trellis/workflow.md and .trellis/scripts/task.py).",
      };
    }
    const sessionId = invocation.agent?.session?.header?.id ?? "";
    return fn(root, sessionId, invocation.signal);
  };

  disposers.push(
    ctx.commands.register({
      name: "trellis-status",
      description: "Show the Trellis active task and git status.",
      // DSH rc.8 records command lifecycle events. These commands have no
      // payload of their own, so omit empty/invalid input from the durable log.
      recordInput: false,
      handler: (invocation) =>
        withoutInput(invocation, () =>
          withProject(invocation, async (root, sessionId, signal) => {
            const task = await runTrellisScript(
              resolved,
              root,
              sessionId,
              ["current", "--source"],
              { execFile: execute, platform, signal },
            );
            if (signal?.aborted) return task;
            let git = "";
            try {
              const { stdout } = await execute(
                "git",
                ["status", "--short", "--branch"],
                {
                  cwd: root,
                  windowsHide: true,
                  timeout: 10_000,
                  maxBuffer: 128 * 1024,
                  ...(signal ? { signal } : {}),
                },
              );
              git = `\n\nGit status:\n${stdout.trim()}`;
            } catch {
              git = "";
            }
            const hint =
              task.kind === "success"
                ? `\n\nSession rituals: type /trellis-start (start), /trellis-continue (resume), /trellis-finish-work (skill wrap-up).`
                : "";
            return { kind: task.kind, text: `${task.text}${git}${hint}` };
          }),
        ),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: "trellis-finish",
      description:
        "Inspect the active task and print the safe wrap-up checklist.",
      recordInput: false,
      handler: (invocation) =>
        withoutInput(invocation, () =>
          withProject(invocation, async (root, sessionId, signal) => {
            const result = await runTrellisScript(
              resolved,
              root,
              sessionId,
              ["current", "--source"],
              { execFile: execute, platform, signal },
            );
            if (signal?.aborted) return result;
            const checklist =
              'Wrap-up checklist (this command did not clear or archive anything):\n  1. Commit this task\'s changes (workflow.md Phase 3.4; do not push).\n  2. Type /trellis-finish-work so the skill can archive the task before the pointer is removed and then record the session journal.\n\nIf you must do it manually, archive first with the configured Python 3 runtime: .trellis/scripts/task.py archive <task-name>; then run .trellis/scripts/add_session.py --title "..." --commit <hash> --summary "...".';
            return { kind: result.kind, text: `${result.text}\n\n${checklist}` };
          }),
        ),
    }),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}
