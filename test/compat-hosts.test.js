import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_HOSTS, createCompatManifest } from "../scripts/compat-hosts.mjs";

const original = {
  scripts: { prepack: "build", test: "node --test" },
  devDependencies: {
    "@deepseek-ai/dsh-agent-loop": "baseline",
    "@deepseek-ai/dsh-ptc-runtime": "baseline",
    "@deepseek-ai/cordis": "baseline",
    react: "19.2.8",
  },
};
for (const version of SUPPORTED_HOSTS) {
  test(`compat fixture pins the published toolchain for ${version}`, () => {
    const before = structuredClone(original);
    const manifest = createCompatManifest(original, version);
    const legacy = ["0.1.5-rc.2", "0.1.6-alpha.2"].includes(version);
    const deps = manifest.devDependencies;
    assert.equal(deps["@deepseek-ai/cordis"], legacy ? "4.0.2" : "4.0.4");
    assert.equal(deps["@deepseek-ai/schemastery"], legacy ? "3.18.2" : "3.18.4");
    assert.equal(deps["@deepseek-ai/cordis-plugin-loader"], legacy ? "1.0.3" : "1.0.5");
    assert.equal(deps["@deepseek-ai/cordis-plugin-include"], legacy ? "1.0.7" : "1.0.9");
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
  assert.throws(() => createCompatManifest(original, "0.1.7-rc.3"), /Supported test hosts/);
});
