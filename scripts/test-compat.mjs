// Test the shipped client and host modules against an isolated DSH package set.
// Never rewrites this checkout's manifest, lockfile, or installed dependencies.
import { rmSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
// Invoke pnpm's CLI directly, avoiding shell argument concatenation on Windows.
const spawnPnpm = (args, cwd, options = {}) =>
  pnpmCli.endsWith(".exe")
    ? spawnSync(pnpmCli, args, { cwd, windowsHide: true, ...options })
    : spawnSync(process.execPath, [pnpmCli, ...args], { cwd, windowsHide: true, ...options });
const runPnpm = (args, cwd) => {
  const result = spawnPnpm(args, cwd, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${pnpmCli} failed (${result.status}) in ${cwd}`);
};
const resolveStoreDir = () => {
  const result = spawnPnpm(["store", "path", "--silent"], root, { encoding: "utf8" });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
};

const storeDir = resolveStoreDir();
const installArgs = ["install", "--ignore-scripts", "--prefer-offline"];
if (storeDir) installArgs.push("--store-dir", storeDir);

const keepTmp = process.env.KEEP_COMPAT_TMP === "1";
let activeTmpDir;
const cleanupSync = (dir) => {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!keepTmp) cleanupSync(activeTmpDir);
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

for (const version of versions) {
  const cwd = await mkdtemp(join(tmpdir(), `dsh-trellis-compat-${version}-`));
  activeTmpDir = cwd;
  let succeeded = false;
  try {
    console.log(`DSH ${version}: ${cwd}`);
    for (const name of ["lib", "src", "test", "scripts"]) await cp(join(root, name), join(cwd, name), { recursive: true });
    const manifest = createCompatManifest(original, version);
    await writeFile(join(cwd, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    runPnpm(installArgs, cwd);
    run(process.execPath, ["--test", "test/*.test.js"], cwd);
    succeeded = true;
  } finally {
    activeTmpDir = undefined;
    if (succeeded && !keepTmp) {
      await rm(cwd, { recursive: true, force: true });
    } else {
      console.error(`Preserving compat temp dir: ${cwd}`);
    }
  }
}
