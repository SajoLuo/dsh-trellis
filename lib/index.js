/**
 * dsh-trellis: Trellis workflow integration for DeepSeek Harness.
 *
 * - Per-turn workflow-state breadcrumb: at every eligible `agent/pre-step`,
 *   resolves the project's Trellis state (.trellis/workflow.md blocks +
 *   active task) and injects the matching [workflow-state:*] body into the
 *   session, exactly where the workspace-instruction baseline lands.
 * - `/trellis-status`, read-only `/trellis-finish`, and `/trellis-doctor` utility commands.
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
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { Config, hasLiveConfig, resolveConfig } from "./config.js";
import {
  createBreadcrumbComposer,
  isBreadcrumbMessage,
} from "./breadcrumb.js";
import { registerBreadcrumbProjection } from "./breadcrumb-projection.js";
import { registerCommands } from "./commands.js";
import { registerSessionEnv } from "./session-env.js";
import { installSettingsSectionCompat } from "./settings-compat.js";
import { registerWaitTool } from "./wait-tool.js";

const require = createRequire(import.meta.url);

function loadOptionalSettingsModule() {
  try {
    return require("@deepseek-ai/dsh-settings");
  } catch (error) {
    if (
      error?.code === "MODULE_NOT_FOUND" ||
      error?.code === "ERR_MODULE_NOT_FOUND"
    ) {
      return {};
    }
    throw error;
  }
}

const settingsModule = loadOptionalSettingsModule();

export const name = "dsh-trellis";
export const SETTINGS_NAMESPACE = "dsh-trellis";

/** @type {string[]} */
export const inject = ["commands", "shellEnv", "subagents", "tools", "sessionProjections"];

export { Config };

function stopAll(disposers) {
  let hasError = false;
  let firstError;
  const pending = [];
  for (const dispose of disposers.toReversed()) {
    try {
      const result = dispose();
      if (typeof result?.then === "function") {
        pending.push(Promise.resolve(result));
      }
    } catch (error) {
      if (!hasError) {
        hasError = true;
        firstError = error;
      }
    }
  }
  if (pending.length === 0) {
    if (hasError) throw firstError;
    return undefined;
  }
  return Promise.allSettled(pending).then((results) => {
    if (hasError) throw firstError;
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
  });
}

function sameBreadcrumbPayload(left, right) {
  return (
    isDeepStrictEqual(left.content, right.content) &&
    isDeepStrictEqual(left.source, right.source)
  );
}

