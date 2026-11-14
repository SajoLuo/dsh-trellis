import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { Context } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { BREADCRUMB_PROJECTION_KEY as KEY } from "../lib/breadcrumb-projection.js";
import { createBreadcrumbComposer, isBreadcrumbMessage } from "../lib/breadcrumb.js";
import { dshContextKey } from "../lib/session-env.js";
import { sessionRuntime } from "./helpers/session-runtime.js";
import * as trellisPlugin from "../lib/index.js";
import { apply, inject, insertBreadcrumbDecision } from "../lib/index.js";

const require = createRequire(import.meta.url);
const settingsModule = (() => {
  try {
    return require("@deepseek-ai/dsh-settings");
  } catch {
    return {};
  }
})();

function harness({ settings = false, projectionRegistry } = {}) {
  const effects = [];
  const listeners = [];
  const registrations = [];
  const active = new Set();
  const settingsState = {
    value: {},
    watcher: undefined,
    registration: undefined,
  };
  const ctx = {
    fiber: { state: 0 },
  };
  const settingsCtx = {
    settings: {
      register(namespace, schema, options) {
        settingsState.registration = { namespace, schema, options };
        settingsState.value = options.base;
        return {
          get: () => settingsState.value,
          watch(callback) {
            settingsState.watcher = callback;
            return () => {
              settingsState.watcher = undefined;
            };
          },
        };
      },
      installSection(owner, namespace, schema, entry, hooks) {
        const scope = this.register(namespace, schema, { base: entry });
        hooks.setSource(() => scope.get());
        hooks.onChange();
        settingsCtx.effect(() => () => {
          if (owner.fiber.state === 5) return;
          hooks.setSource(() => entry);
          hooks.onChange();
        });
        scope.watch(() => {
          if (owner.fiber.state !== 5) hooks.onChange();
        });
      },
    },
    effect(callback, label) {
      effects.push({ owner: "settings", label, dispose: callback() });
    },
  };
  Object.assign(ctx, {
    effect(callback, label) {
      effects.push({ owner: "plugin", label, dispose: callback() });
    },
    on(event, listener) {
      const entry = { event, listener };
      listeners.push(entry);
      active.add(`listener:${event}`);
      return () => {
        const index = listeners.indexOf(entry);
        if (index !== -1) listeners.splice(index, 1);
        if (!listeners.some((item) => item.event === event)) {
          active.delete(`listener:${event}`);
        }
      };
    },
    inject(services, callback) {
      registrations.push(`inject:${services.join(",")}`);
      if (settings && services.includes("settings")) callback(settingsCtx);
    },
    commands: {
      register(command) {
        registrations.push(`command:${command.name}`);
        active.add(`command:${command.name}`);
        return () => active.delete(`command:${command.name}`);
      },
    },
    subagents: {},
    sessionProjections: {
      register(definition) {
        registrations.push(`projection:${definition.key}`);
        active.add(`projection:${definition.key}`);
        const registration = projectionRegistry?.register(definition);
        const markInactive = () => {
          active.delete(`projection:${definition.key}`);
        };
        const dispose = () => {
          markInactive();
          return registration?.();
        };
        if (typeof registration?.then !== "function") return dispose;
        const wrapValue = (value) => (
          typeof value?.dispose === "function"
            ? {
                ...value,
                dispose() {
                  markInactive();
                  return value.dispose();
                },
              }
            : value
        );
        return Object.assign(dispose, {
          then(onFulfilled, onRejected) {
            return registration.then(
              (value) => {
                const wrapped = wrapValue(value);
                return onFulfilled ? onFulfilled(wrapped) : wrapped;
              },
              (error) => {
                markInactive();
                if (onRejected) return onRejected(error);
                throw error;
              },
            );
          },
        });
      },
      stateOf(session, key) {
        return projectionRegistry ? projectionRegistry.stateOf(session, key) : {};
      },
    },
    shellEnv: {
      register(contributor) {
        registrations.push(`shell-env:${contributor.name}`);
        active.add(`shell-env:${contributor.name}`);
        return () => active.delete(`shell-env:${contributor.name}`);
      },
    },
    tools: {
      register(tool) {
        registrations.push(`tool:${tool.name}`);
        active.add(`tool:${tool.name}`);
        return () => active.delete(`tool:${tool.name}`);
      },
    },
  });
  return {
    ctx,
    effects,
    listeners,
    registrations,
    active,
    settingsState,
    publishSettings(value) {
      settingsState.value = value;
      settingsState.watcher?.();
    },
    detachSettings({ unloading = false } = {}) {
      if (unloading) ctx.fiber.state = 5;
      for (const effect of effects.filter(({ owner }) => owner === "settings")) {
        effect.dispose();
      }
    },
    disposePlugin() {
      ctx.fiber.state = 5;
      return Promise.all(effects.filter(({ owner }) => owner === "plugin")
        .map((effect) => effect.dispose()));
    },
  };
}

