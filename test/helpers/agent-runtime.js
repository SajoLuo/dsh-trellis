import { Context } from "@deepseek-ai/cordis";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import SessionStore from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { mountWorkingDirectory } from "./working-directory-runtime.js";

export async function agentRuntime(t, { nativeExecutor = true } = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SystemPrompt, { personaPrefix: "", personaSuffix: "" });
  await mountWorkingDirectory(ctx);
  await ctx.plugin(ToolRuntime);
  if (nativeExecutor && typeof ctx.tools.setExecutor === "function") {
    await ctx.plugin(await import("@deepseek-ai/dsh-tool-executor-native"));
  }
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(AgentLoop, { agents: [] });
  return ctx;
}
