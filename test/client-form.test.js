import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editDraft,
  isOverridden,
  makeDraft,
  parseMarkers,
  planDraft,
  planLanded,
  resetDraft,
} from "../src/client/form.js";
import { settingsCardIdentity } from "../src/client/compat.js";

const snapshot = {
  status: "ready",
  writable: true,
  revision: 4,
  value: {
    enabled: true,
    maxBytes: 8192,
    projectRootMarkers: [".git"],
    skipKeyword: "no-trellis",
    pythonCmd: "py",
    commandsEnabled: true,
  },
  base: { maxBytes: 4096, pythonCmd: "" },
  user: { maxBytes: 8192, pythonCmd: "py" },
};

test("client form stages typed settings without writing on edit", () => {
  let draft = makeDraft(snapshot);
  draft = editDraft(draft, "maxBytes", "16384");
  draft = editDraft(draft, "projectRootMarkers", ".git\n.trellis\n.git");

  assert.deepEqual(parseMarkers(".git\n.trellis\n.git"), [".git", ".trellis"]);
  assert.deepEqual(planDraft(snapshot, draft), {
    invalid: false,
    writes: [
      { field: "maxBytes", kind: "set", value: 16384 },
      {
        field: "projectRootMarkers",
        kind: "set",
        value: [".git", ".trellis"],
      },
    ],
  });
});

test("reset stages an unset to the composition layer", () => {
  const draft = resetDraft(snapshot, makeDraft(snapshot), "maxBytes");
  assert.equal(draft.maxBytes.value, 4096);
  assert.equal(isOverridden(snapshot, draft, "maxBytes"), false);
  assert.deepEqual(planDraft(snapshot, draft).writes, [
    { field: "maxBytes", kind: "unset" },
  ]);
});

test("invalid maxBytes blocks the form plan", () => {
  const draft = editDraft(makeDraft(snapshot), "maxBytes", "-1");
  assert.equal(planDraft(snapshot, draft).invalid, true);
});

test("save verification checks the raw user layer", () => {
  const writes = [
    { field: "maxBytes", kind: "set", value: 16384 },
    { field: "pythonCmd", kind: "unset" },
  ];
  assert.equal(
    planLanded({ user: { maxBytes: 16384 } }, writes),
    true,
  );
  assert.equal(
    planLanded({ user: { maxBytes: 8192, pythonCmd: "py" } }, writes),
    false,
  );
});

test("settings card uses the rc.8 keyed slot and rc.6 list fallback", () => {
  assert.deepEqual(
    settingsCardIdentity({ kind: "keyed" }, "dsh-trellis"),
    { key: "dsh-trellis" },
  );
  assert.deepEqual(
    settingsCardIdentity({ kind: "list" }, "dsh-trellis"),
    { id: "dsh-trellis" },
  );
});
