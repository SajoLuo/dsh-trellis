import { test } from "node:test";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import * as settingsModule from "@deepseek-ai/dsh-settings";
import * as plugin from "../lib/index.js";
import { resolveConfig } from "../lib/config.js";

test("real Loader updates volatile Config without remounting the plugin or losing ownership", {
  skip: typeof settingsModule.SettingsForms !== "function",
}, async (t) => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const active = new Map();
  const register = (kind) => (value) => {
    const key = kind + (value.name ?? value.key);
    assert.equal(active.has(key), false, `duplicate ${key}`);
    active.set(key, value);
    return () => active.delete(key);
  };
  ctx.provide("commands", { register: register("command:") });
  ctx.provide("tools", { register: register("tool:") });
  ctx.provide("shellEnv", { register: register("env:") });
  ctx.provide("sessionProjections", { register: register("projection:") });
  ctx.provide("subagents", {});
  await ctx.plugin(Loader);
  ctx.loader.builtins.trellis = plugin;
  const id = await ctx.loader.create({ id: "dsh-trellis", name: "cordis:trellis", config: { enabled: false } });
  const entry = ctx.loader.resolve(id);
  await entry.fiber.await();
  const fiber = entry.fiber;
  const config = fiber.config;
  assert.equal(typeof config.enabled.get, "function");
  assert.equal(active.size, 0);
  const replace = async (value) => {
    await entry.update({ config: value });
    await entry.fiber.await();
    assert.equal(entry.fiber, fiber);
    assert.equal(fiber.config.enabled, config.enabled);
  };
  await replace({ enabled: true, maxBytes: 512, commandsEnabled: false });
  assert.equal(active.has("tool:trellis_wait"), true);
  assert.equal(active.has("command:trellis-status"), false);
  assert.equal(resolveConfig(config).maxBytes, 512);
  const policies = new Set();
  const provider = ctx.plugin({ provide: "settings", apply(child) {
    child.provide("settings", { configure(policy, owner) {
      assert.equal(owner, fiber);
      assert.deepEqual(policy, { auto: false });
      policies.add(owner);
      return () => policies.delete(owner);
    } });
  } });
  await provider.await();
  await ctx.fiber.await();
  assert.equal(policies.size, 1);
  const tool = active.get("tool:trellis_wait");
  await provider.dispose();
  assert.equal(policies.size, 0);
  assert.equal(active.get("tool:trellis_wait"), tool);
  await replace({ enabled: true, maxBytes: 512, commandsEnabled: false });
  assert.equal(active.get("tool:trellis_wait"), tool);
  await replace({ enabled: true, commandsEnabled: true });
  assert.equal(active.has("command:trellis-status"), true);
  await replace({ enabled: false });
  assert.equal(active.size, 0);
  await assert.rejects(tool.execute({ subagent_id: "x" }, {}), /unloaded/);
});
