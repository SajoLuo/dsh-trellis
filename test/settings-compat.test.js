import { test } from "node:test";
import assert from "node:assert/strict";
import { installSettingsSectionCompat } from "../lib/settings-compat.js";

const namespace = "dsh-trellis";
const schema = { kind: "schema" };
const entry = { enabled: true };
const hooks = {
  setSource() {},
  onChange() {},
};

test("settings compatibility uses the legacy package helper through DSH 0.1.1", () => {
  const owner = {
    inject() {
      assert.fail("the legacy helper owns optional service injection");
    },
  };
  let received;
  const settingsModule = {
    installSettingsSection(...args) {
      received = args;
    },
  };

  installSettingsSectionCompat(
    owner,
    settingsModule,
    namespace,
    schema,
    entry,
    hooks,
  );

  assert.deepEqual(received, [owner, namespace, schema, entry, hooks]);
});

test("settings compatibility uses the provider method on DSH 0.1.2 alpha", () => {
  const calls = [];
  const settings = {
    installSection(...args) {
      calls.push({ receiver: this, args });
    },
  };
  const owner = {
    inject(services, callback) {
      calls.push({ services });
      callback({ settings });
    },
  };

  installSettingsSectionCompat(
    owner,
    {},
    namespace,
    schema,
    entry,
    hooks,
  );

  assert.deepEqual(calls[0], { services: ["settings"] });
  assert.equal(calls[1].receiver, settings);
  assert.deepEqual(calls[1].args, [
    owner,
    namespace,
    schema,
    entry,
    hooks,
  ]);
});

test("settings compatibility keeps profiles without a provider optional", () => {
  const owner = {
    inject(services) {
      assert.deepEqual(services, ["settings"]);
    },
  };

  assert.doesNotThrow(() =>
    installSettingsSectionCompat(
      owner,
      {},
      namespace,
      schema,
      entry,
      hooks,
    ),
  );
});

test("settings compatibility fails loudly for an unsupported mounted provider", () => {
  const owner = {
    inject(_services, callback) {
      callback({ settings: {} });
    },
  };

  assert.throws(
    () =>
      installSettingsSectionCompat(
        owner,
        {},
        namespace,
        schema,
        entry,
        hooks,
      ),
    /does not expose installSection/,
  );
});