test("disabled plugin keeps only the optional settings bridge", () => {
  const state = harness();
  apply(state.ctx, { enabled: false });
  assert.deepEqual(
    state.effects.map(({ label }) => label),
    ["dsh-trellis.runtime"],
  );
  assert.deepEqual(state.listeners, []);
  assert.deepEqual(state.registrations, ["inject:settings"]);
  assert.deepEqual([...state.active], []);
});

test("startup waits for async projection registration and rolls back a rejected acquisition", async () => {
  const state = harness();
  const pending = Promise.withResolvers();
  state.ctx.sessionProjections.register = () => pending.promise;
  state.ctx.sessionProjections.stateOf = () => assert.fail("no legacy reads after failure");
  const startup = apply(state.ctx, {});
  let ready = false;
  startup.then(() => { ready = true; }, () => {});
  await Promise.resolve();
  assert.equal(ready, false);
  const failure = new Error("projection key conflict");
  pending.reject(failure);
  await assert.rejects(startup, (error) => error === failure);
  assert.deepEqual([...state.active], []);
  state.disposePlugin();
});

test("unload while acquiring a projection releases the late handle and pre-step remains unchanged", async () => {
  const state = harness();
  const pending = Promise.withResolvers();
  let disposals = 0;
  state.ctx.sessionProjections.register = () => pending.promise;
  const startup = apply(state.ctx, {});
  const listener = state.listeners.find(({ event }) => event === "agent/pre-step").listener;
  const decision = { kind: "continue", messages: [] };
  const step = listener({}, async () => decision);
  state.disposePlugin();
  pending.resolve({ stateOf: () => assert.fail("unloaded listener cannot read"), async dispose() { disposals++; } });
  assert.equal(await startup, undefined);
  assert.equal(await step, decision);
  assert.equal(disposals, 1);
  assert.deepEqual([...state.active], []);
});

test("runtime teardown awaits the acquired handle's asynchronous cleanup", async () => {
  const state = harness();
  const cleanup = Promise.withResolvers();
  state.ctx.sessionProjections.register = async () => ({
    stateOf: () => ({}), dispose: () => cleanup.promise,
  });
  await apply(state.ctx, {});
  let finished = false;
  const unload = state.disposePlugin().then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  cleanup.resolve();
  await unload;
  assert.equal(finished, true);
  assert.deepEqual([...state.active], []);
});

test("enabled plugin registers commands, wait tool, one pre-step listener, and disposes them", () => {
  const state = harness();
  apply(state.ctx, {});
  assert.deepEqual(
    state.effects.map(({ label }) => label),
    ["dsh-trellis.runtime"],
  );
  assert.deepEqual(
    state.listeners.map(({ event }) => event),
    ["agent/pre-step"],
  );
  assert.deepEqual(state.registrations.filter((entry) => !entry.startsWith("inject:")).sort(), [
    "command:trellis-doctor",
    "command:trellis-finish",
    "command:trellis-status",
    `projection:${KEY}`,
    "shell-env:dsh-trellis-session",
    "tool:trellis_wait",
  ]);

  for (const effect of state.effects) effect.dispose();
  assert.deepEqual([...state.active], []);
});

test("settings namespace remounts the plugin from saved values", () => {
  const state = harness({ settings: true });
  apply(state.ctx, { enabled: false, maxBytes: 1024 });

  assert.equal(state.settingsState.registration.namespace, "dsh-trellis");
  assert.deepEqual(state.settingsState.registration.options, {
    base: {
      enabled: false,
      maxBytes: 1024,
    },
  });
  assert.deepEqual([...state.active], []);

  state.publishSettings({ enabled: true, commandsEnabled: false });
  assert.deepEqual([...state.active].sort(), [
    "listener:agent/pre-step",
    `projection:${KEY}`,
    "shell-env:dsh-trellis-session",
    "tool:trellis_wait",
  ]);

  state.publishSettings({ enabled: true, commandsEnabled: true });
  assert.deepEqual([...state.active].sort(), [
    "command:trellis-doctor",
    "command:trellis-finish",
    "command:trellis-status",
    "listener:agent/pre-step",
    `projection:${KEY}`,
    "shell-env:dsh-trellis-session",
    "tool:trellis_wait",
  ]);

  state.publishSettings({ enabled: false });
  assert.deepEqual([...state.active], []);
});

test("settings provider detach falls back to the profile composition entry", () => {
  const state = harness({ settings: true });
  apply(state.ctx, { enabled: false });

  state.publishSettings({ enabled: true, commandsEnabled: false });
  assert.deepEqual([...state.active].sort(), [
    "listener:agent/pre-step",
    `projection:${KEY}`,
    "shell-env:dsh-trellis-session",
    "tool:trellis_wait",
  ]);

  state.detachSettings();
  assert.deepEqual([...state.active], []);
});

