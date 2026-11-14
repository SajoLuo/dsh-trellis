import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Config,
  hasLiveConfig,
  loadOptionalSettingsModule,
  resolveConfig,
  volatile,
} from "../lib/config.js";

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

test("loadOptionalSettingsModule returns {} only on missing-module errors", () => {
  for (const code of ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"]) {
    assert.deepEqual(
      loadOptionalSettingsModule(() => {
        const error = new Error("missing");
        error.code = code;
        throw error;
      }),
      {},
    );
  }
  const fakeSettings = { SettingsForms() {} };
  assert.equal(
    loadOptionalSettingsModule((specifier) => {
      assert.equal(specifier, "@deepseek-ai/dsh-settings");
      return fakeSettings;
    }),
    fakeSettings,
  );
  assert.throws(
    () =>
      loadOptionalSettingsModule(() => {
        throw new SyntaxError("broken settings module");
      }),
    SyntaxError,
  );
});

test("volatile selects volatile schema for 0.2.x and minimal hosts but preserves plain schema for 0.1.5/0.1.6", () => {
  const volMarker = { kind: "volatile" };
  const plainMarker = {
    kind: "plain",
    volatile() {
      return volMarker;
    },
  };
  assert.equal(volatile(plainMarker, {}), volMarker);
  assert.equal(volatile(plainMarker, { SettingsForms() {} }), volMarker);
  assert.equal(volatile(plainMarker, { installSettingsSection() {} }), plainMarker);
  const noVolatile = { kind: "legacy-schemastery" };
  assert.equal(volatile(noVolatile, {}), noVolatile);
});

test("hasLiveConfig and resolveConfig safely handle null, non-objects, and invalid field values", () => {
  for (const badInput of [null, undefined, [], "text", 42, new Date()]) {
    assert.equal(hasLiveConfig(badInput), false);
    assert.deepEqual(resolveConfig(badInput), {
      enabled: true,
      maxBytes: 4096,
      projectRootMarkers: [".git"],
      skipKeyword: "no-trellis",
      pythonCmd: "",
      commandsEnabled: true,
    });
  }

  const liveNan = {
    [Symbol.for("cosmokit.volatile.write")]: true,
    get() {
      return Number.NaN;
    },
  };
  assert.equal(hasLiveConfig({ maxBytes: liveNan }), true);

  const recovered = resolveConfig({
    enabled: "false",
    commandsEnabled: 0,
    maxBytes: liveNan,
    projectRootMarkers: [" .trellis ", 123, "", "   ", ".trellis", ".git"],
    skipKeyword: 123,
    pythonCmd: 456,
  });
  assert.deepEqual(recovered, {
    enabled: true,
    maxBytes: 4096,
    projectRootMarkers: [".trellis", ".git"],
    skipKeyword: "no-trellis",
    pythonCmd: "",
    commandsEnabled: true,
  });

  for (const badMaxBytes of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    1.5,
    "100",
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(resolveConfig({ maxBytes: badMaxBytes }).maxBytes, 4096);
  }
  assert.equal(Object.is(resolveConfig({ maxBytes: -0 }).maxBytes, 0), true);
  assert.deepEqual(resolveConfig({ projectRootMarkers: [] }).projectRootMarkers, []);
  assert.equal(resolveConfig({ skipKeyword: "  custom-skip  " }).skipKeyword, "custom-skip");
  assert.equal(resolveConfig({ skipKeyword: "" }).skipKeyword, "");
});
