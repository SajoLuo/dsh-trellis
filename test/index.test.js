import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, insertBreadcrumbDecision } from "../lib/index.js";

function harness({ settings = false } = {}) {
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
    "shell-env:dsh-trellis-session",
    "tool:trellis_wait",
  ]);

  state.publishSettings({ enabled: true, commandsEnabled: true });
  assert.deepEqual([...state.active].sort(), [
    "command:trellis-finish",
    "command:trellis-status",
    "listener:agent/pre-step",
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
