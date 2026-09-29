import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWaitTool } from "../lib/wait-tool.js";

const row = { id: "child", createdAt: 123, mode: "continuable", label: "implement" };
function fixture(t, { entries = [row], header, missingStore = false } = {}) {
  let tool;
  const listeners = new Set();
  const parent = { id: "parent", ctx: { on(_event, fn) {
    listeners.add(fn); return () => listeners.delete(fn);
  } } };
  const dispose = registerWaitTool({
    tools: { register(value) { tool = value; return () => {}; } },
    subagents: { async listChildren(id, signal) {
      assert.equal(id, "parent");
      return typeof entries === "function" ? entries(signal) : entries;
    } },
    get(name) {
      assert.equal(name, "sessions");
      return missingStore ? undefined : { get: () => header ? { header } : undefined };
    },
  });
  t.after(dispose);
  return { run: () => tool.execute({ subagent_id: "child" }, { agent: parent }),
    end: (stopReason = "completed") => { for (const fn of [...listeners]) fn({ id: "child", stopReason }); },
    listeners, dispose };
}
const header = { id: "child", createdAt: 123, parentSession: "parent", origin: "subagent" };

test("new catalog child waits for a native end event and cleans up", async (t) => {
  const h = fixture(t, { header });
  const pending = h.run();
  await Promise.resolve();
  h.end();
  assert.equal((await pending).outcome, "completed");
  assert.equal(h.listeners.size, 0);
});
test("cold catalog child does not wait for a past event or claim success", async (t) => {
  const h = fixture(t);
  const result = await h.run();
  assert.equal(result.state, "already-inactive");
  assert.equal(result.outcome, "unknown");
  assert.equal(result.settlementNoticeQueued, false);
  assert.equal(h.listeners.size, 0);
});
for (const options of [
  { entries: [{ ...row, mode: "unknown" }] },
  { entries: [{ ...row, kind: "diagnostic" }] },
  { missingStore: true },
  { header: { ...header, parentSession: "other" } },
  { header: { ...header, createdAt: 456 } },
]) test(`catalog wait fails closed: ${JSON.stringify(options)}`, async (t) => {
  const h = fixture(t, options);
  await assert.rejects(h.run(), /direct continuable|requires the session store|lifecycle/);
  assert.equal(h.listeners.size, 0);
});
for (const stopReason of ["completed", "error", "aborted"]) {
  test(`settlement during catalog lookup preserves ${stopReason}`, async (t) => {
    let release;
    const h = fixture(t, { entries: () => new Promise((resolve) => { release = resolve; }) });
    const pending = h.run();
    h.end(stopReason);
    release([row]);
    const result = await pending;
    assert.equal(result.stopReason, stopReason);
    assert.equal(result.settlementNoticeQueued, true);
    assert.equal(h.listeners.size, 0);
  });
}

for (const code of ["SESSION_QUERY_CORRUPT_SESSION", "SESSION_QUERY_SESSION_NOT_FOUND"]) {
  test(`catalog lookup failure preserves ${code} and releases its listener`, async (t) => {
    const error = Object.assign(new Error("catalog unavailable"), { code });
    const h = fixture(t, { entries: async () => { throw error; } });
    await assert.rejects(h.run(), (caught) => caught === error);
    assert.equal(h.listeners.size, 0);
    h.end(); // A later settlement cannot convert the failed lookup into success.
    await assert.rejects(h.run(), (caught) => caught === error);
    assert.equal(h.listeners.size, 0);
  });
}

test("catalog rejection during unload preserves the failure and leaves no listener", async (t) => {
  let rejectLookup;
  const error = new Error("late catalog failure");
  const h = fixture(t, { entries: () => new Promise((_resolve, reject) => { rejectLookup = reject; }) });
  const pending = h.run();
  const rejected = assert.rejects(pending, (caught) => caught === error);
  h.dispose();
  assert.equal(h.listeners.size, 0);
  rejectLookup(error);
  await rejected;
  h.end();
  await assert.rejects(h.run(), /unloaded/);
  assert.equal(h.listeners.size, 0);
});

test("a settlement during a failed catalog lookup cannot turn the failure into success", async (t) => {
  let rejectLookup;
  const error = new Error("catalog query failed after settlement");
  const h = fixture(t, { entries: () => new Promise((_resolve, reject) => { rejectLookup = reject; }) });
  const pending = h.run();
  const rejected = assert.rejects(pending, (caught) => caught === error);
  h.end("completed");
  rejectLookup(error);
  await rejected;
  assert.equal(h.listeners.size, 0);
});
