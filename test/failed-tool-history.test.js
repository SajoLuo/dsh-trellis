import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { LlmAdapter, createUserMessage } from "@deepseek-ai/dsh-llm";
import * as sessionModule from "@deepseek-ai/dsh-session";
import { TOOL_RUNTIME_SCHEDULER } from "@deepseek-ai/dsh-tools";
import { agentRuntime } from "./helpers/agent-runtime.js";
import * as plugin from "../lib/index.js";
import { isBreadcrumbMessage } from "../lib/breadcrumb.js";

const cwd = fileURLToPath(new URL("./fixtures/breadcrumb-project", import.meta.url));
const prompt = (text) => createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });

class WaitAdapter extends LlmAdapter {
  requests = [];
  async *stream(options) {
    options.signal?.throwIfAborted();
    this.requests.push(options);
    if (this.requests.length === 1) {
      for (const [index, id] of ["first", "failed", "skipped"].entries()) {
        yield { type: "block-start", index, blockType: "tool-call" };
        yield { type: "block-end", index, block: {
          type: "tool-call", id, name: "trellis_wait", arguments: JSON.stringify({ subagent_id: "child" }),
        } };
      }
      yield { type: "finish", reason: { kind: "tool-calls" } };
    } else {
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "block-end", index: 0, block: { type: "text", text: "Continued without retrying tools" } };
      yield { type: "finish", reason: { kind: "stop" } };
    }
  }
}

for (const phase of ["execution-mode", "finalize"]) {
  test(`DSH 0.2 recovers failed wait history after ${phase} without replaying it`, {
    skip: typeof sessionModule.ToolCallRecovery !== "function",
    timeout: 15_000,
  }, async (t) => {
    const ctx = await agentRuntime(t);
    ctx.provide("commands", { register: () => () => {} });
    ctx.provide("shellEnv", { register: () => () => {} });
    let lookups = 0;
    ctx.provide("subagents", { async listChildren(parent) {
      assert.equal(parent, "failure-parent");
      lookups++;
      // A cold direct child: the plugin must not fabricate a completed outcome.
      return [{ id: "child", createdAt: 123, mode: "continuable", label: "implement" }];
    } });
    await ctx.plugin(plugin, { projectRootMarkers: [".trellis"], commandsEnabled: false });
    const adapter = new WaitAdapter();
    ctx.llm.registerAdapter(["scripted"], adapter);
    const agent = await ctx.agentLoop.create("failure-parent", { provider: "scripted", model: "local" }, { cwd });
    const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER];
    const executionMode = ctx.tools.executionMode.bind(ctx.tools);
    const finalize = scheduler.finalize.bind(scheduler);
    const failure = new Error(`injected ${phase} failure`);
    // Test-only scheduler fault injection, matching the upstream recovery tests.
    // Real calls and results still pass through ToolRuntime and trellis_wait.
    if (phase === "execution-mode") {
      ctx.tools.executionMode = (exec) => {
        if (exec.callId === "failed") throw failure;
        return executionMode(exec);
      };
    } else {
      scheduler.finalize = (exec, result) => {
        if (exec.callId === "failed") throw failure;
        return finalize(exec, result);
      };
    }
    const listeners = () => ctx.events.dispatch("emit", ["subagent/end", { id: "child" }]).length;
    const baselineListeners = listeners();
    agent.followup(prompt("Wait for the child"));
    await agent.whenIdle();
    const events = agent.session.snapshotEvents();
    const results = events.filter((event) => event.type === "tool/result");
    assert.deepEqual(results.map((event) => [event.data.message.toolCallId, event.data.error?.code]), [
      ["first", undefined],
      ["failed", phase === "execution-mode" ? sessionModule.TOOL_NOT_STARTED : sessionModule.TOOL_OUTCOME_UNKNOWN],
      ["skipped", sessionModule.TOOL_NOT_STARTED],
    ]);
    assert.match(results[0].data.message.content[0].text, /already inactive/);
    assert.equal(results[0].data.message.isError, false);
    assert.ok(results.slice(1).every((event) => event.data.message.isError === true));
    assert.deepEqual(events.slice(-3).map((event) => event.type), ["tool/result", "step/end", "turn/end"]);
    assert.equal(events.at(-1).data.reason.kind, "error");
    assert.equal(events.at(-1).data.reason.error.message, failure.message);
    const expectedLookups = phase === "finalize" ? 2 : 1;
    assert.equal(lookups, expectedLookups);
    assert.equal(listeners(), baselineListeners);
    assert.equal(agent.session.deriveMessages().filter(isBreadcrumbMessage).length, 1);

    ctx.tools.executionMode = executionMode;
    scheduler.finalize = finalize;
    agent.followup(prompt("Continue after checking the failure"));
    await agent.whenIdle();
    assert.equal(adapter.requests.length, 2, "the failed turn never auto-retries the tools");
    assert.equal(lookups, expectedLookups);
    const request = adapter.requests[1];
    assert.equal(request.messages.filter(isBreadcrumbMessage).length, 1);
    assert.deepEqual(request.messages.filter((message) => message.role === "tool")
      .map((message) => message.toolCallId), ["first", "failed", "skipped"]);
    assert.equal(agent.session.snapshotEvents().filter((event) => event.type === "tool/result").length, 3);
    assert.equal(agent.session.snapshotEvents().at(-1).data.reason.kind, "completed");
    assert.equal(listeners(), baselineListeners);
  });
}
