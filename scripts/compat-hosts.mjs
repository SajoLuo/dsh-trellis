// Exact published host/toolchain combinations; never infer legacy from != latest.
export const SUPPORTED_HOSTS = [
  "0.1.5-rc.2", "0.1.6-alpha.2", "0.1.7-rc.1", "0.1.7-rc.2", "0.2.0-rc.1", "0.2.0-rc.2",
  "0.2.1-alpha.2",
];
const legacyHosts = new Set(["0.1.5-rc.2", "0.1.6-alpha.2"]);

export function createCompatManifest(original, version) {
  if (!SUPPORTED_HOSTS.includes(version)) {
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
  const legacy = legacyHosts.has(version);
  const alpha = version === "0.2.1-alpha.2";
  Object.assign(manifest.devDependencies, {
    "@deepseek-ai/cordis": alpha ? "4.0.5-alpha.1" : legacy ? "4.0.2" : "4.0.4",
    "@deepseek-ai/schemastery": alpha ? "3.18.5-alpha.1" : legacy ? "3.18.2" : "3.18.4",
    "@deepseek-ai/cordis-plugin-include": alpha ? "1.0.10-alpha.1" : legacy ? "1.0.7" : "1.0.9",
    "@deepseek-ai/cordis-plugin-loader": alpha ? "1.0.6-alpha.1" : legacy ? "1.0.3" : "1.0.5",
  });
  if (alpha) {
    for (const name of ["fs", "fs-local", "working-directory"]) {
      manifest.devDependencies[`@deepseek-ai/dsh-${name}`] = version;
    }
  }
  return manifest;
}
