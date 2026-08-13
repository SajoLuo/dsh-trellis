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
      resolvePromise(info.stopReason);
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

/** Register the Trellis-only, event-driven subagent wait tool. */
export function registerWaitTool(ctx) {
  return ctx.tools.register(
    defineTool({
      name: "trellis_wait",
      description:
        "Wait efficiently for one direct background Trellis subagent after independent work is exhausted. This is event-driven: it returns only after DeepSeek Harness has queued the child's native settlement notice. Use the subagent id returned by `subagent`; never replace this with shell sleep, polling, or job_output.",
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
            stopReason: { type: "string", required: true },
          },
        },
        render(_args, value) {
          if (value.state === "already-inactive") {
            return [
              {
                type: "text",
                text: `subagent ${value.subagentId} is already inactive; consume its queued settlement notice or inspect its transcript`,
              },
            ];
          }
          return [
            {
              type: "text",
              text: `subagent ${value.subagentId} settled (${value.stopReason}); its native settlement notice is queued`,
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
            return {
              subagentId: args.subagent_id,
              state: "already-inactive",
              stopReason: "unknown",
            };
          }

          const stopReason = await waiter.promise;
          return {
            subagentId: args.subagent_id,
            state: "settled",
            stopReason,
          };
        } catch (error) {
          waiter.cancel();
          throw error;
        }
      },
    }),
  );
}
