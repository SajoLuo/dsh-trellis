import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import LlmRuntime, { LlmAdapter, createUserMessage } from "@deepseek-ai/dsh-llm";
import SessionStore, { Session } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import * as plugin from "../lib/index.js";
import { isBreadcrumbMessage } from "../lib/breadcrumb.js";
import { BREADCRUMB_PROJECTION_KEY, breadcrumbFingerprint } from "../lib/breadcrumb-projection.js";

const cwd = fileURLToPath(new URL("./fixtures/breadcrumb-project", import.meta.url));
const config = { projectRootMarkers: [".trellis"], commandsEnabled: false };
const user = (text) => createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
const updates = (session) => session.snapshotEvents()
  .filter((event) => event.type === "developer/message")
  .flatMap((event) => event.data.message.content);
const crumbs = (session) => session.deriveMessages().filter(isBreadcrumbMessage);
const toolNames = (request) => (request.tools ?? []).map((tool) => tool.name);

// Only the provider response is scripted: request construction, tool updates,
// pre-step delivery, Loader config and session projections use the real host.
class ScriptedAdapter extends LlmAdapter {
  constructor(toolUpdate) {
    super();
    this.toolUpdate = toolUpdate;
    this.requests = [];
  }
  async resolveModel(provider, model) {
    return { provider, id: model, name: model, toolUpdate: this.toolUpdate };
  }
  async *stream(options) {
    options.signal?.throwIfAborted();
    this.requests.push(options);
    yield { type: "block-start", index: 0, blockType: "text" };
    yield { type: "text-delta", index: 0, text: "ok" };
    yield { type: "block-end", index: 0, block: { type: "text", text: "ok" } };
    yield { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } };
    yield { type: "finish", reason: { kind: "stop" } };
  }
}

