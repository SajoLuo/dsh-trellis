/**
 * Event-driven waiting for DeepSeek Harness continuable subagents.
 *
 * Trellis dispatches role agents in DSH's default background mode so the main
 * agent can keep doing independent work. When that work is exhausted, this
 * tool provides a native synchronization point: it waits for `subagent/end`,
 * which proves execution settlement, not delivery of a parent notice (alpha.2
 * delivery is best effort and caller-owned activations may omit it entirely).
 * It deliberately replaces shell sleeps and polling loops.
 *
 * @module dsh-trellis/wait-tool
 */
import { defineTool } from "@deepseek-ai/dsh-tools";

function abortError(signal) {
  return signal?.reason ?? new Error("Trellis subagent wait cancelled.");
}

function hasComparableCreatedAt(value) {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** Reject stale settlements when both catalog entry and event expose an epoch timestamp. */
function matchesChildEpoch(child, info) {
  if (!hasComparableCreatedAt(child?.createdAt) || !hasComparableCreatedAt(info?.createdAt)) {
    return true;
  }
  return child.createdAt === info.createdAt;
}

/** Yield one macrotask turn without leaking timers or abort listeners while waiting for teardown subagent/end. */
async function waitOneMacrotaskOrSettlement(waiter, signal) {
  if (signal?.aborted) {
    waiter.cancel();
    throw abortError(signal);
  }
  if (waiter.result()) return;

  let immediateId;
  let onAbort;
  try {
    await Promise.race([
      waiter.promise,
      new Promise((resolve, reject) => {
        onAbort = () => {
          if (immediateId !== undefined) {
            clearImmediate(immediateId);
            immediateId = undefined;
          }
          reject(abortError(signal));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        immediateId = setImmediate(() => {
          immediateId = undefined;
          resolve();
        });
      }),
    ]);
  } finally {
    if (immediateId !== undefined) clearImmediate(immediateId);
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
  }
}

function createSettlementWaiter(parentCtx, subagentId, signal, parentSessionId) {
  let disposeListener = () => {};
  let settled = false;
  let resolvePromise;
  let rejectPromise;
  let terminal;
  const earlyEvents = new Map();

  const cleanup = () => {
    disposeListener?.();
    signal?.removeEventListener("abort", onAbort);
    earlyEvents.clear();
  };
  const onAbort = () => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(abortError(signal));
  };
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // Cancellation can precede completion of the catalog lookup below. Observe
  // the rejection immediately; the execute path still awaits the original.
  void promise.catch(() => {});

  const onEnd = (info) => {
    if (settled || (parentSessionId !== undefined && info.parentSessionId !== parentSessionId)) return;
    // RC.2 names resolve asynchronously. Subscribe first and retain only
    // direct-child edges until the requested name has a stable Session id.
    if (subagentId === undefined) {
      if (!earlyEvents.has(info.id)) earlyEvents.set(info.id, info);
      return;
    }
    if (info.id !== subagentId) return;
    settled = true;
    terminal = info;
    cleanup();
    resolvePromise(info);
  };
  disposeListener = parentCtx.on("subagent/end", onEnd) ?? (() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();

  return {
    promise,
    result: () => terminal,
    select(id) {
      subagentId = id;
      const info = earlyEvents.get(id);
      earlyEvents.clear();
      if (info !== undefined) onEnd(info);
    },
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

/** Read the direct catalog without keeping a Session Query observation alive. */
async function directChildren(ctx, parentId, signal) {
  if (typeof ctx.subagents.listChildren === "function") {
    return ctx.subagents.listChildren(parentId, signal);
  }
  const query = ctx.get?.("sessionQuery");
  if (typeof query?.observeSession !== "function") {
    throw new Error("trellis_wait requires sessionQuery to read the direct subagent catalog.");
  }
  const observation = await query.observeSession(parentId, { signal });
  try {
    signal.throwIfAborted();
    const entries = observation.projections?.values.subagentCatalog;
    if (!Array.isArray(entries)) {
      throw new Error("trellis_wait direct subagent catalog is unavailable.");
    }
    return entries;
  } finally {
    observation[Symbol.dispose]();
  }
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
    // Compatibility field: false means unverified, not proven non-delivery.
    settlementNoticeQueued: false,
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

/** Catalogs prove ownership, not residency or successful completion. */
function childActivity(ctx, parent, child) {
  if (child.kind === "child") {
    if (["running", "inactive"].includes(child.activity)) return child.activity;
    throw new Error("DSH returned an unsupported child activity.");
  }
  const sessions = ctx.get?.("sessions");
  if (typeof sessions?.get !== "function") {
    throw new Error("trellis_wait requires the session store to check catalog child residency.");
  }
  const live = sessions.get(child.id);
  if (live === undefined) return "inactive";
  const header = live.header;
  if (header.parentSession !== parent.id || header.origin !== "subagent" ||
      header.createdAt !== child.createdAt) {
    throw new Error("trellis_wait child lifecycle no longer matches its parent catalog.");
  }
  return "running";
}

/** Register the Trellis-only, event-driven subagent wait tool. */
export function registerWaitTool(ctx) {
  const lifetime = new AbortController();
  const unregister = ctx.tools.register(
    defineTool({
      name: "trellis_wait",
      description:
        "Wait efficiently for one direct background Trellis subagent after independent work is exhausted. This is an event-driven synchronization barrier over DSH's native settlement lifecycle. Pass the name returned by current `subagent` tools, or a Session id on older hosts, in subagent_id; never replace this with shell sleep, polling, or job_output. An idle parent can instead yield when its host provides a reliable native settlement-notice path.",
      parameters: {
        subagent_id: {
          type: "string",
          required: true,
          description:
            "Direct continuable subagent name or Session id returned by the `subagent` tool. The result contains its resolved Session id.",
        },
      },
      isConcurrencySafe: () => true,
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            subagentId: {
              type: "string",
              required: true,
              description: "Resolved direct subagent Session id.",
            },
            state: {
              type: "string",
              enum: ["settled", "already-inactive"],
              required: true,
              description:
                "Whether trellis_wait observed subagent/end or found the child already inactive.",
            },
            outcome: {
              type: "string",
              enum: ["completed", "failed", "aborted", "unknown"],
              required: true,
              description:
                "Terminal subagent outcome, or unknown when already inactive.",
            },
            stopReason: {
              type: "string",
              required: true,
              description:
                "Terminal stopReason recorded on subagent/end, or unknown when already inactive.",
            },
            runId: {
              type: "string",
              required: true,
              description:
                "DSH runId recorded on subagent/end, or empty when already inactive.",
            },
            provider: {
              type: "string",
              required: true,
              description:
                "Subagent provider recorded on subagent/end, or empty when already inactive.",
            },
            assistantOutputBlocks: {
              type: "integer",
              required: true,
              description:
                "Count of assistant output blocks recorded when subagent/end fired.",
            },
            settlementNoticeQueued: {
              type: "boolean", required: true,
              description: "Compatibility field: false means notice delivery is unverified, not proven absent.",
            },
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
                text: `subagent ${value.subagentId} settled with ${value.outcome} (${value.stopReason}); do not treat this gate as passed; settlement notice delivery is unverified`,
              },
            ];
          }
          return [
            {
              type: "text",
              text: `subagent ${value.subagentId} completed; settlement notice delivery is unverified; inspect its report or transcript before passing a dependent gate`,
            },
          ];
        },
      },
      async execute(args, exec) {
        const signal = exec.signal
          ? AbortSignal.any([exec.signal, lifetime.signal])
          : lifetime.signal;
        signal.throwIfAborted();
        const parent = exec.agent;
        if (!parent)
          throw new Error(
            "trellis_wait requires a calling agent (exec.agent was undefined)",
          );

        const namedHost = typeof ctx.subagents.listChildren !== "function";
        if (namedHost && (typeof ctx.subagents.rootOf !== "function" ||
            typeof ctx.subagents.resolveName !== "function")) {
          throw new Error("trellis_wait requires the host's subagent root and name resolver.");
        }
        // RC.2 dispatches lifecycle edges on the runtime tree root. The direct
        // creator stays in parentSessionId, so siblings/descendants cannot pass
        // this caller's barrier. Subscribe before either asynchronous lookup.
        const waiter = createSettlementWaiter(
          namedHost ? ctx.subagents.rootOf(parent).ctx : parent.ctx,
          namedHost ? undefined : args.subagent_id,
          signal,
          namedHost ? parent.id : undefined,
        );
        try {
          const subagentId = namedHost
            ? await ctx.subagents.resolveName(parent, args.subagent_id, signal)
            : args.subagent_id;
          signal.throwIfAborted();
          const entries = await directChildren(ctx, parent.id, signal);
          signal.throwIfAborted();
          const child = entries.find(
            (entry) =>
              (entry.kind === "child" || entry.kind === undefined) &&
              entry.mode === "continuable" &&
              entry.id === subagentId,
          );
          if (child === undefined) {
            throw new Error(
              `trellis_wait can only wait for a direct continuable subagent of this session: ${args.subagent_id}`,
            );
          }
          const activity = childActivity(ctx, parent, child);
          waiter.select(subagentId);
          // Preserve a proven event captured during either lookup, after
          // validating catalog ownership and the live Session generation.
          const earlyResult = waiter.result();
          if (earlyResult && matchesChildEpoch(child, earlyResult)) {
            return settledResult(subagentId, earlyResult);
          }
          if (activity === "inactive") {
            // dsh-subagent detaches the session just before emitting subagent/end;
            // yield one macrotask turn so an in-flight teardown event still settles.
            await waitOneMacrotaskOrSettlement(waiter, signal);
            if (signal?.aborted) {
              waiter.cancel();
              throw abortError(signal);
            }
            const settled = waiter.result();
            if (settled && matchesChildEpoch(child, settled)) {
              return settledResult(subagentId, settled);
            }
            waiter.cancel();
            return inactiveResult(subagentId);
          }

          const info = await waiter.promise;
          return settledResult(subagentId, info);
        } catch (error) {
          waiter.cancel();
          throw error;
        }
      },
    }),
  );
  return () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort(new Error("Trellis wait tool was unloaded; no child completion was proven."));
    unregister();
  };
}
