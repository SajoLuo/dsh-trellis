/**
 * Replayable breadcrumb identity, driven by DSH's projection registry.
 * Only fingerprints are retained, never message bodies or a second event log.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { isBreadcrumbMessage } from "./breadcrumb.js";

export const BREADCRUMB_PROJECTION_KEY = "dsh-trellis.breadcrumbs";

/** Stable JSON payload identity, excluding the per-injection message id. */
export function breadcrumbFingerprint(message) {
  const json = JSON.stringify(
    { content: message.content, source: message.source },
    (_key, value) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ))
        : value,
  );
  return createHash("sha256").update(json).digest("hex");
}

export const breadcrumbProjection = {
  key: BREADCRUMB_PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: z.record(
    z.string().regex(/^(0|[1-9]\d*)$/),
    z.string().regex(/^[a-f0-9]{64}$/),
  ),
  init: () => ({}),
  apply(state, event) {
    if (event.type !== "user/message" || !isBreadcrumbMessage(event.data)) {
      return state;
    }
    return { ...state, [event.seq]: breadcrumbFingerprint(event.data) };
  },
};

/** Register/read on the owning runtime scope; unload removes our key only. */
export function registerBreadcrumbProjection(ctx) {
  const registry = ctx.sessionProjections;
  if (typeof registry?.register !== "function") {
    throw new Error("dsh-trellis requires the DSH sessionProjections service");
  }
  const hostOnly = typeof registry.stateOf === "function";
  // rc.6 predates host-only units. Its projection snapshot contains only our
  // seq -> hash index, not workflow text. This is NOT a Session log snapshot.
  const definition = hostOnly ? breadcrumbProjection : {
    ...breadcrumbProjection,
    schema: breadcrumbProjection.stateSchema,
    view: (state) => state,
  };
  const dispose = registry.register(definition);
  return {
    dispose,
    isVisible(session, message) {
      const state = hostOnly
        ? registry.stateOf(session, BREADCRUMB_PROJECTION_KEY)
        : registry.snapshot(session).values[BREADCRUMB_PROJECTION_KEY];
      if (state === undefined) {
        throw new Error("dsh-trellis breadcrumb projection is not registered");
      }
      // Surface order, not maximum event seq: replacements can reorder seqs.
      // Only the LAST visible breadcrumb may suppress a new state (A -> B -> A).
      // Provenance can cite still-visible nodes, so do not prune by sourceEventSeqs.
      const nodes = session.surface.nodes;
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const fingerprint = state[nodes[i]];
        if (fingerprint !== undefined) {
          return fingerprint === breadcrumbFingerprint(message);
        }
      }
      return false;
    },
  };
}
