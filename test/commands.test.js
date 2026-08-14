import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  pythonCandidates,
  registerCommands,
  runTrellisScript,
} from "../lib/commands.js";

const root = resolve("C:/trellis-command-test");

function projectFs({ trellis = true } = {}) {
  const paths = new Set([join(root, ".git")]);
  if (trellis) {
    paths.add(join(root, ".trellis", "workflow.md"));
    paths.add(join(root, ".trellis", "scripts", "task.py"));
  }
  return {
    async exists(path) {
      return paths.has(path);
    },
  };
}

function commandHarness() {
  const commands = new Map();
  const disposed = [];
  const ctx = {
    commands: {
      register(command) {
        commands.set(command.name, command);
        return () => disposed.push(command.name);
      },
    },
  };
  return { ctx, commands, disposed };
}

const resolved = {
  pythonCmd: "python-test",
  projectRootMarkers: [".git"],
};

const invocation = {
  agent: { session: { header: { cwd: join(root, "src"), id: "session one" } } },
  signal: new AbortController().signal,
};

test("pythonCandidates uses platform-aware defaults and honors an override", () => {
  assert.deepEqual(pythonCandidates({ pythonCmd: "" }, "win32"), [
    { command: "py", prefixArgs: ["-3"] },
    { command: "python", prefixArgs: [] },
  ]);
  assert.deepEqual(pythonCandidates({ pythonCmd: "" }, "linux"), [
    { command: "python3", prefixArgs: [] },
    { command: "python", prefixArgs: [] },
  ]);
  assert.deepEqual(pythonCandidates({ pythonCmd: "custom-python" }, "win32"), [
    { command: "custom-python", prefixArgs: [] },
  ]);
});

test("runTrellisScript falls back after a missing Windows launcher and exports the session id", async () => {
  const previousOuterContext = process.env.TRELLIS_CONTEXT_ID;
  process.env.TRELLIS_CONTEXT_ID = "claude_outer-session";
  const calls = [];
  try {
    const result = await runTrellisScript(
      { pythonCmd: "" },
      root,
      "abc def",
      ["current", "--source"],
      {
        platform: "win32",
        async execFile(command, args, options) {
          calls.push({ command, args, options });
          if (command === "py")
            throw Object.assign(new Error("missing"), { code: "ENOENT" });
          return { stdout: "Current task: demo\n", stderr: "" };
        },
      },
    );

    assert.equal(result.kind, "success");
    assert.deepEqual(
      calls.map(({ command }) => command),
      ["py", "python"],
    );
    assert.deepEqual(calls[0].args.slice(0, 2), [
      "-3",
      join(root, ".trellis", "scripts", "task.py"),
    ]);
    assert.equal(calls[1].options.env.DSH_SESSION_ID, "abc def");
    assert.equal(calls[1].options.env.DSH_SHELL, "1");
    assert.equal(calls[1].options.env.TRELLIS_CONTEXT_ID, "dsh_abc_def");
    assert.equal(
      calls[1].options.env.DSH_TRELLIS_CONTEXT_ID,
      "dsh_abc_def",
    );
  } finally {
    if (previousOuterContext === undefined) {
      delete process.env.TRELLIS_CONTEXT_ID;
    } else {
      process.env.TRELLIS_CONTEXT_ID = previousOuterContext;
    }
  }
});

test("trellis-finish is read-only and command disposal unregisters both commands", async () => {
  const { ctx, commands, disposed } = commandHarness();
  const calls = [];
  const dispose = registerCommands(ctx, resolved, {
    fs: projectFs(),
    platform: "win32",
    async execFile(command, args, options) {
      calls.push({ command, args, options });
      return { stdout: "Current task: .trellis/tasks/demo\n", stderr: "" };
    },
  });

  const result = await commands.get("trellis-finish").handler(invocation);
  assert.equal(result.kind, "success");
  assert.match(result.text, /did not clear or archive anything/);
  assert.deepEqual(calls[0].args.slice(-2), ["current", "--source"]);
  assert.equal(calls[0].options.env.DSH_SESSION_ID, "session one");
  assert.equal(calls[0].options.env.DSH_SHELL, "1");
  assert.equal(calls[0].options.signal, invocation.signal);
  assert.ok(!calls[0].args.includes("finish"));

  dispose();
  assert.deepEqual(disposed.sort(), ["trellis-finish", "trellis-status"]);
});

test("an aborted native command signal cancels execution without Python fallback", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls = [];
  const result = await runTrellisScript(
    { pythonCmd: "" },
    root,
    "session",
    ["current"],
    {
      platform: "win32",
      signal: controller.signal,
      async execFile(command) {
        calls.push(command);
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      },
    },
  );

  assert.deepEqual(result, {
    kind: "error",
    text: "Trellis command cancelled.",
  });
  assert.deepEqual(calls, ["py"]);
});

test("commands reject a git repository that is not initialized for Trellis", async () => {
  const { ctx, commands } = commandHarness();
  let executed = false;
  registerCommands(ctx, resolved, {
    fs: projectFs({ trellis: false }),
    async execFile() {
      executed = true;
      return { stdout: "", stderr: "" };
    },
  });

  const result = await commands.get("trellis-status").handler(invocation);
  assert.equal(result.kind, "error");
  assert.match(result.text, /No Trellis project found/);
  assert.equal(executed, false);
});
