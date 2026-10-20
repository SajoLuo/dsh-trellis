import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
import semver from "semver";
import { SUPPORTED_HOSTS } from "../scripts/compat-hosts.mjs";

test("engines.dsh admits every compatibility target with DSH's prerelease-aware rule", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(typeof manifest.engines.dsh, "string");
  assert.notEqual(semver.validRange(manifest.engines.dsh), null);
  for (const version of SUPPORTED_HOSTS) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), true, version);
    for (const [name, range] of Object.entries(manifest.peerDependencies)) {
      if (name.startsWith("@deepseek-ai/dsh-")) {
        assert.equal(semver.satisfies(version, range, { includePrerelease: true }), true, `${name} on ${version}`);
      }
    }
  }
  for (const version of ["0.0.9", "0.3.0", "1.0.0"]) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), false, version);
  }
  // npm's ordinary peer rule must also admit the published stable vendor pins.
  assert.equal(semver.satisfies("4.0.5", manifest.peerDependencies["@deepseek-ai/cordis"]), true);
  assert.equal(semver.satisfies("3.18.5", manifest.peerDependencies["@deepseek-ai/schemastery"]), true);
});

test("package declares and emits a DSH Web client factory", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.dsh.manifestVersion, 1);
  assert.equal(manifest.engines.dsh, manifest.peerDependencies["@deepseek-ai/dsh-tools"]);
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith("@deepseek-ai/dsh-")) assert.match(range, /\^0\.1\.6-alpha\.2/);
  }
  assert.deepEqual(manifest.dsh.client, {
    inject: [
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-settings-plugins",
    ],
    platform: "web",
  });
  assert.equal(manifest.exports["./client"], "./lib/client.js");
  assert.equal(manifest.exports["./package.json"], "./package.json");
  for (const dependency of [...manifest.dsh.client.inject, "react"]) {
    assert.equal(manifest.peerDependencies[dependency], undefined);
    assert.equal(manifest.peerDependenciesMeta[dependency], undefined);
    assert.notEqual(manifest.devDependencies[dependency], undefined);
  }

  let declaration;
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
  const sourceMap = JSON.parse(
    await readFile(new URL("../lib/client.js.map", import.meta.url), "utf8"),
  );
  assert.equal(sourceMap.sourcesContent, undefined);
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(value) {
          declaration = value;
        },
      },
    },
  });
  assert.equal(declaration.id, "dsh-trellis");
  assert.equal(typeof declaration.factory, "function");
});
