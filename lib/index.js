/**
 * dsh-trellis: Trellis workflow integration for DeepSeek Harness.
 *
 * - Per-turn workflow-state breadcrumb: at every eligible `agent/pre-step`,
 *   resolves the project's Trellis state (.trellis/workflow.md blocks +
 *   active task) and injects the matching [workflow-state:*] body into the
 *   session, exactly where the workspace-instruction baseline lands.
 * - `/trellis-status` and read-only `/trellis-finish` utility commands.
 *   Session rituals remain skills (`/trellis-start`, `/trellis-continue`,
 *   `/trellis-finish-work`) so command registration cannot shadow them.
 * - `trellis_wait`, an event-driven synchronization tool for a continuable
 *   role agent after the main session has exhausted independent work.
 * - A managed DSH_TRELLIS_CONTEXT_ID derived per shell execution from the
 *   native DSH session, so an outer host's inherited TRELLIS_CONTEXT_ID cannot
 *   silently claim the inner session. Utility commands set the same identity.
 *
 * In directories without a Trellis project it injects no breadcrumb; utility
 * commands validate the project only when a user explicitly invokes them.
 *
 * @module dsh-trellis
 */
import { isDeepStrictEqual } from "node:util";
import { Config, resolveConfig } from "./config.js";
import { createBreadcrumbComposer, isBreadcrumbMessage } from "./breadcrumb.js";
import { registerCommands } from "./commands.js";
import { registerSessionEnv } from "./session-env.js";
import { registerWaitTool } from "./wait-tool.js";

export const name = "dsh-trellis";

/** @type {string[]} */
export const inject = ["commands", "shellEnv", "subagents", "tools"];

export { Config };

function sameBreadcrumbPayload(left, right) {
  return (
    isDeepStrictEqual(left.content, right.content) &&
    isDeepStrictEqual(left.source, right.source)
  );
}

/** @param {import("@deepseek-ai/cordis").Context} ctx */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config);
  if (!resolved.enabled) return;

  // --- /trellis commands ---------------------------------------------------
  let disposeCommands = () => {};
  ctx.effect(() => {
    if (resolved.commandsEnabled) {
      disposeCommands = registerCommands(ctx, resolved);
    }
    return () => disposeCommands();
  }, "dsh-trellis.commands");

  // --- native continuable-subagent synchronization -----------------------
  ctx.effect(
    () => registerWaitTool(ctx),
    "dsh-trellis.wait-tool",
  );

  // --- session-scoped shell identity --------------------------------------
  ctx.effect(
    () => registerSessionEnv(ctx),
    "dsh-trellis.session-env",
  );

  // --- per-turn breadcrumb injection --------------------------------------
  const { compose } = createBreadcrumbComposer(resolved, ctx);

  const syncInbox = (agent, desired) => {
    const pending = agent.inbox.nextStep.filter(isBreadcrumbMessage);
    const alreadySupplied =
      desired === undefined ||
      agent.session.surface.nodes.some((seq) => {
        const event = agent.session.events[seq];
        return (
          event?.type === "user/message" &&
          event.data !== undefined &&
          isBreadcrumbMessage(event.data) &&
          sameBreadcrumbPayload(event.data, desired)
        );
      });
    if (alreadySupplied) {
      for (const message of pending) agent.inbox.remove(message.id);
      return;
    }
    const reusable = pending.find((message) =>
      sameBreadcrumbPayload(message, desired),
    );
    if (reusable !== undefined) {
      for (const message of pending)
        if (message !== reusable) agent.inbox.remove(message.id);
      return;
    }
    const replaced = pending[0];
    if (replaced === undefined) agent.inbox.prepend("next-step", desired);
    else agent.inbox.replace(replaced.id, desired);
    for (const message of pending.slice(1)) agent.inbox.remove(message.id);
  };

  ctx.on("agent/pre-step", async ({ agent, messages, step, signal }, next) => {
    const decision = await next();
    let desired;
    try {
      desired = await compose(agent, messages, signal);
    } catch (error) {
      if (signal !== undefined && signal.aborted) throw error;
      ctx.logger?.warn?.(
        "dsh-trellis breadcrumb composition failed: %o",
        error,
      );
      return decision;
    }
    signal?.throwIfAborted();
    if (desired === undefined) {
      const pending = agent.inbox.nextStep.filter(isBreadcrumbMessage);
      for (const message of pending) agent.inbox.remove(message.id);
      return decision;
    }
    if (
      decision.kind === "reject" ||
      (step === 1 && decision.messages.length === 0)
    ) {
      syncInbox(agent, desired);
      return decision;
    }
    const pending = agent.inbox.nextStep.filter(isBreadcrumbMessage);
    for (const message of pending) agent.inbox.remove(message.id);
    if (
      decision.messages.some((message) =>
        sameBreadcrumbPayload(message, desired),
      )
    ) {
      return decision;
    }
    const lastClaimedIndex = decision.messages.findLastIndex((message) =>
      messages.includes(message),
    );
    return {
      kind: "enter",
      messages: decision.messages.toSpliced(lastClaimedIndex + 1, 0, desired),
    };
  });
}
