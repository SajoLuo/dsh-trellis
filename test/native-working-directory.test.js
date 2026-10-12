import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { agentRuntime } from "./helpers/agent-runtime.js";
import { hasWorkingDirectory } from "./helpers/working-directory-runtime.js";
import { createBreadcrumbComposer } from "../lib/breadcrumb.js";
import { registerCommands } from "../lib/commands.js";
import { resolveConfig } from "../lib/config.js";

test("real alpha directory changes survive replay/fork and retain original-project identity", {
  skip: !hasWorkingDirectory, timeout: 10_000,
}, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "trellis-native-directory-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const roots = [join(dir, "A"), join(dir, "B")];
  for (const [index, root] of roots.entries()) {
    await mkdir(join(root, ".trellis", "scripts"), { recursive: true });
    await writeFile(join(root, ".trellis", "workflow.md"), `[workflow-state:no_task]\nNative project ${index}\n[/workflow-state:no_task]\n`);
    await writeFile(join(root, ".trellis", "scripts", "task.py"), "# fixture\n");
  }
  const ctx = await agentRuntime(t);
  const agent = await ctx.agentLoop.create("directory-parent", { provider: "unused", model: "unused" }, { cwd: roots[0] });
  const config = resolveConfig({ projectRootMarkers: [".trellis"], pythonCmd: "fixture" });
  const { compose } = createBreadcrumbComposer(config, ctx);
  const commands = new Map();
  const calls = [];
  ctx.provide("commands", { register(value) { commands.set(value.name, value); return () => {}; } });
  t.after(registerCommands(ctx, config, { async execFile(command, args, options) {
    calls.push({ command, args, options });
    return { stdout: "no task", stderr: "" };
  } }));
  for (const index of [0, 1, 0, 1]) {
    await ctx.workingDirectory.set(agent, roots[index]);
    assert.match((await compose(agent, [])).content[0].text, new RegExp(`Native project ${index}`));
    for (const name of ["trellis-status", "trellis-finish"]) {
      const start = calls.length;
      assert.equal((await commands.get(name).handler({ agent })).kind, "success");
      assert.equal(calls[start].options.cwd, roots[index]);
      assert.equal(calls[start].options.env.DSH_TRELLIS_CONTEXT_ID, "dsh_directory-parent");
    }
    assert.equal(agent.session.header.cwd, roots[0]);
  }
  const restored = ctx.sessions.create("directory-restored", {
    seed: agent.session.snapshotEvents(), meta: { cwd: roots[0] },
  });
  const forked = ctx.sessions.fork(agent.session);
  assert.equal(ctx.workingDirectory.get(restored), roots[1]);
  assert.equal(ctx.workingDirectory.get(forked), roots[1]);
  assert.equal(restored.header.cwd, roots[0]);
  assert.equal(forked.header.cwd, roots[0]);
  // Remove only the explicitly created empty/fixture B tree. Native ensure
  // restores A, and both plugin surfaces must consume that recovery result.
  await rm(roots[1], { recursive: true, force: true });
  assert.match((await compose(agent, [])).content[0].text, /Native project 0/);
  assert.equal(ctx.workingDirectory.get(agent.session), roots[0]);
  const start = calls.length;
  await commands.get("trellis-status").handler({ agent });
  assert.equal(calls[start].options.cwd, roots[0]);
});