/** @param {import("@deepseek-ai/cordis").Context} ctx */
export function apply(ctx, config = {}) {
  let stopped = false;
  let disposeRuntime = () => {};
  let pendingTeardown = null;
  let currentConfig = () => config;
  let mountedConfig;
  let initialReady;
  let mountGeneration = 0;

  const trackTeardown = (teardown) => {
    const hasAsync = typeof teardown?.then === "function";
    const prior = pendingTeardown;
    if (prior === null && !hasAsync) return undefined;
    const barrier = (async () => {
      if (prior !== null) await prior.catch(() => {});
      if (hasAsync) await teardown;
    })();
    let tracked;
    tracked = barrier.catch(() => {}).finally(() => {
      if (pendingTeardown === tracked) pendingTeardown = null;
    });
    pendingTeardown = tracked;
    return barrier;
  };

  const installRuntime = (resolved, generation, beforeProjectionRegister) => {
    if (stopped || generation !== mountGeneration) return undefined;
    if (!resolved.enabled) {
      mountedConfig = resolved;
      disposeRuntime = () => {};
      return beforeProjectionRegister;
    }

    const disposers = [];
    let tornDown = false;
    const runTeardown = () => {
      if (tornDown) return undefined;
      tornDown = true;
      return stopAll(disposers);
    };
    let ready;
    try {
      if (resolved.commandsEnabled) {
        disposers.push(registerCommands(ctx, resolved));
      }
      disposers.push(registerWaitTool(ctx));
      disposers.push(registerSessionEnv(ctx));
      const breadcrumb = registerBreadcrumb(
        ctx,
        resolved,
        beforeProjectionRegister,
      );
      disposers.push(breadcrumb.dispose);
      mountedConfig = resolved;
      disposeRuntime = runTeardown;
      ready = breadcrumb.ready?.catch(async (error) => {
        if (mountedConfig === resolved) mountedConfig = undefined;
        if (generation === mountGeneration) disposeRuntime = () => {};
        await trackTeardown(runTeardown());
        throw error;
      });
    } catch (error) {
      mountedConfig = undefined;
      disposeRuntime = () => {};
      const rollback = trackTeardown(runTeardown());
      if (typeof rollback?.then === "function") {
        return rollback.then(() => {
          throw error;
        });
      }
      throw error;
    }
    return ready;
  };

  const mountRuntime = (nextConfig) => {
    if (stopped) return undefined;
    const generation = ++mountGeneration;
    let teardown;
    try {
      teardown = disposeRuntime();
    } finally {
      disposeRuntime = () => {};
      mountedConfig = undefined;
    }
    const teardownBarrier = trackTeardown(teardown);
    return installRuntime(resolveConfig(nextConfig), generation, teardownBarrier);
  };

  const updateRuntime = () => {
    try {
      mountRuntime(currentConfig())?.catch((error) => {
        ctx.logger?.error?.("dsh-trellis runtime registration failed: %o", error);
      });
    } catch (error) {
      ctx.logger?.error?.("dsh-trellis runtime registration failed: %o", error);
    }
  };

  // Keep the composition entry working when no settings provider is mounted.
  // Once the service appears, its resolved section becomes the live source and
  // a saved Web card edit remounts only this plugin's runtime.
  ctx.effect(() => {
    initialReady = mountRuntime(currentConfig());
    return () => {
      stopped = true;
      ++mountGeneration;
      mountedConfig = undefined;
      const teardown = disposeRuntime();
      disposeRuntime = () => {};
      if (pendingTeardown !== null) {
        return pendingTeardown.then(
          () => teardown,
          () => teardown,
        );
      }
      return teardown;
    };
  }, "dsh-trellis.runtime");

  if (hasLiveConfig(config)) {
    // Loader emits this to the owning fiber after committing every reference.
    // Unrelated profile edits must not cancel active waits or breadcrumbs.
    ctx.on("loader/volatile-update", () => {
      if (!isDeepStrictEqual(resolveConfig(config), mountedConfig)) updateRuntime();
    });
  }

  // Optional by design: profiles without a settings service retain the
  // loader-config behavior. The canonical bridge also distinguishes a settings
  // provider reload (fall back to config) from this plugin's own teardown
  // (leave the runtime alone until its owning effect disposes it).
  installSettingsSectionCompat(
    ctx,
    settingsModule,
    SETTINGS_NAMESPACE,
    Config,
    config,
    {
      setSource(source) {
        currentConfig = source;
      },
      onChange() {
        updateRuntime();
      },
    },
  );
  // Async apply must resolve to void, never to the new projection handle.
  return initialReady;
}

function makeBreadcrumbMatchers(claimedMessages = []) {
  const claimedRefs = new Set(claimedMessages);
  const claimedIds = new Set();
  const breadcrumbRefs = new Set();
  const breadcrumbIds = new Set();
  for (const message of claimedMessages) {
    const id = typeof message?.id === "string" ? message.id : undefined;
    if (id !== undefined) claimedIds.add(id);
    if (isBreadcrumbMessage(message)) {
      breadcrumbRefs.add(message);
      if (id !== undefined) breadcrumbIds.add(id);
    }
  }
  return {
    isClaimed(message) {
      return (
        claimedRefs.has(message) ||
        (typeof message?.id === "string" && claimedIds.has(message.id))
      );
    },
    isBreadcrumb(message) {
      return (
        isBreadcrumbMessage(message) ||
        breadcrumbRefs.has(message) ||
        (typeof message?.id === "string" && breadcrumbIds.has(message.id))
      );
    },
  };
}

function stripBreadcrumbs(messages, claimedMessages = []) {
  const { isBreadcrumb } = makeBreadcrumbMatchers(claimedMessages);
  return messages.filter((message) => !isBreadcrumb(message));
}

