// Test the shipped client and host modules against an isolated DSH package set.
// Never rewrites this checkout's manifest, lockfile, or installed dependencies.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const versions = process.argv.slice(2);
if (versions.length === 0) versions.push("0.1.5-rc.2", "0.1.6-alpha.2");
if (versions.some((version) => !["0.1.5-rc.2", "0.1.6-alpha.2"].includes(version))) {
  throw new Error("Supported test hosts: 0.1.5-rc.2 and 0.1.6-alpha.2");
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
  for (const name of ["lib", "src", "test"]) await cp(join(root, name), join(cwd, name), { recursive: true });
  const manifest = structuredClone(original);
  manifest.private = true;
  delete manifest.scripts.prepack;
  for (const name of Object.keys(manifest.devDependencies)) {
    if (name.startsWith("@deepseek-ai/dsh-")) manifest.devDependencies[name] = version;
  }
  if (version === "0.1.5-rc.2") {
    delete manifest.devDependencies["@deepseek-ai/dsh-ptc-runtime"];
    manifest.devDependencies["@deepseek-ai/dsh-code-runtime"] = version;
  }
  await writeFile(join(cwd, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  // Invoke pnpm's CLI directly, avoiding shell argument concatenation on Windows.
  if (pnpmCli.endsWith(".exe")) run(pnpmCli, ["install", "--ignore-scripts"], cwd);
  else run(process.execPath, [pnpmCli, "install", "--ignore-scripts"], cwd);
  run(process.execPath, ["--test", "test/*.test.js"], cwd);
  // Keep the isolated fixture for inspection; do not delete a computed tree.
}
