import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { modelServer } from "./model.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("./node_modules/@deepseek-ai/dsh/lib/bin.js", import.meta.url));
const trellis = fileURLToPath(new URL("./node_modules/@mindfoldhq/trellis/bin/trellis.js", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "dsh-trellis-e2e-"));
console.log(`E2E artifacts: ${output}`);
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|PROGRAMFILES(?:\(X86\))?|PROGRAMDATA|PROCESSOR_ARCHITECTURE)$/i.test(key)));
const run = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, env, windowsHide: true, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
const pnpm = process.env.npm_execpath;
assert.ok(pnpm && process.env.npm_config_user_agent?.startsWith("pnpm/"), "Run pnpm run test:e2e");
const manifest = JSON.parse(await readFile(join(root, "package.json")));
const published = process.argv.includes("--published");
if (!published) run(pnpm.endsWith(".exe") ? pnpm : process.execPath, [...pnpm.endsWith(".exe") ? [] : [pnpm], "pack", "--pack-destination", output], root, process.env);
const packed = { version: manifest.version, filename: `${manifest.name}-${manifest.version}.tgz` };
const artifact = published ? `${manifest.name}@${manifest.version}` : join(output, packed.filename);
const versions = {
  plugin: packed.version,
  dsh: JSON.parse(await readFile(new URL("./node_modules/@deepseek-ai/dsh/package.json", import.meta.url))).version,
  trellis: JSON.parse(await readFile(new URL("./node_modules/@mindfoldhq/trellis/package.json", import.meta.url))).version,
};

