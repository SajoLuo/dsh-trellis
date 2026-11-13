import { test } from "node:test";
import assert from "node:assert/strict";
import * as settingsModule from "@deepseek-ai/dsh-settings";
import { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import { SessionQueryEngine } from "@deepseek-ai/dsh-session-query";
import { agentRuntime } from "./helpers/agent-runtime.js";
import { registerWaitTool } from "../lib/wait-tool.js";

test("wait consumes the real profile-backed catalog/projection/query and live Session store", {
  skip: typeof settingsModule.SettingsForms !== "function",
}, async (t) => {
  const ctx = await agentRuntime(t);
  await ctx.plugin(SubagentRuntime).await();
  await ctx.plugin(SessionQueryEngine).await();
  await ctx.fiber.await();
  const parent = await ctx.agentLoop.create("catalog-parent", { provider: "test", model: "local" });
  const parentSession = parent.session;
  const child = ctx.sessions.prepare("catalog-child", { meta: { parentSession: parentSession.header.id, origin: "subagent" } });
  const detach = ctx.sessions.enter(child);
  t.after(detach);
  ctx.sessions.announce(child);
  parentSession.append("subagent/catalog", { version: 0, childId: child.header.id,
    childCreatedAt: child.header.createdAt, mode: "continuable", label: "implement" });
  let entries;
  if (typeof ctx.subagents.listChildren === "function") {
    entries = await ctx.subagents.listChildren(parentSession.header.id);
  } else {
    const observation = await ctx.sessionQuery.observeSession(parentSession.header.id);
    try { entries = observation.projections.values.subagentCatalog; }
    finally { observation[Symbol.dispose](); }
  }
  assert.equal(entries[0].kind, undefined);
  assert.equal(entries[0].activity, undefined);
  assert.equal(entries[0].createdAt, child.header.createdAt);
  let tool;
  const register = ctx.tools.register.bind(ctx.tools);
  t.after(registerWaitTool({ tools: { register(value) { tool = value; return register(value); } },
    subagents: ctx.subagents, get: ctx.get.bind(ctx) }));
  const exec = { agent: parent };
  const pending = tool.execute({ subagent_id: child.header.id }, exec);
  await new Promise((resolve) => setImmediate(resolve));
  ctx.emit("subagent/end", { id: child.header.id, parentSessionId: parent.id, stopReason: "completed", runId: "native-test" });
  assert.equal((await pending).outcome, "completed");
  detach();
  const cold = await tool.execute({ subagent_id: child.header.id }, exec);
  assert.equal(cold.outcome, "unknown");
  assert.equal(cold.state, "already-inactive");
});