test("plugin teardown does not remount the profile entry while settings detaches", () => {
  const state = harness({ settings: true });
  apply(state.ctx, { enabled: false });

  state.publishSettings({ enabled: true, commandsEnabled: false });
  const mounted = [...state.active].sort();
  state.detachSettings({ unloading: true });
  assert.deepEqual([...state.active].sort(), mounted);

  state.disposePlugin();
  assert.deepEqual([...state.active], []);
});

test("breadcrumb insertion preserves host-owned pre-step decision fields", () => {
  const claimed = { role: "system", content: "workspace instructions" };
  const tail = { role: "user", content: "task" };
  const desired = { role: "user", content: "[workflow-state:in_progress]" };
  const decision = {
    kind: "enter",
    messages: [claimed, tail],
    startsRequestSeries: true,
  };

  assert.deepEqual(insertBreadcrumbDecision(decision, [claimed], desired), {
    kind: "enter",
    messages: [claimed, desired, tail],
    startsRequestSeries: true,
  });
});

const prompt = (text) => createUserMessage({ content: [{ type: "text", text }] });
const fixtureCwd = fileURLToPath(new URL("./fixtures/breadcrumb-project", import.meta.url));
const fixtureConfig = { projectRootMarkers: [".trellis"], commandsEnabled: false };

function inbox(initial = []) {
  return {
    nextStep: [...initial],
    prepend(_lane, message) { this.nextStep.unshift(message); },
    replace(id, message) { this.nextStep[this.nextStep.findIndex((entry) => entry.id === id)] = message; },
    remove(id) { this.nextStep = this.nextStep.filter((entry) => entry.id !== id); },
  };
}

async function preStepRuntime(t, config = {}, cwd = fixtureCwd) {
  const ctx = await sessionRuntime(t);
  const state = harness({ settings: true, projectionRegistry: ctx.sessionProjections });
  apply(state.ctx, { ...fixtureConfig, ...config });
  t.after(() => state.disposePlugin());
  const agent = {
    session: ctx.sessions.create("pre-step", { meta: { cwd } }),
    inbox: inbox(),
  };
  const run = async ({ messages = [prompt("Continue")], decision, step = 2, signal } = {}) => {
    const input = decision ?? { kind: "enter", messages, startsRequestSeries: true };
    const listener = state.listeners.filter((entry) => entry.event === "agent/pre-step").at(-1).listener;
    return listener({ agent, messages, step, signal }, async () => input);
  };
  return { ctx, state, agent, run };
}

test("plugin declares the projection service as a required host capability", () => {
  assert.ok(inject.includes("sessionProjections"));
});

test("pre-step inserts once, clears stale inbox, and dedupes immediately after settings remount", async (t) => {
  const { ctx, state, agent, run } = await preStepRuntime(t);
  const first = await run();
  const message = first.messages.find(isBreadcrumbMessage);
  assert.ok(message);
  assert.equal(first.startsRequestSeries, true);
  agent.session.append("user/message", message, { surfaceOp: "append" });
  const unrelated = prompt("Keep this queued prompt");
  agent.inbox = inbox([message, unrelated]);
  assert.equal((await run()).messages.some(isBreadcrumbMessage), false);
  assert.deepEqual(agent.inbox.nextStep, [unrelated]);
  state.publishSettings({ ...fixtureConfig, enabled: false });
  assert.equal(ctx.sessionProjections.stateOf(agent.session, KEY), undefined);
  state.publishSettings({ ...fixtureConfig, enabled: true });
  assert.equal((await run()).messages.some(isBreadcrumbMessage), false);

  state.publishSettings({ ...fixtureConfig, maxBytes: 24 });
  const smaller = (await run()).messages.find(isBreadcrumbMessage);
  assert.ok(smaller);
  assert.notDeepEqual(smaller.content, message.content);
  assert.equal(smaller.source.digest, message.source.digest);
});

test("pre-step reinjects after compaction and dedupes a newly resumed session", async (t) => {
  const { ctx, agent, run } = await preStepRuntime(t);
  const first = (await run()).messages.find(isBreadcrumbMessage);
  const committed = agent.session.append("user/message", first, { surfaceOp: "append" });
  agent.session = ctx.sessions.create("resumed-pre-step", {
    seed: [committed], meta: { cwd: fixtureCwd },
  });
  assert.equal((await run()).messages.some(isBreadcrumbMessage), false);
  agent.session.append("user/message", prompt("Compacted"), {
    surfaceOp: { op: "replace", startSeq: 0, endSeq: 0 }, sourceEventSeqs: [0],
  });
  assert.ok((await run()).messages.find(isBreadcrumbMessage));
});

