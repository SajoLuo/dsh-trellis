/**
 * dsh-trellis plugin configuration (Schemastery).
 *
 * @module dsh-trellis/config
 */
import z from "@deepseek-ai/schemastery";

export const Config = z.object({
  /** Runtime master switch; the rc.8 settings namespace remains available for re-enabling. */
  enabled: z
    .boolean()
    .default(true)
    .description(
      "Enable Trellis breadcrumbs, commands, session facts, and the wait tool for this profile.",
    ),
  /** UTF-8 byte budget for the injected breadcrumb text. 0 disables injection. */
  maxBytes: z
    .number()
    .step(1)
    .min(0)
    .default(4096)
    .description(
      "Maximum UTF-8 bytes in a workflow-state breadcrumb; 0 disables breadcrumbs.",
    ),
  /** Directory markers that identify a project root (walked upward from the session cwd). */
  projectRootMarkers: z
    .array(z.string())
    .default([".git"])
    .description(
      "Directory entries used while walking upward to find the project root.",
    ),
  /** Standalone word (case-insensitive) in the user prompt that skips breadcrumb injection for that turn. Empty disables. */
  skipKeyword: z
    .string()
    .default("no-trellis")
    .description(
      "Standalone prompt keyword that skips one breadcrumb injection; empty disables the escape hatch.",
    ),
  /** Python executable used by /trellis commands. Empty selects a platform-aware fallback chain. */
  pythonCmd: z
    .string()
    .default("")
    .description(
      "Python 3 executable for Trellis scripts; empty selects a platform-aware launcher chain.",
    ),
  /** Register the deterministic /trellis-status and read-only /trellis-finish commands. */
  commandsEnabled: z
    .boolean()
    .default(true)
    .description(
      "Register /trellis-status and the read-only /trellis-finish helper.",
    ),
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
