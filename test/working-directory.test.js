import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorkingDirectory } from "../lib/working-directory.js";
import { createBreadcrumbComposer } from "../lib/breadcrumb.js";
import { registerCommands } from "../lib/commands.js";
import { resolveConfig } from "../lib/config.js";

test("legacy directory fallback and late service attachment are resolved per invocation", async () => {
  let service;
  const ctx = { get: () => service };
  const agent = { ctx, session: { header: { cwd: tmpdir(), id: "stable" } } };
  assert.equal(await resolveWorkingDirectory(ctx, agent), tmpdir());
  service = { ensure: async () => join(tmpdir(), "changed") };
  assert.equal(await resolveWorkingDirectory(ctx, agent), join(tmpdir(), "changed"));
  service = undefined;
  assert.equal(await resolveWorkingDirectory(ctx, agent), tmpdir());
  assert.equal(await resolveWorkingDirectory(ctx), process.cwd());
});

test("agent-owned directory service and cancellation take priority over plugin context", async () => {
  const signal = new AbortController().signal;
  const agent = { ctx: { get: () => ({ async ensure(value, control) {
    assert.equal(value, agent);
    assert.equal(control, signal);
    return tmpdir();
  } }) } };
  assert.equal(await resolveWorkingDirectory({ get: () => { throw new Error("wrong owner"); } }, agent, signal), tmpdir());
  await assert.rejects(resolveWorkingDirectory({}, agent, AbortSignal.abort(new Error("cancelled"))), /cancelled/);
});

test("directory service failures and invalid responses never fall back to the header", async () => {
  const agent = { session: { header: { cwd: tmpdir() } } };
  for (const service of [{}, { ensure: async () => "relative" }, { ensure: async () => undefined }]) {
    await assert.rejects(resolveWorkingDirectory({ get: () => service }, agent), /service/);
  }
  const error = new Error("current and original directory unavailable");
  await assert.rejects(resolveWorkingDirectory({ get: () => ({ ensure: async () => { throw error; } }) }, agent), caught => caught === error);
  const controller = new AbortController();
  await assert.rejects(resolveWorkingDirectory({ get: () => ({ ensure: async () => {
    controller.abort(error);
    return tmpdir();
  } }) }, agent, controller.signal), caught => caught === error);
});

/** Real files, exact session pointers; only subprocess execution is intercepted. */
async function directoryProjects(t) {
  const parent = await mkdtemp(join(tmpdir(), "trellis-directory-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const roots = [join(parent, "A"), join(parent, "B")];
  for (const [index, root] of roots.entries()) {
    await mkdir(join(root, ".trellis", "scripts"), { recursive: true });
    await mkdir(join(root, ".trellis", ".runtime", "sessions"), { recursive: true });
    await mkdir(join(root, ".trellis", "tasks", "demo"), { recursive: true });
    await writeFile(join(root, ".trellis", "workflow.md"), `[workflow-state:in_progress]\nProject ${index}\n[/workflow-state:in_progress]\n`);
    await writeFile(join(root, ".trellis", "scripts", "task.py"), "# fixture\n");
    await writeFile(join(root, ".trellis", ".runtime", "sessions", "dsh_stable.json"), JSON.stringify({ current_task: ".trellis/tasks/demo" }));
    await writeFile(join(root, ".trellis", "tasks", "demo", "task.json"), JSON.stringify({ status: "in_progress" }));
  }
  const plain = join(parent, "plain");
  await mkdir(plain);
  return { roots, plain };
}

test("breadcrumbs and both commands follow A -> B -> A without changing native identity", async (t) => {
  const { roots, plain } = await directoryProjects(t);
  let cwd = roots[0];
  const commands = new Map();
  const ctx = {
    get: () => ({ ensure: async () => cwd }),
    commands: { register(command) { commands.set(command.name, command); return () => {}; } },
  };
  const agent = { ctx, session: { header: { cwd: roots[0], id: "stable" } } };
  const config = resolveConfig({ projectRootMarkers: [".trellis"], pythonCmd: "fixture-python" });
  const { compose } = createBreadcrumbComposer(config, ctx);
  const calls = [];
  t.after(registerCommands(ctx, config, { async execFile(command, args, options) {
    calls.push({ command, args, options });
    return { stdout: "ok", stderr: "" };
  } }));
  for (const index of [0, 1, 0]) {
    cwd = roots[index];
    const crumb = await compose(agent, []);
    assert.match(crumb.content[0].text, new RegExp(`Project ${index}`));
    assert.equal(crumb.source.task, ".trellis/tasks/demo");
    for (const name of ["trellis-status", "trellis-finish"]) {
      const start = calls.length;
      assert.equal((await commands.get(name).handler({ agent })).kind, "success");
      for (const call of calls.slice(start)) assert.equal(call.options.cwd, cwd);
      assert.equal(calls[start].options.env.DSH_TRELLIS_CONTEXT_ID, "dsh_stable");
    }
  }
  cwd = plain;
  assert.equal(await compose(agent, []), undefined);
  const count = calls.length;
  assert.equal((await commands.get("trellis-finish").handler({ agent })).kind, "error");
  assert.equal(calls.length, count);
  assert.equal(agent.session.header.cwd, roots[0]);
  assert.equal(agent.session.header.id, "stable");
});

test("commands expose directory validation failure without launching Python or git", async () => {
  const commands = new Map();
  const ctx = {
    get: () => ({ ensure: async () => { throw new Error("gone"); } }),
    commands: { register(value) { commands.set(value.name, value); return () => {}; } },
  };
  let called = false;
  const dispose = registerCommands(ctx, resolveConfig({}), { async execFile() { called = true; } });
  try {
    const result = await commands.get("trellis-status").handler({ agent: { ctx, session: { header: { cwd: tmpdir() } } } });
    assert.equal(result.kind, "error");
    assert.match(result.text, /working directory: gone/);
    assert.equal(called, false);
  } finally { dispose(); }
});
