import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  editDraft,
  isOverridden,
  makeDraft,
  parseDraft,
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
  for (const invalidValue of [
    "",
    "   ",
    "-0",
    "-1",
    "1.5",
    "1e3",
    "0x10",
    "0b10",
    "0o10",
    "+10",
    "Infinity",
    "NaN",
    "9007199254740992",
  ]) {
    const draft = editDraft(makeDraft(snapshot), "maxBytes", invalidValue);
    const parsed = parseDraft(draft);
    assert.equal(parsed.invalid, true, invalidValue);
    assert.equal(Number.isNaN(parsed.value.maxBytes), true, invalidValue);
    assert.equal(planDraft(snapshot, draft).invalid, true, invalidValue);
  }
});

test("clearing maxBytes from 0 keeps draft dirty so the box cannot snap back", () => {
  const zeroSnapshot = {
    ...snapshot,
    value: { ...DEFAULTS, maxBytes: 0 },
    user: { maxBytes: 0 },
  };
  const draft = editDraft(makeDraft(zeroSnapshot), "maxBytes", "");
  const plan = planDraft(zeroSnapshot, draft);
  assert.equal(plan.invalid, true);
  assert.equal(plan.writes.length, 1);
});

test("parseDraft trims pythonCmd and skipKeyword to match runtime normalization", () => {
  let draft = makeDraft({
    ...snapshot,
    value: { ...DEFAULTS, pythonCmd: "", skipKeyword: "no-trellis" },
    user: {},
  });
  draft = editDraft(draft, "pythonCmd", "   ");
  draft = editDraft(draft, "skipKeyword", "  no-trellis  ");
  const parsed = parseDraft(draft);
  assert.equal(parsed.invalid, false);
  assert.equal(parsed.value.pythonCmd, "");
  assert.equal(parsed.value.skipKeyword, "no-trellis");
  assert.deepEqual(planDraft({ ...snapshot, value: { ...DEFAULTS } }, draft).writes, []);
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