function stripDecisionBreadcrumbs(decision, claimedMessages = []) {
  if (!Array.isArray(decision?.messages)) return decision;
  const { isBreadcrumb } = makeBreadcrumbMatchers(claimedMessages);
  if (!decision.messages.some(isBreadcrumb)) return decision;
  return {
    ...decision,
    messages: stripBreadcrumbs(decision.messages, claimedMessages),
  };
}

/**
 * Insert a breadcrumb without discarding decision metadata added by DSH or
 * another pre-step participant (for example `startsRequestSeries`).
 *
 * @param {{ messages: unknown[], [key: string]: unknown }} decision
 * @param {unknown[]} claimedMessages
 * @param {unknown} desired
 */
export function insertBreadcrumbDecision(decision, claimedMessages, desired) {
  const { isClaimed, isBreadcrumb } = makeBreadcrumbMatchers(claimedMessages);
  const lastClaimedIndex = decision.messages.findLastIndex(isClaimed);
  let insertAt = 0;
  const remaining = [];
  for (const [index, message] of decision.messages.entries()) {
    if (isBreadcrumb(message)) continue;
    remaining.push(message);
    if (index <= lastClaimedIndex) insertAt += 1;
  }
  return {
    ...decision,
    messages: remaining.toSpliced(insertAt, 0, desired),
  };
}

function registerBreadcrumb(ctx, resolved, beforeProjectionRegister) {
  const { compose } = createBreadcrumbComposer(resolved, ctx);
  const projection = registerBreadcrumbProjection(ctx, {
    beforeRegister: beforeProjectionRegister,
  });
  let disposed = false;
  const pendingInboxes = new Set();
  const clearInbox = (inbox) => {
    try {
      const nextStep = inbox?.nextStep;
      if (Array.isArray(nextStep)) {
        for (const message of nextStep.filter(isBreadcrumbMessage)) {
          inbox.remove(message.id);
        }
      }
    } catch {
      // Inbox projection scope may already be unloaded during teardown.
    } finally {
      pendingInboxes.delete(inbox);
    }
  };

  const syncInbox = (agent, desired) => {
    pendingInboxes.add(agent.inbox);
    const pending = agent.inbox.nextStep.filter(isBreadcrumbMessage);
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

  let disposeStep;
  try {
    disposeStep = ctx.on("agent/pre-step", async ({ agent, messages, step, signal }, next) => {
      const decision = await next();
      if (disposed) return decision;
      let desired;
      try {
        await projection.ready;
        if (disposed) return decision;
        desired = await compose(agent, messages, signal);
        if (disposed) return decision;
        if (desired !== undefined && projection.isVisible(agent.session, desired)) {
          desired = undefined;
        }
      } catch (error) {
        if (signal !== undefined && signal.aborted) {
          signal.throwIfAborted();
          throw error;
        }
        ctx.logger?.warn?.(
          "dsh-trellis breadcrumb composition failed: %o",
          error,
        );
        return decision;
      }
      signal?.throwIfAborted();
      if (desired === undefined) {
        clearInbox(agent.inbox);
        return stripDecisionBreadcrumbs(decision, messages);
      }
      if (
        decision.kind === "reject" ||
        (step === 1 && decision.messages.length === 0)
      ) {
        syncInbox(agent, desired);
        return step > 1
          ? stripDecisionBreadcrumbs(decision, messages)
          : decision;
      }
      clearInbox(agent.inbox);
      const { isBreadcrumb } = makeBreadcrumbMatchers(messages);
      const existingBreadcrumbs = decision.messages.filter(isBreadcrumb);
      if (
        existingBreadcrumbs.length === 1 &&
        sameBreadcrumbPayload(existingBreadcrumbs[0], desired)
      ) {
        return decision;
      }
      return insertBreadcrumbDecision(decision, messages, desired);
    });
  } catch (error) {
    projection.dispose();
    throw error;
  }
  return {
    ready: projection.ready,
    dispose() {
      disposed = true;
      disposeStep();
      for (const inbox of [...pendingInboxes]) clearInbox(inbox);
      pendingInboxes.clear();
      return projection.dispose();
    },
  };
}
