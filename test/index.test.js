import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";

function harness() {
  const effects = [];
  const listeners = [];
  const registrations = [];
  const ctx = {
    effect(callback, label) {
      effects.push({ label, dispose: callback() });
    },
    on(event, listener) {
      listeners.push({ event, listener });
      return () => registrations.push(`disposed-listener:${event}`);
    },
    commands: {
      register(command) {
        registrations.push(`command:${command.name}`);
        return () => registrations.push(`disposed:${command.name}`);
      },
    },
    subagents: {},
    tools: {
      register(tool) {
        registrations.push(`tool:${tool.name}`);
        return () => registrations.push(`disposed-tool:${tool.name}`);
      },
    },
  };
  return { ctx, effects, listeners, registrations };
}

test("disabled plugin is a complete no-op", () => {
  const state = harness();
  apply(state.ctx, { enabled: false });
  assert.deepEqual(state.effects, []);
  assert.deepEqual(state.listeners, []);
  assert.deepEqual(state.registrations, []);
});

test("enabled plugin registers commands, wait tool, one pre-step listener, and disposes them", () => {
  const state = harness();
  apply(state.ctx, {});
  assert.deepEqual(
    state.effects.map(({ label }) => label),
    ["dsh-trellis.commands", "dsh-trellis.wait-tool"],
  );
  assert.deepEqual(
    state.listeners.map(({ event }) => event),
    ["agent/pre-step"],
  );
  assert.deepEqual(state.registrations.slice().sort(), [
    "command:trellis-finish",
    "command:trellis-status",
    "tool:trellis_wait",
  ]);

  for (const effect of state.effects) effect.dispose();
  assert.ok(state.registrations.includes("disposed:trellis-status"));
  assert.ok(state.registrations.includes("disposed:trellis-finish"));
  assert.ok(state.registrations.includes("disposed-tool:trellis_wait"));
});