test("reject and empty first-step decisions keep exactly one pending breadcrumb", async (t) => {
  const { agent, run } = await preStepRuntime(t);
  const decision = { kind: "reject", reason: "host-owned reason" };
  assert.equal(await run({ decision }), decision);
  const pending = agent.inbox.nextStep[0];
  assert.ok(isBreadcrumbMessage(pending));
  await run({ decision });
  assert.deepEqual(agent.inbox.nextStep, [pending]);
  const empty = { kind: "enter", messages: [], startsRequestSeries: true };
  assert.equal(await run({ decision: empty, step: 1 }), empty);
  assert.deepEqual(agent.inbox.nextStep, [pending]);
  const result = await run();
  assert.equal(result.messages.filter(isBreadcrumbMessage).length, 1);
  assert.deepEqual(agent.inbox.nextStep, []);
});

test("disabling removes only queued Trellis breadcrumbs and re-enabling reinjects once", async (t) => {
  const { state, agent, run } = await preStepRuntime(t);
  const unrelated = prompt("Keep the user's queued input");
  agent.inbox.nextStep.push(unrelated);
  await run({ decision: { kind: "reject" } });
  assert.equal(agent.inbox.nextStep.filter(isBreadcrumbMessage).length, 1);
  state.publishSettings({ ...fixtureConfig, enabled: false });
  assert.deepEqual(agent.inbox.nextStep, [unrelated]);
  state.publishSettings(fixtureConfig);
  assert.equal((await run()).messages.filter(isBreadcrumbMessage).length, 1);
});

test("an unloaded pre-step listener cannot inject after its downstream continuation resolves", async (t) => {
  const { state, agent } = await preStepRuntime(t);
  const listener = state.listeners.at(-1).listener;
  let release;
  const decision = { kind: "enter", messages: [prompt("Continue")] };
  const pending = listener({ agent, messages: decision.messages, step: 2 }, () => new Promise((resolve) => { release = resolve; }));
  state.disposePlugin();
  release(decision);
  assert.equal(await pending, decision);
  assert.deepEqual(agent.inbox.nextStep, []);
});

test("skip, disabled byte budget, missing project, and cancellation do not inject", async (t) => {
  const { state, agent, run, ctx } = await preStepRuntime(t);
  await run({ decision: { kind: "reject" } });
  assert.equal(agent.inbox.nextStep.length, 1);
  assert.equal((await run({ messages: [prompt("no-trellis")] })).messages.some(isBreadcrumbMessage), false);
  assert.equal(agent.inbox.nextStep.length, 0);
  state.publishSettings({ ...fixtureConfig, maxBytes: 0 });
  assert.equal((await run()).messages.some(isBreadcrumbMessage), false);
  state.publishSettings({ ...fixtureConfig, projectRootMarkers: [".nonexistent-trellis-test-marker"] });
  assert.equal((await run()).messages.some(isBreadcrumbMessage), false);
  state.publishSettings(fixtureConfig);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(run({ signal: controller.signal }), { name: "AbortError" });
  assert.deepEqual(ctx.sessionProjections.stateOf(agent.session, KEY), {});
  assert.deepEqual(agent.inbox.nextStep, []);
});

