import { test } from "node:test";
import assert from "node:assert/strict";
import { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import { registerWaitTool, settlementOutcome } from "../lib/wait-tool.js";

test("installed DSH runtime retains direct-child lookup", () => {
  assert.equal(typeof SubagentRuntime.prototype.listChildren, "function");
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
    settlementNoticeQueued: true,
  });
  assert.equal(state.listenerCount(), 0);
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
