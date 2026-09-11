import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { BREADCRUMB_PROJECTION_KEY as KEY } from "../lib/breadcrumb-projection.js";
import { isBreadcrumbMessage } from "../lib/breadcrumb.js";
import { sessionRuntime } from "./helpers/session-runtime.js";
import { apply, inject, insertBreadcrumbDecision } from "../lib/index.js";

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
      listeners.push({ event, listener });
      active.add(`listener:${event}`);
      return () => active.delete(`listener:${event}`);
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
        const dispose = projectionRegistry?.register(definition);
        return () => {
          active.delete(`projection:${definition.key}`);
          dispose?.();
        };
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
      for (const effect of effects.filter(({ owner }) => owner === "plugin")) {
        effect.dispose();
      }
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

async function preStepRuntime(t, config = {}) {
  const ctx = await sessionRuntime(t);
  const state = harness({ settings: true, projectionRegistry: ctx.sessionProjections });
  apply(state.ctx, { ...fixtureConfig, ...config });
  t.after(() => state.disposePlugin());
  const agent = {
    session: ctx.sessions.create("pre-step", { meta: { cwd: fixtureCwd } }),
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
  agent.session.append("user/message", first, { surfaceOp: "append" });
  agent.session = ctx.sessions.create("resumed-pre-step", {
    seed: agent.session.snapshotEvents(), meta: { cwd: fixtureCwd },
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
