/**
 * Session-scoped context identity for Trellis's Python scripts.
 *
 * DSH rebuilds the managed `DSH_*` namespace for every model shell execution,
 * discarding ambient `DSH_*` values first. This contributor therefore carries
 * the current DSH session identity without inheriting an outer host's Trellis
 * context. The beta Trellis adapter resolves it before the generic
 * `TRELLIS_CONTEXT_ID` subprocess override.
 *
 * @module dsh-trellis/session-env
 */
import { createHash } from "node:crypto";
import { sanitizeContextKey } from "./workflow.js";

export { sanitizeContextKey };

export const SESSION_ENV_CONTRIBUTOR = "dsh-trellis-session";

/** Return the Trellis context key for a native DSH session id. */
export function dshContextKey(sessionId) {
  if (typeof sessionId !== "string") return "";
  const trimmed = sessionId.trim();
  if (trimmed === "") return "";
  const sanitized = sanitizeContextKey(trimmed);
  if (sanitized === "") {
    const digest = createHash("sha256").update(trimmed).digest("hex").slice(0, 24);
    return `dsh_${digest}`;
  }
  return `dsh_${sanitized}`.slice(0, 160).replace(/[._-]+$/g, "");
}

/**
 * Register the trusted, per-execution shell identity contribution.
 * @param {object} ctx - Cordis context exposing `ctx.shellEnv`.
 * @returns {() => void} disposer.
 */
export function registerSessionEnv(ctx) {
  return ctx.shellEnv.register({
    name: SESSION_ENV_CONTRIBUTOR,
    variables: {
      DSH_TRELLIS_CONTEXT_ID: {
        description:
          "Current DSH session's Trellis context key; overrides an inherited outer TRELLIS_CONTEXT_ID.",
      },
    },
    resolve(execution) {
      const contextKey = dshContextKey(
        execution.agent?.session?.header?.id ?? "",
      );
      return contextKey === "" ? {} : { DSH_TRELLIS_CONTEXT_ID: contextKey };
    },
  });
}