async function temporaryProject(t) {
  const root = await mkdtemp(join(tmpdir(), "dsh-trellis-isolation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessions = join(root, ".trellis", ".runtime", "sessions");
  const task = ".trellis/tasks/demo";
  const taskJson = join(root, task, "task.json");
  await mkdir(sessions, { recursive: true });
  await mkdir(join(root, task), { recursive: true });
  await writeFile(taskJson, JSON.stringify({ status: "planning" }));
  // Deliberately use an old workflow without task_error to cover upgrade order.
  await writeFile(join(root, ".trellis", "workflow.md"), [
    "[workflow-state:no_task]\nNo active task.\n[/workflow-state:no_task]",
    "[workflow-state:planning]\nPlan the task.\n[/workflow-state:planning]",
  ].join("\n"));
  return { root, sessions, task, taskJson };
}

test("a reused blank session keeps its binding and injects once on its first submission", async (t) => {
  const project = await temporaryProject(t);
  const { ctx, agent, run } = await preStepRuntime(t, {}, project.root);
  const blank = agent.session;
  const identity = dshContextKey(blank.header.id);
  const pointer = join(project.sessions, `${identity}.json`);
  const binding = JSON.stringify({ current_task: project.task });
  await writeFile(pointer, binding);

  // Model the plugin boundary after navigation; the real New Session UI is
  // verified separately, not reimplemented by this test.
  agent.session = ctx.sessions.create("other-conversation", { meta: { cwd: project.root } });
  const other = (await run({ step: 1 })).messages.find(isBreadcrumbMessage);
  assert.equal(other.source.status, "no_task");
  assert.equal(other.source.task, null);

  agent.session = blank;
  assert.equal(blank.snapshotEvents().length, 0, "navigation alone does not commit a draft or breadcrumb");
  const submitted = prompt("Keep this restored draft and its native task binding.");
  const first = await run({ step: 1, messages: [submitted] });
  const message = first.messages.find(isBreadcrumbMessage);
  assert.equal(message.source.status, "planning");
  assert.equal(message.source.task, project.task);
  assert.equal(first.messages.filter(isBreadcrumbMessage).length, 1);
  assert.ok(first.messages.includes(submitted), "the submitted draft is preserved");
  for (const item of first.messages) blank.append("user/message", item, { surfaceOp: "append" });
  assert.equal((await run()).messages.some(isBreadcrumbMessage), false);
  assert.equal(dshContextKey(agent.session.header.id), identity);
  assert.equal(await readFile(pointer, "utf8"), binding);
});

test("pre-step isolates real session files and recovers task_error across settings reload and unbind", async (t) => {
  const project = await temporaryProject(t);
  const { agent, state, run } = await preStepRuntime(t, {}, project.root);
  const foreign = join(project.sessions, "dsh_other.json");
  const binding = JSON.stringify({ current_task: project.task });
  await writeFile(foreign, binding);
  const own = join(project.sessions, `${dshContextKey(agent.session.header.id)}.json`);
  const commitBreadcrumb = async () => {
    const message = (await run()).messages.find(isBreadcrumbMessage);
    assert.ok(message);
    agent.session.append("user/message", message, { surfaceOp: "append" });
    return message;
  };

  const unbound = await commitBreadcrumb();
  assert.equal(unbound.source.status, "no_task");
  assert.equal(unbound.source.task, null);
  await writeFile(own, binding);
  const planning = await commitBreadcrumb();
  assert.equal(planning.source.status, "planning");
  assert.equal(planning.source.task, project.task);

  await writeFile(project.taskJson, "{broken");
  const error = await commitBreadcrumb();
  assert.equal(error.source.status, "task_error");
  assert.equal(error.source.task, project.task);
  assert.match(error.content[0].text, /Do not create or activate another task/);
  assert.match(error.content[0].text, /Active task: \.trellis\/tasks\/demo/);
  assert.equal((await run()).messages.some(isBreadcrumbMessage), false);
  state.publishSettings({ ...fixtureConfig, enabled: false });
  state.publishSettings({ ...fixtureConfig, enabled: true });
  assert.equal((await run()).messages.some(isBreadcrumbMessage), false);
  assert.equal(await readFile(project.taskJson, "utf8"), "{broken");

  await writeFile(project.taskJson, JSON.stringify({ status: "planning" }));
  const repaired = await commitBreadcrumb();
  assert.equal(repaired.source.status, "planning");
  assert.notEqual(repaired.source.digest, error.source.digest);
  assert.equal(repaired.source.digest, planning.source.digest);
  await rm(own);
  assert.equal((await commitBreadcrumb()).source.status, "no_task");
  assert.equal(await readFile(foreign, "utf8"), binding);
});

test("composer without a native session id never borrows the generic dsh pointer", async (t) => {
  const project = await temporaryProject(t);
  const binding = JSON.stringify({ current_task: project.task });
  await writeFile(join(project.sessions, "dsh.json"), binding);
  const composer = createBreadcrumbComposer({
    maxBytes: 4096, skipKeyword: "no-trellis", projectRootMarkers: [".trellis"],
  }, {});
  const message = await composer.compose({ session: { header: { cwd: project.root } } }, [], new AbortController().signal);
  assert.equal(message.source.status, "no_task");
  assert.equal(message.source.task, null);
  assert.equal(await readFile(join(project.sessions, "dsh.json"), "utf8"), binding);
});

test("insertBreadcrumbDecision strips stale breadcrumbs and matches claimed messages by id", () => {
  const sys = { id: "sys-1", role: "system", content: "workspace" };
  const clonedSys = { ...sys };
  const stale = createUserMessage({
    id: "crumb-old",
    content: [{ type: "text", text: "old" }],
    source: { kind: "dsh-trellis", form: "breadcrumb", status: "no_task", task: null, digest: "a" },
  });
  const desired = createUserMessage({
    id: "crumb-new",
    content: [{ type: "text", text: "new" }],
    source: { kind: "dsh-trellis", form: "breadcrumb", status: "planning", task: "t", digest: "b" },
  });
  const tail = { id: "u-1", role: "user", content: "hi" };

  assert.deepEqual(
    insertBreadcrumbDecision(
      { kind: "enter", messages: [clonedSys, { ...stale }, tail], startsRequestSeries: true },
      [sys, stale],
      desired,
    ),
    {
      kind: "enter",
      messages: [clonedSys, desired, tail],
      startsRequestSeries: true,
    },
  );

  assert.deepEqual(
    insertBreadcrumbDecision(
      { kind: "enter", messages: [stale, tail] },
      [stale],
      desired,
    ),
    {
      kind: "enter",
      messages: [desired, tail],
    },
  );
});

test("claimed inbox breadcrumbs do not leak or duplicate across step transitions", async (t) => {
  const project = await temporaryProject(t);
  const { ctx, agent, run } = await preStepRuntime(t, {}, project.root);
  const claimFromInbox = (extra = []) => {
    const claimed = [...extra, ...agent.inbox.nextStep];
    agent.inbox.nextStep = [];
    return claimed.map((entry) => ({ ...entry }));
  };

  // Step 1 queues breadcrumb in inbox.nextStep via reject
  await run({ decision: { kind: "reject" }, step: 1 });
  assert.equal(agent.inbox.nextStep.filter(isBreadcrumbMessage).length, 1);

  // Step 2 claims queued breadcrumb, then skips -> must strip stale breadcrumb
  const step2Claimed = claimFromInbox([prompt("please no-trellis")]);
  const skipped = await run({
    messages: step2Claimed,
    decision: { kind: "enter", messages: step2Claimed, startsRequestSeries: true },
    step: 2,
  });
  assert.equal(skipped.messages.some(isBreadcrumbMessage), false);
  assert.equal(skipped.messages.length, 1);

  // Queue again then suppress via subagent no_task on step 2
  await run({ decision: { kind: "reject" }, step: 1 });
  const subClaimed = claimFromInbox([prompt("continue")]);
  agent.session = ctx.sessions.create("sub-claim", { meta: { cwd: project.root, origin: "subagent" } });
  const subResult = await run({
    messages: subClaimed,
    decision: { kind: "enter", messages: subClaimed },
    step: 2,
  });
  assert.equal(subResult.messages.some(isBreadcrumbMessage), false);

  // Bind task so desired changes from no_task -> planning; old claimed breadcrumb replaced cleanly
  agent.session = ctx.sessions.create("parent-claim", { meta: { cwd: project.root } });
  await run({ decision: { kind: "reject" }, step: 1 });
  const ownPointer = join(project.sessions, `${dshContextKey(agent.session.header.id)}.json`);
  await writeFile(ownPointer, JSON.stringify({ current_task: project.task }));
  const transitionClaimed = claimFromInbox([prompt("start work")]);
  const transitioned = await run({
    messages: transitionClaimed,
    decision: { kind: "enter", messages: transitionClaimed },
    step: 2,
  });
  const crumbs = transitioned.messages.filter(isBreadcrumbMessage);
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0].source.status, "planning");

  // Step > 1 reject decision carrying claimed stale breadcrumb strips it from decision.messages
  const rejectWithMsgs = { kind: "reject", messages: [...transitioned.messages] };
  const cleanedReject = await run({ messages: transitioned.messages, decision: rejectWithMsgs, step: 2 });
  assert.equal(cleanedReject.messages.some(isBreadcrumbMessage), false);
  assert.equal(agent.inbox.nextStep.filter(isBreadcrumbMessage).length, 1);
});

