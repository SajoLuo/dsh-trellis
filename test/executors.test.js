import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { agentRuntime } from "./helpers/agent-runtime.js";
import { registerWaitTool } from "../lib/wait-tool.js";

const splitExecutors = typeof ToolRuntime.prototype.setExecutor === "function";
const waitCall = { type: "tool-call", id: "wait", name: "trellis_wait", arguments: '{"subagent_id":"child"}' };

test("split native executor dispatches trellis_wait and fails closed when unloaded", {
  skip: !splitExecutors,
}, async (t) => {
  const ctx = await agentRuntime(t, { nativeExecutor: false });
  let lookups = 0;
  ctx.provide("subagents", { async listChildren() {
    lookups++;
    return [{ id: "child", createdAt: 123, mode: "continuable", label: "implement" }];
  } });
  t.after(registerWaitTool(ctx));
  const agent = await ctx.agentLoop.create("executor-parent", {}, { cwd: tmpdir() });
  const input = { calls: [waitCall], agent, signal: new AbortController().signal };
  const { ToolExecutorUnavailableError } = await import("@deepseek-ai/dsh-tools");
  await assert.rejects(ctx.tools.execute(input), ToolExecutorUnavailableError);
  assert.equal(lookups, 0);
  const native = await ctx.plugin(await import("@deepseek-ai/dsh-tool-executor-native"));
  const batch = await ctx.tools.execute(input);
  assert.equal(batch.results.length, 1);
  assert.equal(batch.results[0].callId, "wait");
  assert.equal(batch.results[0].result.isError, false);
  assert.match(batch.results[0].result.content[0].text, /already inactive/);
  assert.equal(lookups, 1);
  await native.dispose();
  await assert.rejects(ctx.tools.execute(input), ToolExecutorUnavailableError);
  assert.equal(lookups, 1, "unavailable execution must not retry the tool");
});

test("split PTC executor exposes the wait SDK and carries its canonical value through run_code", {
  skip: !splitExecutors,
}, async (t) => {
  const ctx = await agentRuntime(t, { nativeExecutor: false });
  const { PtcRuntime } = await import("@deepseek-ai/dsh-ptc-runtime");
  const { PtcExecutor } = await import("@deepseek-ai/dsh-tool-executor-ptc");
  let value;
  // Deterministic runtime seam: test executor/bindings, not Node confinement.
  class BindingRuntime extends PtcRuntime {
    language = "typescript";
    isolation = "test";
    resolve(request) { return request; }
    async run(request) {
      assert.equal(request.program, 'return await tools.trellis_wait({ subagent_id: "child" })');
      request.signal.throwIfAborted();
      const binding = request.bindings.find(({ global }) => global === "tools");
      value = await binding.functions.trellis_wait({ subagent_id: "child" });
      return { value, logs: [] };
    }
  }
  await ctx.plugin(BindingRuntime);
  let lookups = 0;
  ctx.provide("subagents", { async listChildren() {
    lookups++;
    return [{ id: "child", createdAt: 123, mode: "continuable", label: "implement" }];
  } });
  t.after(registerWaitTool(ctx));
  const executor = new PtcExecutor(ctx);
  t.after(ctx.tools.setExecutor(executor));
  const agent = await ctx.agentLoop.create("ptc-parent", {}, { cwd: tmpdir() });
  const definitions = ctx.tools.definitions(agent);
  const sdk = executor.sections.find(({ name }) => name === "tools:sdk").text(definitions);
  assert.match(sdk, /trellis_wait/);
  assert.match(sdk, /subagent_id/);
  assert.deepEqual(executor.describe(definitions).schemas.map(({ name }) => name), ["run_code"]);
  const input = { agent, signal: new AbortController().signal };
  const direct = await ctx.tools.execute({ ...input, calls: [waitCall] });
  assert.equal(direct.results[0].result.error.info.code, "UNKNOWN_TOOL");
  assert.equal(lookups, 0, "PTC only admits the announced transport directly");
  const batch = await ctx.tools.execute({ ...input, calls: [{
    type: "tool-call", id: "program", name: "run_code", arguments: JSON.stringify({
      code: 'return await tools.trellis_wait({ subagent_id: "child" })', description: "Wait for the child",
    }),
  }] });
  assert.equal(batch.results[0].result.isError, false);
  assert.equal(value.outcome, "unknown");
  assert.equal(value.state, "already-inactive");
  assert.equal(value.settlementNoticeQueued, false);
  assert.match(batch.results[0].result.content[0].text, /"outcome": "unknown"/);
  assert.equal(lookups, 1);
});
