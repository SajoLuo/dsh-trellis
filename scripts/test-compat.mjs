// Test the shipped client and host modules against an isolated DSH package set.
// Never rewrites this checkout's manifest, lockfile, or installed dependencies.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SUPPORTED_HOSTS, createCompatManifest } from "./compat-hosts.mjs";

const versions = process.argv.slice(2);
if (versions.length === 0) versions.push(...SUPPORTED_HOSTS);
if (versions.some((version) => !SUPPORTED_HOSTS.includes(version))) {
  throw new Error(`Supported test hosts: ${SUPPORTED_HOSTS.join(", ")}`);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const original = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || !process.env.npm_config_user_agent?.startsWith("pnpm/")) {
  throw new Error("Run this script with pnpm run test:compat [host-version].");
}
const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed (${result.status}) in ${cwd}`);
};

for (const version of versions) {
  const cwd = await mkdtemp(join(tmpdir(), `dsh-trellis-compat-${version}-`));
  console.log(`DSH ${version}: ${cwd}`);
  for (const name of ["lib", "src", "test", "scripts"]) await cp(join(root, name), join(cwd, name), { recursive: true });
  const manifest = createCompatManifest(original, version);
  await writeFile(join(cwd, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  // Invoke pnpm's CLI directly, avoiding shell argument concatenation on Windows.
  if (pnpmCli.endsWith(".exe")) run(pnpmCli, ["install", "--ignore-scripts"], cwd);
  else run(process.execPath, [pnpmCli, "install", "--ignore-scripts"], cwd);
  run(process.execPath, ["--test", "test/*.test.js"], cwd);
  // Keep the isolated fixture for inspection; do not delete a computed tree.
}
