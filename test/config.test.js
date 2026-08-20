import { test } from "node:test";
import assert from "node:assert/strict";
import { Config, resolveConfig } from "../lib/config.js";

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

test("Config publishes descriptions for DSH plugin configuration surfaces", () => {
  const json = Config.toJSON();
  const root = json.refs[String(json.uid)];
  for (const key of Object.keys(root.dict)) {
    const field = json.refs[String(root.dict[key])];
    assert.equal(typeof field.meta.description, "string", key);
    assert.notEqual(field.meta.description, "", key);
  }
});
