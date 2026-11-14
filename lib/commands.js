/**
 * Human-facing /trellis commands: status, finish, and template doctor.
 *
 * Command names follow the dsh grammar (lowercase letters, digits, `_`, `-`;
 * no `:`), and deliberately avoid the skill names (`trellis-start`,
 * `trellis-continue`, `trellis-finish-work`): a command sharing a skill name
 * would shadow the skill's slash-pipeline injection. The Trellis session
 * rituals stay on the skill surface; these commands cover the deterministic,
 * zero-token side — pointer inspection, wrap-up, and project template doctor.
 *
 * @module dsh-trellis/commands
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { runTrellisDoctor } from "./doctor.js";
import { findProjectRoot } from "./workflow.js";
import { nodeFs } from "./node-fs.js";
import { dshContextKey } from "./session-env.js";
import { resolveWorkingDirectory } from "./working-directory.js";

const execFileAsync = promisify(execFile);

const SECRET_ENV_NAMES = new Set([
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "NPM_TOKEN",
]);
const SECRET_ENV_SUFFIX_RE = /(_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/i;
const MISSING_PYTHON_STDERR_RE =
  /No Installed Pythons|No suitable Python runtime|Python was not found/i;

function scrubbedParentEnv(source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      SECRET_ENV_NAMES.has(key.toUpperCase()) ||
      SECRET_ENV_SUFFIX_RE.test(key)
    ) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

function isMissingPythonError(error) {
  if (
    error?.code === "ENOENT" ||
    error?.code === "EINVAL" ||
    error?.code === 9009 ||
    error?.code === 103
  ) {
    return true;
  }
  const detail = `${error?.stderr ?? ""}\n${error?.stdout ?? ""}\n${error?.message ?? ""}`;
  return MISSING_PYTHON_STDERR_RE.test(detail);
}

/** Platform-aware Python launch candidates. An explicit config disables fallback. */
export function pythonCandidates(config, platform = process.platform) {
  if (config.pythonCmd) return [{ command: config.pythonCmd, prefixArgs: [] }];
  if (platform === "win32") {
    return [
      { command: "py", prefixArgs: ["-3"] },
      { command: "python", prefixArgs: [] },
      { command: "python3", prefixArgs: [] },
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
  const allowNoCurrentTask = dependencies.allowNoCurrentTask === true;
  const contextKey = dshContextKey(sessionId);
  const env = scrubbedParentEnv(process.env);
  if (contextKey) {
    env.TRELLIS_CONTEXT_ID = contextKey;
    env.DSH_TRELLIS_CONTEXT_ID = contextKey;
    env.DSH_SHELL = "1";
    env.DSH_SESSION_ID = sessionId;
  } else {
    delete env.TRELLIS_CONTEXT_ID;
    delete env.DSH_TRELLIS_CONTEXT_ID;
    delete env.DSH_SHELL;
    delete env.DSH_SESSION_ID;
  }
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
      const stdout = String(error?.stdout ?? "");
      if (
        allowNoCurrentTask &&
        error?.code === 1 &&
        stdout.trimStart().startsWith("Current task:")
      ) {
        const stderr = String(error?.stderr ?? "").trim();
        const text = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
        return { kind: "success", text };
      }
      const missing = isMissingPythonError(error);
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
    let cwd;
    try {
      cwd = await resolveWorkingDirectory(ctx, invocation.agent, invocation.signal);
    } catch (error) {
      return {
        kind: "error",
        text: invocation.signal?.aborted
          ? "Trellis command cancelled."
          : `Cannot resolve the current DSH working directory: ${error?.message ?? String(error)}`,
      };
    }
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
              { execFile: execute, platform, signal, allowNoCurrentTask: true },
            );
            if (signal?.aborted) {
              return { kind: "error", text: "Trellis command cancelled." };
            }
            let git = "";
            try {
              const { stdout } = await execute(
                "git",
                ["status", "--short", "--branch"],
                {
                  cwd: root,
                  env: scrubbedParentEnv(process.env),
                  windowsHide: true,
                  timeout: 10_000,
                  maxBuffer: 128 * 1024,
                  ...(signal ? { signal } : {}),
                },
              );
              if (signal?.aborted) {
                return { kind: "error", text: "Trellis command cancelled." };
              }
              git = `\n\nGit status:\n${stdout.trim()}`;
            } catch (error) {
              if (signal?.aborted || error?.name === "AbortError") {
                return { kind: "error", text: "Trellis command cancelled." };
              }
              git = "\n\nGit status:\n(unavailable)";
            }
            const noTask = /(?:Current|Active) task:\s*\(none\)/i.test(
              task.text,
            );
            const hint =
              task.kind === "success"
                ? noTask
                  ? `\n\nNo active task. Session rituals: type /trellis-start (start), /trellis-continue (resume), /trellis-finish-work (skill wrap-up).`
                  : `\n\nSession rituals: type /trellis-start (start), /trellis-continue (resume), /trellis-finish-work (skill wrap-up).`
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
              { execFile: execute, platform, signal, allowNoCurrentTask: true },
            );
            if (signal?.aborted) {
              return { kind: "error", text: "Trellis command cancelled." };
            }
            if (result.kind !== "success") return result;
            const checklist =
              'Wrap-up checklist (this command did not clear or archive anything):\n  1. Commit this task\'s changes (workflow.md Phase 3.4; do not push).\n  2. Type /trellis-finish-work so the skill can archive the task before the pointer is removed and then record the session journal.\n\nIf you must do it manually, archive first with the configured Python 3 runtime: .trellis/scripts/task.py archive <task-name>; then run .trellis/scripts/add_session.py --title "..." --commit <hash> --summary "...". (If archival rejects an existing base branch without a task branch, re-run with --skip-branch-validation.)';
            return { kind: result.kind, text: `${result.text}\n\n${checklist}` };
          }),
        ),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: "trellis-doctor",
      description:
        "Check or repair project Trellis DSH templates (--check | --fix).",
      recordInput: false,
      handler: (invocation) => {
        const attachments = invocation.attachments ?? [];
        if (attachments.length > 0) {
          return {
            kind: "error",
            text: "This Trellis command does not accept image attachments.",
          };
        }
        const arg = (invocation.rawInput ?? "").trim();
        let fix = false;
        if (arg === "--fix") {
          fix = true;
        } else if (arg !== "" && arg !== "--check") {
          return {
            kind: "error",
            text: "Usage: /trellis-doctor [--check | --fix]",
          };
        }
        return withProject(invocation, async (root, _sessionId, signal) => {
          const res = await runTrellisDoctor(root, { fs, fix, signal });
          return { kind: res.kind, text: res.text };
        });
      },
    }),
  );

  return () => {
    let hasError = false;
    let firstError;
    for (const dispose of disposers) {
      try {
        dispose();
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
        }
      }
    }
    if (hasError) throw firstError;
  };
}
