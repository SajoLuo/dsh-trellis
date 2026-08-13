import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../lib/config.js";

test("resolveConfig leaves pythonCmd empty for platform-aware auto detection", () => {
  assert.equal(resolveConfig({}).pythonCmd, "");
  assert.equal(
    resolveConfig({ pythonCmd: "  py-custom  " }).pythonCmd,
    "py-custom",
  );
});

test("resolveConfig preserves explicit feature switches", () => {
  const config = resolveConfig({ enabled: false, commandsEnabled: false });
  assert.equal(config.enabled, false);
  assert.equal(config.commandsEnabled, false);
});