function sdk(cwd, env, observe) {
  const child = spawn(process.execPath, [cli, "--profile", "sdk"], { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const messages = [];
  const pending = new Map();
  const exited = Promise.withResolvers();
  let sequence = 0;
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  child.once("exit", code => {
    exited.resolve(code);
    for (const task of pending.values()) task.reject(new Error(`SDK exited ${code}: ${stderr.slice(-3000)}`));
  });
  const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
  createInterface({ input: child.stdout }).on("line", line => {
    try {
      const message = JSON.parse(line);
      messages.push(message);
      if (message.method === "approval/request") {
        assert.ok(["pwsh", "bash", "run_code"].includes(message.params.toolName));
        send({ jsonrpc: "2.0", id: message.id, result: { outcome: "allowed-once" } });
      } else if (message.id !== undefined && pending.has(message.id)) {
        const task = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) task.reject(new Error(JSON.stringify(message.error)));
        else task.resolve(message.result);
      } else observe(message);
    } catch (error) {
      for (const task of pending.values()) task.reject(error);
      child.kill();
    }
  });
  return {
    messages,
    async call(method, params = {}) {
      const id = ++sequence;
      const task = Promise.withResolvers();
      pending.set(id, task);
      const timer = setTimeout(() => task.reject(new Error(`${method} deadline: ${stderr.slice(-2000)}`)), 60_000);
      send({ jsonrpc: "2.0", id, method, params });
      try { return await task.promise; } finally { clearTimeout(timer); pending.delete(id); }
    },
    async close() {
      await this.call("shutdown");
      assert.equal(await exited.promise, 0);
    },
    kill: () => child.kill(),
    logs: () => stderr,
  };
}

const report = { versions, artifact, results: [] };
const permissionIndex = process.argv.indexOf("--permission");
const permission = permissionIndex < 0 ? "workspace-write" : process.argv[permissionIndex + 1];
assert.ok(["workspace-write", "danger-full-access"].includes(permission));
for (const mode of ["native", "ptc"]) {
  const directory = join(output, mode);
  const project = join(directory, "project");
  const home = join(directory, "home");
  await mkdir(project, { recursive: true });
  const env = { ...baseEnv, HOME: home, USERPROFILE: home, DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: "1", DSH_PERMISSION_MODE: permission,
    DSH_TRELLIS_E2E_KEY: "loopback-test-only", TRELLIS_CONTEXT_ID: "outer-e2e", CODEX_THREAD_ID: "outer-codex",
    PYTHONIOENCODING: "utf-8", NO_PROXY: "127.0.0.1,localhost" };
  const rootId = `e2e-${mode}-parent`;
  const model = await modelServer(mode, rootId);
  let client;
  const events = [];
  try {
    run("git", ["init", "--initial-branch", "main"], project, env);
    run("git", ["config", "user.name", "DSH E2E"], project, env);
    run("git", ["config", "user.email", "e2e@example.invalid"], project, env);
    await writeFile(join(project, "package.json"), JSON.stringify({ private: true, type: "module" }));
    await mkdir(join(project, "test"));
    await writeFile(join(project, "test/add.test.js"), 'import { test } from "node:test"; import assert from "node:assert/strict"; import { add } from "../src/add.js"; test("add contract", () => { assert.equal(add(2,3),5); assert.equal(add(-2,1),-1); assert.equal(add(0.5,0.25),0.75); });\n');
    await copyFile(new URL("./fixture.py", import.meta.url), join(project, "e2e-fixture.py"));
    await writeFile(join(directory, "trellis-init.log"), run(process.execPath, [trellis, "init", "--dsh", "-y", "-u", "e2e", "--no-monorepo"], project, env));
    run("git", ["add", "."], project, env);
    run("git", ["commit", "-m", "chore: initialize disposable Trellis fixture"], project, env);
    run("git", ["checkout", "-b", "codex/e2e"], project, env);
    await writeFile(join(directory, "plugin-install.log"), run(process.execPath, [cli, "plugin", "--profile", "sdk", "add", artifact], project, env));
    const patch = [
      { id: "llm-pi-ai", config: { providers: { e2e: { apiKeyEnv: "DSH_TRELLIS_E2E_KEY", api: "openai-completions", baseURL: model.url, models: [{ id: "scripted", contextWindow: 131072, maxTokens: 4096 }], retryPolicy: { mode: "normal", maxRetries: 0 } } } } },
      { id: "tool-executor-native", disabled: mode === "ptc" },
      { id: "tool-executor-ptc", disabled: mode !== "ptc" },
      { id: "session-title-llm", disabled: true },
      // Audit durable shutdown facts without depending on teardown notifications.
      { id: "session-persistence-jsonl", config: { root: join(home, "sessions"), compression: "none" } },
    ];
    await writeFile(join(home, "profiles/sdk/cordis.patch.yml"), JSON.stringify(patch, null, 2));
    const observe = (message) => { model.observe(message); if (message.method === "session.event") events.push(message.params); };
    const actionResult = (action, sessionId) => {
      const results = events.filter(row => row.sessionId === sessionId && ["tool/result", "tool/ptc-dispatch"].includes(row.event.type));
      const text = results.map(row => (row.event.data.message?.content ?? row.event.data.content ?? []).filter(block => block.type === "text").map(block => block.text).join("\n")).join("\n");
      assert.match(text, new RegExp(`(?:^|\\r?\\n)${action.toUpperCase()}_OK dsh_`), `${action} command did not succeed:\n${text.slice(-4000)}`);
    };
    const connect = async () => {
      client = sdk(project, env, observe);
      const hello = await client.call("initialize", { cwd: project, provider: "e2e", model: "scripted", maxTokens: 4096, approvalRequests: true });
      assert.equal(hello.serverInfo.name, "deepseek-harness-sdk-runtime");
    };
    await connect();
    const prompt = async (name, sessionId = rootId) => {
      const receipt = await client.call("session/prompt", { sessionId, contentBlocks: [{ type: "text", text: `E2E_ROOT:${name}` }] });
      assert.ok(receipt.messageId);
      await client.call("session/wait", { sessionId });
      const turn = events.filter(row => row.sessionId === sessionId && row.event.type === "turn/end").at(-1);
      assert.equal(turn.event.data.reason.kind, "completed", JSON.stringify(turn));
    };
    await prompt("bootstrap");
    actionResult("bootstrap", rootId);
    const state = JSON.parse(await readFile(join(project, ".trellis/.runtime/e2e-state.json")));
    model.setTask(state.task);
    assert.equal(state.context, `dsh_${rootId}`);
    const crumbs = () => events.filter(row => row.sessionId === rootId && row.event.type === "user/message" && row.event.data.source?.kind === "dsh-trellis");
    await prompt("observe");
    const stableCount = crumbs().length;
    assert.equal(stableCount, 2, "initial no_task and bound task must each inject once");
    assert.equal(crumbs()[0].event.data.source.status, "no_task");
    assert.equal(crumbs().at(-1).event.data.source.task, state.task);
    await prompt("observe");
    assert.equal(crumbs().length, stableCount, "unchanged workflow state must dedupe");
    await prompt("foreign", `e2e-${mode}-foreign`);
    assert.ok(events.some(row => row.sessionId.endsWith("foreign") && row.event.type === "user/message" && row.event.data.source?.kind === "dsh-trellis" && row.event.data.source.status === "no_task"));
    for (const role of ["research", "implement", "check"]) {
      await prompt(role);
      const childId = model.children.get(role);
      actionResult(role, childId);
      const calls = events.filter(row => row.sessionId === childId && ["tool/call", "tool/ptc-dispatch-start"].includes(row.event.type)).map(row => row.event.data).filter(call => call.name !== "run_code");
      assert.deepEqual(calls.map(call => call.name), ["skill", process.platform === "win32" ? "pwsh" : "bash", "send_message"]);
      const skillArgs = typeof calls[0].arguments === "string" ? JSON.parse(calls[0].arguments) : calls[0].arguments;
      assert.equal(skillArgs.name, `trellis-agent-${role}`);
      assert.ok(events.filter(row => row.sessionId === childId && ["tool/result", "tool/ptc-dispatch"].includes(row.event.type)).every(row => !(row.event.data.isError || row.event.data.message?.isError)), "role skills and reports must actually succeed");
    }
    const waitIds = new Set(events.filter(row => row.sessionId === rootId && row.event.type === "tool/call" && row.event.data.name === "trellis_wait").map(row => row.event.data.callId));
    const waits = events.filter(row => row.sessionId === rootId && (row.event.type === "tool/ptc-dispatch" && row.event.data.name === "trellis_wait" || row.event.type === "tool/result" && waitIds.has(row.event.data.message.toolCallId)));
    assert.equal(waits.length, 3, "each role needs its own wait result");
    assert.ok(waits.every(row => /completed; settlement notice delivery is unverified/.test(JSON.stringify(row.event.data))), JSON.stringify(waits));
    run(process.execPath, ["--test"], project, env);
    await client.close();
    await writeFile(join(directory, "first-sdk-stderr.log"), client.logs());
    await connect();
    await client.call("session/resume", { sessionId: rootId });
    const beforeResumePrompt = crumbs().length;
    await prompt("observe");
    assert.equal(crumbs().length, beforeResumePrompt, "replayed projection must dedupe after process restart");
    const beforeInvalid = events.length;
    await prompt("invalid");
    assert.ok(events.slice(beforeInvalid).some(row => row.sessionId === rootId && ["tool/result", "tool/ptc-dispatch"].includes(row.event.type) && (row.event.data.isError || row.event.data.message?.isError) && JSON.stringify(row.event.data).includes("direct continuable")));
    await prompt("finish");
    actionResult("finish", rootId);
    assert.equal(crumbs().at(-1).event.data.source.status, "no_task");
    assert.ok(!(await readdir(join(project, ".trellis/tasks"))).some(name => name.endsWith("-e2e-add")));
    await client.call("session/prompt", { sessionId: rootId, contentBlocks: [{ type: "text", text: "E2E_ROOT:cancel" }] });
    await Promise.race([model.waitStarted.promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("cancel wait not started")), 30_000); timer.unref(); })]);
    await client.close();
    const sessionRoot = join(home, "sessions");
    const files = await readdir(sessionRoot, { recursive: true });
    const cancelledFile = files.find(file => file.endsWith(join(model.children.get("cancel"), "session.v4.jsonl")));
    assert.ok(cancelledFile, "cancelled child must have a durable session");
    const cancelled = (await readFile(join(sessionRoot, cancelledFile), "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(cancelled.some(event => event.type === "turn/end" && event.data.reason.kind === "aborted"), "shutdown must persist the child's aborted turn");
    report.results.push({ mode, permission: env.DSH_PERMISSION_MODE, requests: model.requests.length, assertions: ["packaged install", "native session identity", "Trellis binding", "breadcrumb dedupe", "foreign session isolation", "three role skills", "real child settlement waits", "real shell tests", "process restart/resume", "invalid child rejection", "archive and journal", "shutdown cancels active child/wait"], status: "passed" });
    await writeFile(join(directory, "events.json"), JSON.stringify(events, null, 2));
    await writeFile(join(directory, "model-requests.json"), JSON.stringify(model.requests, null, 2));
    await writeFile(join(directory, "sdk-stderr.log"), client.logs());
    console.log(`${mode}: passed (${model.requests.length} loopback requests)`);
  } catch (error) {
    report.results.push({ mode, permission, status: "failed", error: error.message });
    await writeFile(join(directory, "failure.txt"), error.stack + "\n" + (client?.logs() ?? ""));
    await writeFile(join(directory, "wire.json"), JSON.stringify(client?.messages ?? [], null, 2));
    await writeFile(join(directory, "events.json"), JSON.stringify(events, null, 2));
    await writeFile(join(directory, "model-requests.json"), JSON.stringify(model.requests, null, 2));
    client?.kill();
    throw error;
  } finally { await model.close(); await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2)); }
}
console.log(JSON.stringify(report, null, 2));
