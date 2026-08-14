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
import { sanitizeContextKey } from "./workflow.js";

export const SESSION_ENV_CONTRIBUTOR = "dsh-trellis-session";

/** Return the Trellis context key for a native DSH session id. */
export function dshContextKey(sessionId) {
  const sanitized = sanitizeContextKey(sessionId ?? "");
  return sanitized === "" ? "" : `dsh_${sanitized}`;
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
