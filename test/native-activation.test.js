import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";
import { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import { SessionQueryEngine } from "@deepseek-ai/dsh-session-query";
import { agentRuntime } from "./helpers/agent-runtime.js";
import { hasWorkingDirectory } from "./helpers/working-directory-runtime.js";
import { registerWaitTool } from "../lib/wait-tool.js";

class GatedAdapter extends LlmAdapter {
  entered = Promise.withResolvers();
  release = Promise.withResolvers();
  async resolveModel(provider, model) { return { provider, id: model, name: model }; }
  async *stream(options) {
    this.entered.resolve();
    await new Promise((resolve, reject) => {
      const abort = () => reject(options.signal.reason);
      options.signal.addEventListener("abort", abort, { once: true });
      this.release.promise.then(resolve, reject).finally(() => options.signal.removeEventListener("abort", abort));
      if (options.signal.aborted) abort();
    });
    if (this.failure) throw new Error("scripted provider failure");
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: "child report" };
    yield { type: "block-end", index: 0, block: { type: "text", text: "child report" } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

for (const outcome of ["completed", "aborted", "failed"]) {
  test(`real alpha caller-owned activation settles ${outcome} without promising a parent notice`, {
    skip: !hasWorkingDirectory, timeout: 10_000,
  }, async (t) => {
    const ctx = await agentRuntime(t);
    await ctx.plugin(SubagentRuntime).await();
    await ctx.plugin(SessionQueryEngine).await();
    const adapter = new GatedAdapter();
    adapter.failure = outcome === "failed";
    ctx.llm.registerAdapter(["gated"], adapter);
    const parent = await ctx.agentLoop.create(`activation-${outcome}`, { provider: "gated", model: "local" }, { cwd: tmpdir() });
    ctx.subagents.registerProvider({ name: "local-test", capabilities: { depthLimit: true },
      inheritsParentContext: false, async prepareContinuable(request) {
      assert.equal(request.cwd, tmpdir());
      return {};
    } });
    const request = { parent, prompt: [{ type: "text", text: "report" }], maxDepth: 1 };
    const activation = await ctx.subagents.startActivation({
      provider: "local-test", label: "Trellis role", delivery: "caller",
      signal: new AbortController().signal,
      ...(typeof ctx.subagents.listChildren === "function" ? { request } : request),
    });
    t.after(() => activation.dispose());
    await adapter.entered.promise;
    let tool;
    const dispose = ctx.tools.register.bind(ctx.tools);
    // Capture the exact registered definition, while keeping the real registry.
    t.after(registerWaitTool({
      tools: { register(value) { tool = value; return dispose(value); } },
      subagents: ctx.subagents, get: ctx.get.bind(ctx),
    }));
    const pending = tool.execute({ subagent_id: activation.childId }, { agent: parent });
    if (outcome === "aborted") await activation.dispose();
    else adapter.release.resolve();
    const result = await pending;
    assert.equal(result.outcome, outcome);
    assert.equal(result.settlementNoticeQueued, false);
    assert.match(tool.output.render({}, result)[0].text, /delivery is unverified/);
    const terminal = await activation.result;
    assert.equal(result.stopReason, terminal.stopReason);
    assert.equal(parent.inbox.nextStep.length, 0, "caller delivery queues no parent completion notice");
  });
}

test("real named nested activation settles through the root's scoped lifecycle", {
  skip: typeof SubagentRuntime.prototype.resolveName !== "function", timeout: 10_000,
}, async (t) => {
  const ctx = await agentRuntime(t);
  await ctx.plugin(SubagentRuntime).await();
  await ctx.plugin(SessionQueryEngine).await();
  const reviewerModel = new GatedAdapter();
  const checkerModel = new GatedAdapter();
  ctx.llm.registerAdapter(["reviewer-model"], reviewerModel);
  ctx.llm.registerAdapter(["checker-model"], checkerModel);
  const root = await ctx.agentLoop.create("nested-root", { provider: "reviewer-model", model: "local" }, { cwd: tmpdir() });
  ctx.subagents.registerProvider({ name: "nested-test", inheritsParentContext: false,
    capabilities: { depthLimit: true, agentOptions: true }, async prepareContinuable() { return {}; } });
  const common = { provider: "nested-test", delivery: "caller", signal: new AbortController().signal, maxDepth: 2 };
  const review = await ctx.subagents.startActivation({ ...common, name: "reviewer", label: "review",
    parent: root, prompt: [{ type: "text", text: "review" }] });
  t.after(() => review.dispose());
  await reviewerModel.entered.promise;
  const reviewer = ctx.agents.get(review.childId);
  const check = await ctx.subagents.startActivation({ ...common, name: "checker", label: "check",
    parent: reviewer, prompt: [{ type: "text", text: "check" }],
    agentOptions: { provider: "checker-model", model: "local" } });
  t.after(() => check.dispose());
  await checkerModel.entered.promise;
  assert.equal(check.name, "reviewer/checker");
  let tool;
  const register = ctx.tools.register.bind(ctx.tools);
  t.after(registerWaitTool({ tools: { register(value) { tool = value; return register(value); } },
    subagents: ctx.subagents, get: ctx.get.bind(ctx) }));
  await assert.rejects(tool.execute({ subagent_id: "lead" }, { agent: reviewer }), /direct continuable/);
  const pending = tool.execute({ subagent_id: check.name }, { agent: reviewer });
  checkerModel.release.resolve();
  const result = await pending;
  assert.equal(result.outcome, "completed");
  assert.equal(result.subagentId, check.childId);
  assert.equal(result.stopReason, (await check.result).stopReason);
  assert.equal(result.settlementNoticeQueued, false);
});
