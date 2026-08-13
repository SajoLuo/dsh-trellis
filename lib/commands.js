/**
 * Human-facing /trellis commands: session-start, continue, and finish-work.
 *
 * Handlers run the project's Trellis Python scripts directly and return
 * human-visible text; command output never enters model history.
 *
 * @module dsh-trellis/commands
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { findProjectRoot, sanitizeContextKey } from "./workflow.js";
import { nodeFs } from "./node-fs.js";

const execFileAsync = promisify(execFile);

/** Run a project Trellis script with bounded time and output. */
async function runTrellisScript(config, root, sessionId, scriptArgs) {
  const env = {
    ...process.env,
    DSH_TRELLIS_CONTEXT_ID: `dsh_${sanitizeContextKey(sessionId ?? "")}`,
  };
  const args = [join(root, ".trellis", "scripts", "task.py"), ...scriptArgs];
  try {
    const { stdout, stderr } = await execFileAsync(config.pythonCmd, args, {
      cwd: root,
      env,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 256 * 1024,
    });
    const text = `${stdout}${stderr ? `\n${stderr}` : ""}`.trim();
    return { kind: "success", text };
  } catch (error) {
    const message =
      error.code === "ENOENT"
        ? `python command not found (${config.pythonCmd}). Set the plugin's pythonCmd config.`
        : `Trellis script failed: ${error.message}`;
    return { kind: "error", text: message };
  }
}

/**
 * Register the /trellis command family.
 * @param {object} ctx - cordis context exposing `ctx.commands`.
 * @param {object} resolved - normalized plugin config.
 * @returns {() => void} disposer.
 */
export function registerCommands(ctx, resolved) {
  const active = new Set();
  const disposers = [];
  const track = (operation) => {
    active.add(operation);
    operation.then(
      () => active.delete(operation),
      () => active.delete(operation),
    );
    return operation;
  };

  const withProject = async (invocation, fn) => {
    const cwd = invocation.agent?.session?.header?.cwd ?? process.cwd();
    const root = await findProjectRoot(cwd, resolved.projectRootMarkers, nodeFs);
    if (root === null) {
      return { kind: "error", text: "No Trellis project found (no .git ancestor with .trellis/workflow.md)." };
    }
    const sessionId = invocation.agent?.session?.header?.id ?? "";
    return fn(root, sessionId);
  };

  disposers.push(
    ctx.commands.register({
      name: "trellis:start",
      description: "Show the Trellis active task and get a session start orientation.",
      handler: (invocation) =>
        track(
          withProject(invocation, async (root, sessionId) => {
            const result = await runTrellisScript(resolved, root, sessionId, ["current", "--source"]);
            const text =
              result.kind === "success"
                ? `${result.text}\n\nFor the full workflow overview, type /trellis-start (skill).`
                : result.text;
            return { kind: result.kind, text };
          }),
        ),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: "trellis:continue",
      description: "Resume the Trellis workflow: active task, git status, and the continue skill.",
      handler: (invocation) =>
        track(
          withProject(invocation, async (root, sessionId) => {
            const task = await runTrellisScript(resolved, root, sessionId, ["current", "--source"]);
            let git = "";
            try {
              const { stdout } = await execFileAsync("git", ["status", "--short", "--branch"], {
                cwd: root,
                windowsHide: true,
                timeout: 10_000,
                maxBuffer: 128 * 1024,
              });
              git = `\n\nGit status:\n${stdout.trim()}`;
            } catch {
              git = "";
            }
            const text = `${task.kind === "success" ? task.text : task.text}${git}\n\nFor step-level guidance, type /trellis-continue (skill).`;
            return { kind: task.kind, text };
          }),
        ),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: "trellis:finish-work",
      description: "Wrap up the Trellis session: clear the active-task pointer and print the closing checklist.",
      handler: (invocation) =>
        track(
          withProject(invocation, async (root, sessionId) => {
            const result = await runTrellisScript(resolved, root, sessionId, ["finish"]);
            const checklist =
              "Wrap-up checklist:\n  1. Commit this task's changes (workflow.md Phase 3.4; do not push).\n  2. Archive the task: python .trellis/scripts/task.py archive <task-name>\n  3. Record the session: python .trellis/scripts/add_session.py --title \"...\" --commit <hash> --summary \"...\"";
            return {
              kind: result.kind,
              text: `${result.text}\n\n${checklist}`,
            };
          }),
        ),
    }),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}
