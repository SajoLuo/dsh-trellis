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
  /** Python executable used by /trellis commands. Empty selects a platform-aware fallback chain. */
  pythonCmd: z.string().default(""),
  /** Register the deterministic /trellis-status and read-only /trellis-finish commands. */
  commandsEnabled: z.boolean().default(true),
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
 * }}
 */
export function resolveConfig(config) {
  return {
    enabled: config.enabled !== false,
    maxBytes: config.maxBytes ?? 4096,
    projectRootMarkers: config.projectRootMarkers ?? [".git"],
    skipKeyword: config.skipKeyword ?? "no-trellis",
    pythonCmd:
      typeof config.pythonCmd === "string" ? config.pythonCmd.trim() : "",
    commandsEnabled: config.commandsEnabled !== false,
  };
}