test("stopAll isolates disposer errors and clearInbox tolerates inactive inbox projection", async () => {
  const state = harness();
  let disposedProjection = false;
  state.ctx.commands.register = (cmd) => {
    state.active.add(`command:${cmd.name}`);
    return () => {
      state.active.delete(`command:${cmd.name}`);
      if (cmd.name === "trellis-status") {
        throw new Error("command disposer boom");
      }
    };
  };
  state.ctx.sessionProjections.register = () => () => {
    disposedProjection = true;
    state.active.delete(`projection:${KEY}`);
  };
  apply(state.ctx, {});
  await assert.rejects(async () => state.disposePlugin(), /command disposer boom/);
  assert.equal(disposedProjection, true);
  assert.deepEqual([...state.active], []);

  const inboxState = harness();
  let inactive = false;
  let queued = [];
  let inboxDisposedProjection = false;
  inboxState.ctx.sessionProjections.register = () => () => {
    inboxDisposedProjection = true;
    inboxState.active.delete(`projection:${KEY}`);
  };
  apply(inboxState.ctx, fixtureConfig);
  const listener = inboxState.listeners.at(-1).listener;
  const throwingInbox = {
    get nextStep() {
      if (inactive) throw new Error("its projection registration is not active");
      return queued;
    },
    prepend(_lane, message) { queued.unshift(message); },
    replace(id, message) { queued[queued.findIndex((m) => m.id === id)] = message; },
    remove(id) { queued = queued.filter((m) => m.id !== id); },
  };
  await listener(
    {
      agent: {
        session: { header: { cwd: fixtureCwd, id: "s-inactive" }, surface: { nodes: [] } },
        inbox: throwingInbox,
      },
      step: 1,
    },
    async () => ({ kind: "reject" }),
  );
  assert.equal(queued.length, 1);
  inactive = true;
  await inboxState.disposePlugin();
  assert.equal(inboxDisposedProjection, true);
  assert.deepEqual([...inboxState.active], []);
});

