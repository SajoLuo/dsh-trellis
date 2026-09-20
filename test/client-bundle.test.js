import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

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
