/**
 * dsh-trellis plugin configuration (Schemastery).
 *
 * @module dsh-trellis/config
 */
import z from "@deepseek-ai/schemastery";

export const Config = z.object({
  /** Master switch: when false, the plugin injects nothing and registers nothing. */
  enabled: z.boolean().default(true),
  /** UTF-8 byte budget for the injected breadcrumb text. 0 disables injection. */
  maxBytes: z.number().step(1).min(0).default(4096),
  /** Directory markers that identify a project root (walked upward from the session cwd). */
  projectRootMarkers: z.array(z.string()).default([".git"]),
  /** Standalone word (case-insensitive) in the user prompt that skips breadcrumb injection for that turn. Empty disables. */
  skipKeyword: z.string().default("no-trellis"),
  /** Python command used by the /trellis commands (Windows: python). */
  pythonCmd: z.string().default("python"),
  /** Register the /trellis:start, /trellis:continue, /trellis:finish-work commands. */
  commandsEnabled: z.boolean().default(true),
  /** Export DSH_TRELLIS_CONTEXT_ID into agent shell environments so task.py resolves a session-scoped active-task pointer. */
  sessionEnvEnabled: z.boolean().default(true),
});

/**
 * Normalized runtime configuration.
 * @param {Partial<Record<string, unknown>>} config
 * @returns {{
 *   enabled: boolean,
 *   maxBytes: number,
 *   projectRootMarkers: string[],
 *   skipKeyword: string,
 *   pythonCmd: string,
 *   commandsEnabled: boolean,
 *   sessionEnvEnabled: boolean,
 * }}
 */
export function resolveConfig(config) {
  return {
    enabled: config.enabled !== false,
    maxBytes: config.maxBytes ?? 4096,
    projectRootMarkers: config.projectRootMarkers ?? [".git"],
    skipKeyword: config.skipKeyword ?? "no-trellis",
    pythonCmd: config.pythonCmd || "python",
    commandsEnabled: config.commandsEnabled !== false,
    sessionEnvEnabled: config.sessionEnvEnabled !== false,
  };
}