test("async teardown serializes volatile-update toggles and ready failure clears mountedConfig", async () => {
  const state = harness();
  const runtimeActive = () =>
    [...state.active].filter((entry) => entry !== "listener:loader/volatile-update");
  const events = [];
  let handleIndex = 0;
  let firstCleanup;
  let pendingAcquire;
  state.ctx.sessionProjections.register = () => {
    const id = ++handleIndex;
    events.push(`register:${id}`);
    if (id === 1) {
      state.active.add(`projection:${KEY}:1`);
      return Promise.resolve({
        stateOf: () => ({}),
        dispose() {
          events.push("dispose-start:1");
          firstCleanup = Promise.withResolvers();
          return firstCleanup.promise.then(() => {
            events.push("dispose-end:1");
            state.active.delete(`projection:${KEY}:1`);
          });
        },
      });
    }
    if (id === 2) {
      pendingAcquire = Promise.withResolvers();
      return pendingAcquire.promise.then((handle) => {
        state.active.add(`projection:${KEY}:2`);
        return handle;
      });
    }
    state.active.add(`projection:${KEY}:${id}`);
    return Promise.resolve({
      stateOf: () => ({}),
      dispose() {
        events.push(`dispose:${id}`);
        state.active.delete(`projection:${KEY}:${id}`);
      },
    });
  };

  let maxBytes = 4096;
  let enabled = true;
  const live = (getter) => ({ [Symbol.for("cosmokit.volatile.write")]: true, get: getter });
  const rawConfig = {
    enabled: live(() => enabled),
    maxBytes: live(() => maxBytes),
    commandsEnabled: false,
  };
  await apply(state.ctx, rawConfig);
  const emitVolatile = () =>
    state.listeners.find((l) => l.event === "loader/volatile-update").listener();

  // Rapid volatile-update toggles while handle 1's async dispose is pending:
  enabled = false;
  emitVolatile();
  enabled = true;
  maxBytes = 1024;
  emitVolatile();

  await Promise.resolve();
  // Must NOT register handle 2 before handle 1 finishes disposing; disabled intermediate step skipped
  assert.deepEqual(events, ["register:1", "dispose-start:1"]);

  const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));
  firstCleanup.resolve();
  await flushMicrotasks();
  assert.deepEqual(events, ["register:1", "dispose-start:1", "dispose-end:1", "register:2"]);

  // Failing handle 2 clears mountedConfig so an identical retry succeeds
  pendingAcquire.reject(new Error("transient register error"));
  await flushMicrotasks();
  assert.deepEqual(runtimeActive(), []);

  emitVolatile();
  await flushMicrotasks();
  assert.equal(handleIndex, 3);
  assert.ok(state.active.has(`projection:${KEY}:3`));
  await state.disposePlugin();
  assert.deepEqual(runtimeActive(), []);
});

test("plugin disposal while async volatile-update teardown is pending prevents stale mount", async () => {
  const state = harness();
  const runtimeActive = () =>
    [...state.active].filter((entry) => entry !== "listener:loader/volatile-update");
  let cleanup;
  let registrations = 0;
  state.ctx.sessionProjections.register = () => {
    registrations++;
    state.active.add(`projection:${KEY}:${registrations}`);
    if (registrations === 1) {
      return Promise.resolve({
        stateOf: () => ({}),
        dispose() {
          cleanup = Promise.withResolvers();
          return cleanup.promise.then(() => {
            state.active.delete(`projection:${KEY}:1`);
          });
        },
      });
    }
    return Promise.resolve({ stateOf: () => ({}), dispose() {} });
  };
  let maxBytes = 4096;
  const raw = {
    maxBytes: { [Symbol.for("cosmokit.volatile.write")]: true, get: () => maxBytes },
    commandsEnabled: false,
  };
  await apply(state.ctx, raw);
  maxBytes = 512;
  state.listeners.find((l) => l.event === "loader/volatile-update").listener();
  let disposed = false;
  const unloading = state.disposePlugin().then(() => { disposed = true; });
  await Promise.resolve();
  assert.equal(disposed, false);
  cleanup.resolve();
  await unloading;
  assert.equal(disposed, true);
  assert.equal(registrations, 1);
  assert.deepEqual(runtimeActive(), []);
});

