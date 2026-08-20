import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

test("package declares and emits a DSH Web client factory", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
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

  let declaration;
  const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
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
