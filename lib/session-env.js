/**
 * Session-scoped context identity for Trellis's Python scripts.
 *
 * Registers the `DSH_TRELLIS_CONTEXT_ID` shell variable. Trellis task.py reads
 * it (via the dsh platform adapter patch) so `task.py start` / `create` /
 * `current --source` resolve the same per-session active-task pointer inside
 * main-session shells.
 *
 * @module dsh-trellis/session-env
 */
import { sanitizeContextKey } from "./workflow.js";

export const SESSION_ENV_CONTRIBUTOR = "dsh-trellis-session";

/**
 * Register the shell environment contributor when the base registry is present.
 * @param {object} ctx - cordis context exposing `ctx.shellEnv`.
 */
export function registerSessionEnv(ctx) {
  return ctx.shellEnv.register({
    name: SESSION_ENV_CONTRIBUTOR,
    variables: {
      DSH_TRELLIS_CONTEXT_ID: {
        description:
          "Trellis session-scoped context identity (dsh_<session-id>); consumed by .trellis/scripts/task.py.",
      },
    },
    resolve: (execution) => {
      const id = execution.agent?.session?.header?.id;
      if (id === undefined || id === "") return {};
      return { DSH_TRELLIS_CONTEXT_ID: `dsh_${sanitizeContextKey(id)}` };
    },
  });
}
