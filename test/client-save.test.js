import { test } from "node:test";
import assert from "node:assert/strict";
import { savePlan } from "../src/client/form.js";

const writes = [{ field: "maxBytes", kind: "set", value: 512 }, { field: "pythonCmd", kind: "unset" }];
test("new form commits all edits atomically with the edit-start revision", async () => {
  let calls = 0;
  const scope = {
    async mutate(ops, revision) {
      calls++;
      assert.equal(revision, 7);
      assert.deepEqual(ops, [{ op: "set", path: ["maxBytes"], value: 512 }, { op: "unset", path: ["pythonCmd"] }]);
      return true;
    },
    getSnapshot: () => ({ user: { maxBytes: 512 } }),
    set() { assert.fail("not atomic"); }, unset() { assert.fail("not atomic"); },
  };
  assert.equal(await savePlan(scope, writes, 7), true);
  assert.equal(calls, 1);
});
test("refused/conflicting writes do not masquerade as a successful save", async () => {
  assert.equal(await savePlan({ mutate: async () => false, getSnapshot() { assert.fail("refusal is final"); } }, writes, 7), false);
  assert.equal(await savePlan({ mutate: async () => true, getSnapshot: () => ({ user: {} }) }, writes, 7), false);
  await assert.rejects(savePlan({ mutate: async () => { throw new Error("disconnected"); } }, writes, 7), /disconnected/);
});
test("legacy form retains sequential writes and stops on refusal", async () => {
  const calls = [];
  const scope = { set: async () => { calls.push("set"); return false; }, unset: async () => calls.push("unset") };
  assert.equal(await savePlan(scope, writes, 7), false);
  assert.deepEqual(calls, ["set"]);
});