test("volatile-update synchronously registers commands, tools, shellEnv, and pre-step while async teardown is pending", async () => {
  const state = harness();
  const runtimeActive = () =>
    [...state.active].filter((entry) => entry !== "listener:loader/volatile-update");
  let firstCleanup;
  let registerCount = 0;
  state.ctx.sessionProjections.register = () => {
    const id = ++registerCount;
    state.active.add(`projection:${KEY}:${id}`);
    return Promise.resolve({
      stateOf: () => ({}),
      dispose() {
        if (id === 1) {
          firstCleanup = Promise.withResolvers();
          return firstCleanup.promise.then(() => {
            state.active.delete(`projection:${KEY}:1`);
          });
        }
        state.active.delete(`projection:${KEY}:${id}`);
      },
    });
  };
  let commandsEnabled = false;
  let maxBytes = 4096;
  const live = (getter) => ({ [Symbol.for("cosmokit.volatile.write")]: true, get: getter });
  await apply(state.ctx, {
    commandsEnabled: live(() => commandsEnabled),
    maxBytes: live(() => maxBytes),
  });
  const emitVolatile = () =>
    state.listeners.find((l) => l.event === "loader/volatile-update").listener();

  commandsEnabled = true;
  maxBytes = 1024;
  emitVolatile();

  // Synchronous Cordis surfaces must already be registered before async projection teardown resolves.
  assert.deepEqual(runtimeActive().sort(), [
    "command:trellis-doctor",
    "command:trellis-finish",
    "command:trellis-status",
    "listener:agent/pre-step",
    `projection:${KEY}:1`,
    "shell-env:dsh-trellis-session",
    "tool:trellis_wait",
  ]);
  assert.equal(registerCount, 1);

  firstCleanup.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(registerCount, 2);
  assert.ok(state.active.has(`projection:${KEY}:2`));
  await state.disposePlugin();
  assert.deepEqual(runtimeActive(), []);
});

test("real Loader + SessionProjectionRegistry keep commands, tools, and shellEnv synchronously live after entry.update()", {
  skip: typeof settingsModule.SettingsForms !== "function",
}, async (t) => {
  const host = await sessionRuntime(t);
  const commands = new Set();
  const tools = new Set();
  const shellEnvs = new Set();
  const registerInto = (set, keyFor) => ({
    register(item) {
      const key = keyFor(item);
      set.add(key);
      return () => set.delete(key);
    },
  });
  host.provide("commands", registerInto(commands, (item) => item.name));
  host.provide("tools", registerInto(tools, (item) => item.name));
  host.provide("shellEnv", registerInto(shellEnvs, (item) => item.name));
  host.provide("subagents", {});
  await host.plugin(Loader);
  host.loader.builtins.trellis = trellisPlugin;

  const id = await host.loader.create({
    id: "dsh-trellis",
    name: "cordis:trellis",
    config: { enabled: true, commandsEnabled: true, maxBytes: 4096 },
  });
  const entry = host.loader.resolve(id);
  await entry.fiber.await();
  assert.deepEqual([...commands].sort(), [
    "trellis-doctor",
    "trellis-finish",
    "trellis-status",
  ]);
  assert.deepEqual([...tools], ["trellis_wait"]);
  assert.deepEqual([...shellEnvs], ["dsh-trellis-session"]);

  await entry.update({ config: { enabled: true, commandsEnabled: false, maxBytes: 1024 } });
  await entry.fiber.await();
  assert.deepEqual([...commands], []);
  assert.deepEqual([...tools], ["trellis_wait"]);
  assert.deepEqual([...shellEnvs], ["dsh-trellis-session"]);

  await entry.update({ config: { enabled: true, commandsEnabled: true, maxBytes: 512 } });
  await entry.fiber.await();
  assert.deepEqual([...commands].sort(), [
    "trellis-doctor",
    "trellis-finish",
    "trellis-status",
  ]);
  assert.deepEqual([...tools], ["trellis_wait"]);
  assert.deepEqual([...shellEnvs], ["dsh-trellis-session"]);
  const session = host.sessions.create("loader-volatile", { meta: { cwd: fixtureCwd } });
  await entry.update({
    config: { enabled: true, commandsEnabled: true, maxBytes: 24, projectRootMarkers: [".trellis"] },
  });
  await entry.fiber.await();
  // Dispatch agent/pre-step directly after entry.update() without yielding extra microtasks.
  assert.deepEqual([...commands].sort(), [
    "trellis-doctor",
    "trellis-finish",
    "trellis-status",
  ]);
  assert.deepEqual([...tools], ["trellis_wait"]);
  assert.deepEqual([...shellEnvs], ["dsh-trellis-session"]);
  const agent = { session, inbox: inbox() };
  const stepped = await host.waterfall(
    "agent/pre-step",
    { agent, messages: [prompt("Continue")], step: 2 },
    async () => ({ kind: "enter", messages: [prompt("Continue")], startsRequestSeries: true }),
  );
  assert.equal(stepped.messages.filter(isBreadcrumbMessage).length, 1);

  await entry.update({ config: { enabled: false } });
  await entry.fiber.await();
  assert.deepEqual([...commands], []);
  assert.deepEqual([...tools], []);
  assert.deepEqual([...shellEnvs], []);
});
