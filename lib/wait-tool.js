/**
 * Event-driven waiting for DeepSeek Harness continuable subagents.
 *
 * Trellis dispatches role agents in DSH's default background mode so the main
 * agent can keep doing independent work. When that work is exhausted, this
 * tool provides a native synchronization point: it waits for `subagent/end`,
 * which DSH emits only after the child's settlement notice has been queued for
 * the parent. It deliberately replaces shell sleeps and polling loops.
 *
 * @module dsh-trellis/wait-tool
 */
import { defineTool } from "@deepseek-ai/dsh-tools";

function createSettlementWaiter(parentCtx, subagentId, signal) {
  let disposeListener = () => {};
  let settled = false;
  let resolvePromise;
  let rejectPromise;

  const cleanup = () => {
    disposeListener?.();
    signal?.removeEventListener("abort", onAbort);
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(signal.reason ?? new Error("Trellis subagent wait cancelled."));
  };
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  disposeListener =
    parentCtx.on("subagent/end", (info) => {
      if (settled || info.id !== subagentId) return;
      settled = true;
      cleanup();
      resolvePromise(info);
    }) ?? (() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

/** Map a DSH stop reason to a gate-safe Trellis outcome. */
export function settlementOutcome(stopReason) {
  if (stopReason === "completed") return "completed";
  if (stopReason === "aborted") return "aborted";
  if (stopReason === "unknown") return "unknown";
  return "failed";
}

function settledResult(subagentId, info) {
  const stopReason =
    typeof info?.stopReason === "string" ? info.stopReason : "unknown";
  return {
    subagentId,
    state: "settled",
    outcome: settlementOutcome(stopReason),
    stopReason,
    runId: typeof info?.runId === "string" ? info.runId : "",
    provider: typeof info?.provider === "string" ? info.provider : "",
    assistantOutputBlocks: Array.isArray(info?.lastAssistantMessage)
      ? info.lastAssistantMessage.length
      : 0,
    settlementNoticeQueued: true,
  };
}

function inactiveResult(subagentId) {
  return {
    subagentId,
    state: "already-inactive",
    outcome: "unknown",
    stopReason: "unknown",
    runId: "",
    provider: "",
    assistantOutputBlocks: 0,
    settlementNoticeQueued: false,
  };
}

/** Register the Trellis-only, event-driven subagent wait tool. */
export function registerWaitTool(ctx) {
  return ctx.tools.register(
    defineTool({
      name: "trellis_wait",
      description:
        "Wait efficiently for one direct background Trellis subagent after independent work is exhausted. This is an event-driven synchronization barrier over DSH's native settlement lifecycle. Use the subagent id returned by `subagent`; never replace this with shell sleep, polling, or job_output. On DSH rc.8+, an idle parent can instead yield and be woken by the native settlement notice.",
      parameters: {
        subagent_id: {
          type: "string",
          required: true,
          description:
            "Direct continuable subagent id returned by the `subagent` tool.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            subagentId: { type: "string", required: true },
            state: { type: "string", required: true },
            outcome: { type: "string", required: true },
            stopReason: { type: "string", required: true },
            runId: { type: "string", required: true },
            provider: { type: "string", required: true },
            assistantOutputBlocks: { type: "number", required: true },
            settlementNoticeQueued: { type: "boolean", required: true },
          },
        },
        render(_args, value) {
          if (value.state === "already-inactive") {
            return [
              {
                type: "text",
                text: `subagent ${value.subagentId} is already inactive; no stop reason can be proven from the catalog snapshot, so inspect its transcript or an already-visible settlement notice before passing a gate`,
              },
            ];
          }
          if (value.outcome !== "completed") {
            return [
              {
                type: "text",
                text: `subagent ${value.subagentId} settled with ${value.outcome} (${value.stopReason}); do not treat this gate as passed; its native settlement notice is queued`,
              },
            ];
          }
          return [
            {
              type: "text",
              text: `subagent ${value.subagentId} completed; its native settlement notice is queued`,
            },
          ];
        },
      },
      async execute(args, exec) {
        const parent = exec.agent;
        if (!parent)
          throw new Error(
            "trellis_wait requires a calling agent (exec.agent was undefined)",
          );

        // Install the listener before reading the durable catalog so settlement
        // cannot slip through the validation/read-to-wait window.
        const waiter = createSettlementWaiter(
          parent.ctx,
          args.subagent_id,
          exec.signal,
        );
        try {
          const entries = await ctx.subagents.listChildren(
            parent.id,
            exec.signal,
          );
          const child = entries.find(
            (entry) =>
              entry.kind === "child" &&
              entry.mode === "continuable" &&
              entry.id === args.subagent_id,
          );
          if (child === undefined) {
            throw new Error(
              `trellis_wait can only wait for a direct continuable subagent of this session: ${args.subagent_id}`,
            );
          }
          if (child.activity === "inactive") {
            waiter.cancel();
            return inactiveResult(args.subagent_id);
          }

          const info = await waiter.promise;
          return settledResult(args.subagent_id, info);
        } catch (error) {
          waiter.cancel();
          throw error;
        }
      },
    }),
  );
}
