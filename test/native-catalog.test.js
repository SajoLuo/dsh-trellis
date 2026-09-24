import { test } from "node:test";
import assert from "node:assert/strict";
import * as settingsModule from "@deepseek-ai/dsh-settings";
import { SubagentRuntime } from "@deepseek-ai/dsh-subagent";
import { SessionQueryEngine } from "@deepseek-ai/dsh-session-query";
import { sessionRuntime } from "./helpers/session-runtime.js";
import { registerWaitTool } from "../lib/wait-tool.js";

test("wait consumes the real RC.1 catalog/projection/query and live Session store", {
  skip: typeof settingsModule.SettingsForms !== "function",
}, async (t) => {
  const ctx = await sessionRuntime(t);
  await ctx.plugin(SubagentRuntime).await();
  await ctx.plugin(SessionQueryEngine).await();
  await ctx.fiber.await();
  const parentSession = ctx.sessions.create("catalog-parent");
  const child = ctx.sessions.prepare("catalog-child", { meta: { parentSession: parentSession.header.id, origin: "subagent" } });
  const detach = ctx.sessions.enter(child);
  t.after(detach);
  ctx.sessions.announce(child);
  parentSession.append("subagent/catalog", { version: 0, childId: child.header.id,
    childCreatedAt: child.header.createdAt, mode: "continuable", label: "implement" });
  const entries = await ctx.subagents.listChildren(parentSession.header.id);
  assert.equal(entries[0].kind, undefined);
  assert.equal(entries[0].activity, undefined);
  assert.equal(entries[0].createdAt, child.header.createdAt);
  let tool;
  ctx.provide("tools", { register(value) { tool = value; return () => {}; } });
  t.after(registerWaitTool(ctx));
  const exec = { agent: { id: parentSession.header.id, session: parentSession, ctx } };
  const pending = tool.execute({ subagent_id: child.header.id }, exec);
  await new Promise((resolve) => setImmediate(resolve));
  ctx.emit("subagent/end", { id: child.header.id, stopReason: "completed", runId: "native-test" });
  assert.equal((await pending).outcome, "completed");
  detach();
  const cold = await tool.execute({ subagent_id: child.header.id }, exec);
  assert.equal(cold.outcome, "unknown");
  assert.equal(cold.state, "already-inactive");
});
