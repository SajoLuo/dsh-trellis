import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { LlmAdapter, createUserMessage } from "@deepseek-ai/dsh-llm";
import * as sessionModule from "@deepseek-ai/dsh-session";
import { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { agentRuntime } from "./helpers/agent-runtime.js";
import { registerWaitTool, settlementOutcome } from "../lib/wait-tool.js";

test("installed DSH runtime exposes a supported catalog/name capability", () => {
  const api = SubagentRuntime.prototype;
  if (typeof api.listChildren !== "function") {
    assert.equal(typeof api.rootOf, "function");
    assert.equal(typeof api.resolveName, "function");
  }
  assert.equal(typeof api.listDescendants, "function");
});

function harness(entries) {
  let tool;
  const handlers = new Set();
  const parent = {
    id: "parent-session",
    ctx: {
      on(event, handler) {
        assert.equal(event, "subagent/end");
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    },
  };
  const ctx = {
    tools: {
      register(value) {
        tool = value;
        return () => {};
      },
    },
    subagents: {
      async listChildren(parentId, signal) {
        assert.equal(parentId, parent.id);
        return typeof entries === "function" ? entries(signal) : entries;
      },
    },
  };
  const dispose = registerWaitTool(ctx);
  return {
    tool,
    parent,
    dispose,
    emit(info) {
      for (const handler of [...handlers]) handler(info);
    },
    listenerCount() {
      return handlers.size;
    },
  };
}

const runningChild = {
  kind: "child",
  id: "child-session",
  mode: "continuable",
  label: "trellis implement",
  activity: "running",
  hasChildren: false,
};

test("trellis_wait resolves from the native settlement event and cleans up", async () => {
  const state = harness([runningChild]);
  const pending = state.tool.execute(
    { subagent_id: runningChild.id },
    { agent: state.parent, signal: new AbortController().signal },
  );
  await Promise.resolve();
  assert.equal(state.listenerCount(), 1);
  state.emit({ id: "some-other-child", stopReason: "completed" });
  assert.equal(state.listenerCount(), 1);
  state.emit({
    id: runningChild.id,
    runId: "run-1",
    provider: "spawn",
    local: true,
    stopReason: "completed",
    lastAssistantMessage: [{ type: "text", text: "done" }],
  });
  assert.deepEqual(await pending, {
    subagentId: runningChild.id,
    state: "settled",
    outcome: "completed",
    stopReason: "completed",
    runId: "run-1",
    provider: "spawn",
    assistantOutputBlocks: 1,
    settlementNoticeQueued: false,
  });
  assert.equal(state.listenerCount(), 0);
  const rendered = state.tool.output.render({}, await pending)[0].text;
  assert.match(rendered, /delivery is unverified/);
  assert.doesNotMatch(rendered, /notice is queued/);
});

test("trellis_wait returns immediately for an inactive direct child", async () => {
  const state = harness([{ ...runningChild, activity: "inactive" }]);
  assert.deepEqual(
    await state.tool.execute(
      { subagent_id: runningChild.id },
      { agent: state.parent, signal: new AbortController().signal },
    ),
    {
      subagentId: runningChild.id,
      state: "already-inactive",
      outcome: "unknown",
      stopReason: "unknown",
      runId: "",
      provider: "",
      assistantOutputBlocks: 0,
      settlementNoticeQueued: false,
    },
  );
  assert.equal(state.listenerCount(), 0);
});

test("trellis_wait classifies non-completed rc.8 settlement reasons as failed gates", async () => {
  const state = harness([runningChild]);
  const pending = state.tool.execute(
    { subagent_id: runningChild.id },
    { agent: state.parent, signal: new AbortController().signal },
  );
  await Promise.resolve();
  state.emit({
    id: runningChild.id,
    runId: "run-failed",
    provider: "fork",
    stopReason: "max-tokens",
  });
  const result = await pending;
  assert.equal(result.outcome, "failed");
  assert.equal(result.stopReason, "max-tokens");
  assert.match(
    state.tool.output.render({}, result)[0].text,
    /do not treat this gate as passed/,
  );
});

test("settlementOutcome remains fail-closed for extension stop reasons", () => {
  assert.equal(settlementOutcome("completed"), "completed");
  assert.equal(settlementOutcome("aborted"), "aborted");
  assert.equal(settlementOutcome("unknown"), "unknown");
  assert.equal(settlementOutcome("refusal"), "failed");
  assert.equal(settlementOutcome("provider-new-reason"), "failed");
});

test("trellis_wait rejects unknown or non-direct agents without leaking a listener", async () => {
  const state = harness([]);
  await assert.rejects(
    state.tool.execute(
      { subagent_id: "not-a-child" },
      { agent: state.parent, signal: new AbortController().signal },
    ),
    /direct continuable subagent/,
  );
  assert.equal(state.listenerCount(), 0);
});

test("trellis_wait observes cancellation while it waits", async () => {
  const state = harness([runningChild]);
  const controller = new AbortController();
  const pending = state.tool.execute(
    { subagent_id: runningChild.id },
    { agent: state.parent, signal: controller.signal },
  );
  await Promise.resolve();
  controller.abort(new Error("cancelled by parent"));
  await assert.rejects(pending, /cancelled by parent/);
  assert.equal(state.listenerCount(), 0);
});

test("unloading the wait tool rejects every active wait and prevents stale executions", async () => {
  const state = harness([runningChild]);
  const waits = [1, 2].map(() => state.tool.execute(
    { subagent_id: runningChild.id }, { agent: state.parent },
  ));
  const results = waits.map((pending) => assert.rejects(pending, /unloaded.*no child completion/));
  await Promise.resolve();
  assert.equal(state.listenerCount(), 2);
  state.dispose();
  state.dispose();
  await Promise.all(results);
  assert.equal(state.listenerCount(), 0);
  await assert.rejects(state.tool.execute(
    { subagent_id: runningChild.id }, { agent: state.parent },
  ), /unloaded/);

  const reloaded = harness([runningChild]);
  const pending = reloaded.tool.execute(
    { subagent_id: runningChild.id }, { agent: reloaded.parent },
  );
  await Promise.resolve();
  reloaded.emit({ id: runningChild.id, stopReason: "completed" });
  assert.equal((await pending).outcome, "completed");
  reloaded.dispose();
});

test("a pre-aborted invocation does not subscribe or report an inactive child", async () => {
  const state = harness([{ ...runningChild, activity: "inactive" }]);
  await assert.rejects(state.tool.execute(
    { subagent_id: runningChild.id },
    { agent: state.parent, signal: AbortSignal.abort(new Error("already cancelled")) },
  ), /already cancelled/);
  assert.equal(state.listenerCount(), 0);
  state.dispose();
});

test("unload during a delayed catalog lookup aborts it and cannot report inactive success", async () => {
  let release;
  let lookupSignal;
  const state = harness((signal) => {
    lookupSignal = signal;
    return new Promise((resolve) => { release = resolve; });
  });
  const pending = state.tool.execute(
    { subagent_id: runningChild.id }, { agent: state.parent },
  );
  const rejected = assert.rejects(pending, /unloaded/);
  state.dispose();
  assert.equal(lookupSignal.aborted, true);
  assert.equal(state.listenerCount(), 0);
  // Let cancellation settle before the host's asynchronous lookup completes.
  // The intermediate waiter rejection must not become an unhandled rejection.
  await new Promise((resolve) => setImmediate(resolve));
  release([{ ...runningChild, activity: "inactive" }]);
  await rejected;
});

test("trellis_wait marks itself concurrency-safe and narrows output schema", () => {
  const state = harness([runningChild]);
  try {
    assert.equal(typeof state.tool.isConcurrencySafe, "function");
    assert.equal(state.tool.isConcurrencySafe({ subagent_id: runningChild.id }), true);
    assert.equal(state.tool.isConcurrencySafe({}), false);

    const schema = state.tool.output.schema;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.state.enum, ["settled", "already-inactive"]);
    assert.deepEqual(schema.properties.outcome.enum, ["completed", "failed", "aborted", "unknown"]);
    assert.equal(schema.properties.assistantOutputBlocks.type, "integer");
    for (const key of [
      "subagentId",
      "state",
      "outcome",
      "stopReason",
      "runId",
      "provider",
      "assistantOutputBlocks",
      "settlementNoticeQueued",
    ]) {
      assert.equal(typeof schema.properties[key].description, "string");
      assert.ok(schema.properties[key].description.length > 0, `${key} description must be non-empty`);
    }

    const base = {
      subagentId: "child-session",
      state: "settled",
      outcome: "completed",
      stopReason: "completed",
      runId: "run-1",
      provider: "spawn",
      assistantOutputBlocks: 1,
      settlementNoticeQueued: false,
    };
    assert.deepEqual(validateJsonSchemaValue(schema, base, ""), []);
    assert.ok(validateJsonSchemaValue(schema, { ...base, state: "other" }, "").length > 0);
    assert.ok(validateJsonSchemaValue(schema, { ...base, outcome: "other" }, "").length > 0);
    assert.ok(validateJsonSchemaValue(schema, { ...base, assistantOutputBlocks: 1.5 }, "").length > 0);
  } finally {
    state.dispose();
  }
});

test("trellis_wait settles when detach happens just before subagent/end in teardown window", async () => {
  let state;
  state = harness(async () => {
    setImmediate(() => {
      state.emit({
        id: runningChild.id,
        runId: "run-teardown",
        provider: "spawn",
        stopReason: "completed",
        lastAssistantMessage: [{ type: "text", text: "teardown ok" }],
      });
    });
    return [{ ...runningChild, activity: "inactive" }];
  });
  try {
    const result = await state.tool.execute(
      { subagent_id: runningChild.id },
      { agent: state.parent, signal: new AbortController().signal },
    );
    assert.deepEqual(result, {
      subagentId: runningChild.id,
      state: "settled",
      outcome: "completed",
      stopReason: "completed",
      runId: "run-teardown",
      provider: "spawn",
      assistantOutputBlocks: 1,
      settlementNoticeQueued: false,
    });
    assert.equal(state.listenerCount(), 0);
  } finally {
    state.dispose();
  }
});

test("trellis_wait cancels cleanly if aborted during inactive teardown window", async () => {
  const controller = new AbortController();
  let state;
  state = harness(async () => {
    setImmediate(() => controller.abort(new Error("aborted during teardown")));
    return [{ ...runningChild, activity: "inactive" }];
  });
  try {
    await assert.rejects(
      state.tool.execute({ subagent_id: runningChild.id }, { agent: state.parent, signal: controller.signal }),
      /aborted during teardown/,
    );
    assert.equal(state.listenerCount(), 0);
  } finally {
    state.dispose();
  }
});

test("trellis_wait ignores mismatched createdAt in inactive teardown window", async () => {
  let state;
  state = harness(async () => {
    setImmediate(() => {
      state.emit({
        id: runningChild.id,
        createdAt: "2026-11-14T00:05:00Z",
        stopReason: "completed",
      });
    });
    return [{ ...runningChild, createdAt: "2026-11-14T00:00:00Z", activity: "inactive" }];
  });
  try {
    const result = await state.tool.execute(
      { subagent_id: runningChild.id },
      { agent: state.parent, signal: new AbortController().signal },
    );
    assert.equal(result.state, "already-inactive");
    assert.equal(result.outcome, "unknown");
    assert.equal(state.listenerCount(), 0);
  } finally {
    state.dispose();
  }
});

test("trellis_wait reports parallel execution mode across ToolRuntime versions", async (t) => {
  const ctx = await agentRuntime(t);
  t.after(registerWaitTool(ctx));
  const modeOwner = typeof ctx.tools.executionMode === "function"
    ? ctx.tools
    : new (await import("@deepseek-ai/dsh-tools/pipeline")).ToolExecutionPipeline(ctx);
  assert.deepEqual(
    modeOwner.executionMode({ name: "trellis_wait", arguments: { subagent_id: "a" } }),
    { kind: "parallel" },
  );
  assert.deepEqual(
    modeOwner.executionMode({ name: "trellis_wait", arguments: {} }),
    { kind: "exclusive" },
  );
});

test("two trellis_wait calls run concurrently through agent-loop without blocking b behind a", {
  skip: typeof sessionModule.ToolCallRecovery !== "function",
  timeout: 10_000,
}, async (t) => {
  const ctx = await agentRuntime(t);
  let calls = 0;
  class DualWaitAdapter extends LlmAdapter {
    async *stream(options) {
      options.signal?.throwIfAborted();
      calls++;
      if (calls === 1) {
        yield { type: "block-start", index: 0, blockType: "tool-call" };
        yield { type: "block-end", index: 0, block: {
          type: "tool-call", id: "wait-a", name: "trellis_wait", arguments: JSON.stringify({ subagent_id: "a" }),
        } };
        yield { type: "block-start", index: 1, blockType: "tool-call" };
        yield { type: "block-end", index: 1, block: {
          type: "tool-call", id: "wait-b", name: "trellis_wait", arguments: JSON.stringify({ subagent_id: "b" }),
        } };
        yield { type: "finish", reason: { kind: "tool-calls" } };
      } else {
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "block-end", index: 0, block: { type: "text", text: "both settled" } };
        yield { type: "finish", reason: { kind: "stop" } };
      }
    }
  }
  ctx.llm.registerAdapter(["scripted"], new DualWaitAdapter());

  const originalRegister = ctx.tools.register.bind(ctx.tools);
  const executeOrder = [];
  const bothStarted = Promise.withResolvers();
  const bSettled = Promise.withResolvers();
  let startedCount = 0;
  ctx.tools.register = (definition) => {
    if (definition.name !== "trellis_wait") return originalRegister(definition);
    return originalRegister({
      ...definition,
      async execute(args, exec) {
        executeOrder.push(`start:${args.subagent_id}`);
        startedCount++;
        if (startedCount === 2) bothStarted.resolve();
        const result = await definition.execute(args, exec);
        executeOrder.push(`end:${args.subagent_id}`);
        if (args.subagent_id === "b") bSettled.resolve(result);
        return result;
      },
    });
  };
  ctx.provide("subagents", {
    async listChildren() {
      return [
        { kind: "child", id: "a", mode: "continuable", label: "slow", activity: "running", hasChildren: false },
        { kind: "child", id: "b", mode: "continuable", label: "fast", activity: "running", hasChildren: false },
      ];
    },
  });
  t.after(registerWaitTool(ctx));
  const agent = await ctx.agentLoop.create(
    "concurrent-parent",
    { provider: "scripted", model: "local" },
    { cwd: tmpdir() },
  );
  const modeOwner = typeof ctx.tools.executionMode === "function"
    ? ctx.tools
    : ctx.tools.selectExecutor(agent).pipeline;
  assert.deepEqual(
    modeOwner.executionMode({ name: "trellis_wait", arguments: { subagent_id: "a" }, agent }),
    { kind: "parallel" },
  );

  agent.followup(createUserMessage({ content: [{ type: "text", text: "wait both" }], source: { kind: "user" } }));
  await bothStarted.promise;
  await new Promise((resolve) => setImmediate(resolve));
  agent.ctx.emit("subagent/end", { id: "b", runId: "run-b", provider: "spawn", stopReason: "completed" });
  const bResult = await bSettled.promise;
  assert.equal(bResult.state, "settled");
  assert.equal(bResult.outcome, "completed");

  agent.ctx.emit("subagent/end", { id: "a", runId: "run-a", provider: "spawn", stopReason: "completed" });
  await agent.whenIdle();

  assert.equal(executeOrder.indexOf("start:b") < executeOrder.indexOf("end:b"), true);
  assert.equal(executeOrder.indexOf("end:b") < executeOrder.indexOf("end:a"), true);
  assert.equal(ctx.events.dispatch("emit", ["subagent/end", { id: "a" }]).length, 0);
  const toolResults = agent.session.snapshotEvents().filter((event) => event.type === "tool/result");
  assert.deepEqual(toolResults.map((event) => event.data.message.toolCallId), ["wait-a", "wait-b"]);
  assert.ok(toolResults.every((event) => event.data.message.isError === false));
});
