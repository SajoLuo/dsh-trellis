import { defineConfig } from "tsdown";

const id = "dsh-trellis";
const externals = new Set(["react", "react/jsx-runtime"]);

export default defineConfig({
  name: `${id}/client`,
  entry: { client: "src/client/index.jsx" },
  outDir: "lib",
  format: "cjs",
  platform: "browser",
  target: "es2022",
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier) => externals.has(specifier),
    alwaysBundle: (specifier) => !externals.has(specifier),
  },
  outputOptions: {
    entryFileNames: "client.js",
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: "return module.exports; } });",
    intro: "var module = { exports: {} }; var exports = module.exports;",
  },
});
