// Exact published pins: Cordis, Schemastery, Include, Loader. Do not classify a
// new host by != latest, a version prefix, or the ordering of prerelease labels.
const TOOLCHAINS = new Map([
  ["0.1.5-rc.2", ["4.0.2", "3.18.2", "1.0.7", "1.0.3"]],
  ["0.1.6-alpha.2", ["4.0.2", "3.18.2", "1.0.7", "1.0.3"]],
  ["0.1.7-rc.1", ["4.0.4", "3.18.4", "1.0.9", "1.0.5"]],
  ["0.1.7-rc.2", ["4.0.4", "3.18.4", "1.0.9", "1.0.5"]],
  ["0.2.0-rc.1", ["4.0.4", "3.18.4", "1.0.9", "1.0.5"]],
  ["0.2.0-rc.2", ["4.0.4", "3.18.4", "1.0.9", "1.0.5"]],
  ["0.2.1-alpha.2", ["4.0.5-alpha.1", "3.18.5-alpha.1", "1.0.10-alpha.1", "1.0.6-alpha.1"]],
  ["0.2.1-alpha.3", ["4.0.5-alpha.2", "3.18.5-alpha.2", "1.0.10-alpha.2", "1.0.6-alpha.2"]],
  ["0.2.1-alpha.4", ["4.0.5-alpha.2", "3.18.5-alpha.2", "1.0.10-alpha.2", "1.0.6-alpha.2"]],
  ["0.2.1-alpha.5", ["4.0.5-alpha.2", "3.18.5-alpha.2", "1.0.10-alpha.2", "1.0.6-alpha.2"]],
  ["0.2.1-rc.1", ["4.0.5", "3.18.5", "1.0.10", "1.0.6"]],
  ["0.2.1-rc.2", ["4.0.5", "3.18.5", "1.0.10", "1.0.6"]],
]);
export const SUPPORTED_HOSTS = Object.freeze([...TOOLCHAINS.keys()]);
const workingDirectoryHosts = new Set([
  "0.2.1-alpha.2", "0.2.1-alpha.3", "0.2.1-alpha.4", "0.2.1-alpha.5",
  "0.2.1-rc.1", "0.2.1-rc.2",
]);

export function createCompatManifest(original, version) {
  const pins = TOOLCHAINS.get(version);
  if (pins === undefined) {
    throw new Error(`Supported test hosts: ${SUPPORTED_HOSTS.join(", ")}`);
  }
  const manifest = structuredClone(original);
  manifest.private = true;
  delete manifest.scripts.prepack;
  delete manifest.devDependencies["@deepseek-ai/dsh-invariants"];
  for (const name of Object.keys(manifest.devDependencies)) {
    if (name.startsWith("@deepseek-ai/dsh-")) manifest.devDependencies[name] = version;
  }
  if (version === "0.1.5-rc.2") {
    delete manifest.devDependencies["@deepseek-ai/dsh-ptc-runtime"];
    manifest.devDependencies["@deepseek-ai/dsh-code-runtime"] = version;
  }
  const [cordis, schemastery, include, loader] = pins;
  Object.assign(manifest.devDependencies, {
    "@deepseek-ai/cordis": cordis,
    "@deepseek-ai/schemastery": schemastery,
    "@deepseek-ai/cordis-plugin-include": include,
    "@deepseek-ai/cordis-plugin-loader": loader,
  });
  if (workingDirectoryHosts.has(version)) {
    for (const name of ["fs", "fs-local", "working-directory"]) {
      manifest.devDependencies[`@deepseek-ai/dsh-${name}`] = version;
    }
  }
  return manifest;
}