for (const toolUpdate of [undefined, "addition-only", "in-history"]) {
  test(`real RC.2 tool lifecycle preserves breadcrumbs (${toolUpdate ?? "no tool updates"})`, {
    skip: typeof Session.prototype.toolHistory !== "function",
    timeout: 15_000,
  }, async (t) => {
    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(SystemPrompt, { personaPrefix: "", personaSuffix: "" });
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(AgentLoop, { agents: [] });
    // These registrations are unrelated to request/session behavior here.
    ctx.provide("commands", { register: () => () => {} });
    ctx.provide("shellEnv", { register: () => () => {} });
    ctx.provide("subagents", {});
    await ctx.plugin(Loader);
    ctx.loader.builtins.trellis = plugin;
    const id = await ctx.loader.create({
      id: "dsh-trellis", name: "cordis:trellis", config: { ...config, enabled: false },
    });
    const entry = ctx.loader.resolve(id);
    await entry.fiber.await();
    const fiber = entry.fiber;
    const replace = async (changes) => {
      await entry.update({ config: { ...config, ...changes } });
      await entry.fiber.await();
      assert.equal(entry.fiber, fiber, "volatile changes keep the owning plugin fiber");
    };
    const adapter = new ScriptedAdapter(toolUpdate);
    ctx.llm.registerAdapter(["scripted"], adapter);
    const agent = await ctx.agentLoop.create("dynamic-tools", { provider: "scripted", model: "local" }, { cwd });
    const send = async (text) => {
      const count = adapter.requests.length;
      agent.followup(user(text));
      await agent.whenIdle();
      assert.equal(adapter.requests.length, count + 1, "each turn reaches the local adapter once");
      return adapter.requests.at(-1);
    };
    const addition = { type: "tool-addition", toolName: "trellis_wait" };
    const removal = { type: "tool-removal", toolName: "trellis_wait" };

    await send("Before enabling Trellis");
    assert.deepEqual(toolNames(adapter.requests.at(-1)), []);
    await replace({ enabled: true });
    const enabled = await send("Continue with Trellis");
    assert.deepEqual(updates(agent.session), [addition]);
    assert.deepEqual(toolNames(enabled), ["trellis_wait"]);
    assert.equal(crumbs(agent.session).length, 1);
    if (toolUpdate !== undefined) {
      assert.equal(enabled.tools[0].deferLoading, true);
      assert.deepEqual(enabled.messages.filter((message) => message.role === "developer")
        .flatMap((message) => message.content), [addition]);
    }

    // Remount the runtime without changing the tool set or breadcrumb payload.
    await replace({ enabled: true, skipKeyword: "skip-this-workflow" });
    await send("After a settings change");
    assert.deepEqual(updates(agent.session), [addition]);
    assert.equal(crumbs(agent.session).length, 1);

    await replace({ enabled: false });
    const disabled = await send("With Trellis disabled");
    assert.deepEqual(updates(agent.session), [addition, removal]);
    assert.deepEqual(toolNames(agent.session.requestHeader()), []);
    assert.equal(crumbs(agent.session).length, 1);
    if (toolUpdate !== "in-history") {
      assert.deepEqual(toolNames(disabled), []);
      assert.equal(disabled.messages.some((message) => message.role === "developer"), false);
      if (toolUpdate === undefined) assert.equal(enabled.tools.some((tool) => tool.deferLoading), false);
    } else {
      assert.deepEqual(toolNames(disabled), ["trellis_wait"]);
      const content = disabled.messages.filter((message) => message.role === "developer")
        .flatMap((message) => message.content);
      assert.deepEqual(content, [addition, removal]);
    }

    await replace({ enabled: true });
    const reenabled = await send("After enabling again");
    assert.deepEqual(updates(agent.session), [addition, removal, addition]);
    assert.deepEqual(toolNames(agent.session.requestHeader()), ["trellis_wait"]);
    assert.equal(crumbs(agent.session).length, 1);
    const developerContent = reenabled.messages.filter((message) => message.role === "developer")
      .flatMap((message) => message.content);
    assert.deepEqual(developerContent, toolUpdate === "in-history"
      ? [addition, removal, addition] : toolUpdate === "addition-only" ? [addition] : []);

    // Replay and fork the mixed user/developer history through host projections.
    const restored = ctx.sessions.create("restored-tools", {
      seed: agent.session.snapshotEvents(), meta: { cwd },
    });
    const forked = ctx.sessions.fork(agent.session);
    const fingerprint = breadcrumbFingerprint(crumbs(agent.session)[0]);
    for (const session of [restored, forked]) {
      const state = ctx.sessionProjections.stateOf(session, BREADCRUMB_PROJECTION_KEY);
      assert.equal(crumbs(session).length, 1);
      assert.equal(session.surface.nodes.filter((seq) => state[seq] === fingerprint).length, 1);
      assert.deepEqual(updates(session), [addition, removal, addition]);
    }

    // A surface replacement removes just the old breadcrumb, not tool history.
    // This exercises the compaction contract, not the summarizer/model plugin.
    const crumb = agent.session.snapshotEvents()
      .find((event) => event.type === "user/message" && isBreadcrumbMessage(event.data));
    agent.session.append("user/message", user("Compacted workflow context"), {
      surfaceOp: { op: "replace", startSeq: crumb.seq, endSeq: crumb.seq },
      sourceEventSeqs: [crumb.seq],
    });
    assert.equal(crumbs(agent.session).length, 0);
    const compacted = await send("Continue after compaction");
    assert.equal(crumbs(agent.session).length, 1);
    assert.equal(compacted.messages.filter(isBreadcrumbMessage).length, 1);
    assert.deepEqual(updates(agent.session), [addition, removal, addition]);
    assert.deepEqual(compacted.toolHistory, agent.session.toolHistory());
    // Replacing the surface starts a new request series with current tools as
    // its baseline; recorded old updates remain in the log, not on the wire.
    assert.deepEqual(compacted.toolHistory.updates, []);
    assert.deepEqual(toolNames(compacted), ["trellis_wait"]);
    assert.equal(compacted.tools.some((tool) => tool.deferLoading), false);
    assert.equal(compacted.messages.some((message) => message.role === "developer"), false);
    assert.equal(compacted.messages.filter((message) => message.role === "user" && !isBreadcrumbMessage(message)).length, 7);
    assert.equal(crumbs(restored).length, 1, "replay history remains isolated");
    assert.equal(crumbs(forked).length, 1, "fork history remains isolated");
  });
}
