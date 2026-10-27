import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_HOSTS, createCompatManifest } from "../scripts/compat-hosts.mjs";

const original = {
  scripts: { prepack: "build", test: "node --test" },
  devDependencies: {
    "@deepseek-ai/dsh-agent-loop": "baseline",
    "@deepseek-ai/dsh-ptc-runtime": "baseline",
    "@deepseek-ai/dsh-invariants": "baseline",
    "@deepseek-ai/cordis": "baseline",
    react: "19.2.8",
  },
};
// Independent expectations: neither missing a host nor accidentally assigning
// it another release's toolchain should be hidden by iterating the production map.
const expected = {
  "0.1.5-rc.2": ["4.0.2", "3.18.2", "1.0.7", "1.0.3", false],
  "0.1.6-alpha.2": ["4.0.2", "3.18.2", "1.0.7", "1.0.3", false],
  "0.1.7-rc.1": ["4.0.4", "3.18.4", "1.0.9", "1.0.5", false],
  "0.1.7-rc.2": ["4.0.4", "3.18.4", "1.0.9", "1.0.5", false],
  "0.2.0-rc.1": ["4.0.4", "3.18.4", "1.0.9", "1.0.5", false],
  "0.2.0-rc.2": ["4.0.4", "3.18.4", "1.0.9", "1.0.5", false],
  "0.2.1-alpha.2": ["4.0.5-alpha.1", "3.18.5-alpha.1", "1.0.10-alpha.1", "1.0.6-alpha.1", true],
  "0.2.1-alpha.3": ["4.0.5-alpha.2", "3.18.5-alpha.2", "1.0.10-alpha.2", "1.0.6-alpha.2", true],
  "0.2.1-alpha.4": ["4.0.5-alpha.2", "3.18.5-alpha.2", "1.0.10-alpha.2", "1.0.6-alpha.2", true],
  "0.2.1-alpha.5": ["4.0.5-alpha.2", "3.18.5-alpha.2", "1.0.10-alpha.2", "1.0.6-alpha.2", true],
  "0.2.1-rc.1": ["4.0.5", "3.18.5", "1.0.10", "1.0.6", true],
  "0.2.1-rc.2": ["4.0.5", "3.18.5", "1.0.10", "1.0.6", true],
  "0.2.1-rc.3": ["4.0.5", "3.18.5", "1.0.10", "1.0.6", true],
  "0.2.1-rc.4": ["4.0.5", "3.18.5", "1.0.10", "1.0.6", true],
};

test("compat hosts explicitly include every certified historical and current target", () => {
  assert.deepEqual(SUPPORTED_HOSTS, Object.keys(expected));
});

for (const [version, [cordis, schemastery, include, loader, workingDirectory]] of Object.entries(expected)) {
  test(`compat fixture pins the published toolchain for ${version}`, () => {
    const before = structuredClone(original);
    const manifest = createCompatManifest(original, version);
    const deps = manifest.devDependencies;
    assert.equal(deps["@deepseek-ai/cordis"], cordis);
    assert.equal(deps["@deepseek-ai/schemastery"], schemastery);
    assert.equal(deps["@deepseek-ai/cordis-plugin-loader"], loader);
    assert.equal(deps["@deepseek-ai/cordis-plugin-include"], include);
    assert.equal(deps["@deepseek-ai/dsh-invariants"], undefined);
    for (const name of ["fs", "fs-local", "working-directory"]) {
      assert.equal(deps[`@deepseek-ai/dsh-${name}`], workingDirectory ? version : undefined);
    }
    assert.equal(deps["@deepseek-ai/dsh-agent-loop"], version);
    const oldRuntime = version === "0.1.5-rc.2";
    assert.equal(deps[`@deepseek-ai/dsh-${oldRuntime ? "code" : "ptc"}-runtime`], version);
    assert.equal(deps[`@deepseek-ai/dsh-${oldRuntime ? "ptc" : "code"}-runtime`], undefined);
    assert.equal(deps.react, original.devDependencies.react);
    assert.equal(manifest.private, true);
    assert.equal(manifest.scripts.prepack, undefined);
    assert.equal(manifest.scripts.test, original.scripts.test);
    assert.deepEqual(original, before);
  });
}
test("compat fixture rejects an unverified host instead of guessing its dependencies", () => {
  for (const version of ["0.1.7-rc.3", "0.2.1-rc.5", "0.2.1", "constructor", "__proto__"]) {
    assert.throws(() => createCompatManifest(original, version), /Supported test hosts/);
  }
});
