/**
 * dsh-trellis plugin configuration (Schemastery).
 *
 * @module dsh-trellis/config
 */
import { createRequire } from "node:module";
import z from "@deepseek-ai/schemastery";

const require = createRequire(import.meta.url);
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/**
 * Synchronously load `@deepseek-ai/dsh-settings` when installed.
 * Minimal SDK deployments omit the optional settings package.
 *
 * @param {(specifier: string) => Record<string, unknown>} [requireFn]
 * @returns {Record<string, unknown>}
 */
export function loadOptionalSettingsModule(requireFn = require) {
  try {
    return requireFn("@deepseek-ai/dsh-settings") ?? {};
  } catch (error) {
    if (
      error?.code === "MODULE_NOT_FOUND" ||
      error?.code === "ERR_MODULE_NOT_FOUND"
    ) {
      return {};
    }
    throw error;
  }
}

const settingsModule = loadOptionalSettingsModule();

const fields = {
  /** Runtime master switch; the settings namespace remains available for re-enabling. */
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
  /** Register the deterministic /trellis-status, /trellis-finish, and /trellis-doctor commands. */
  commandsEnabled: z
    .boolean()
    .default(true)
    .description(
      "Register /trellis-status, read-only /trellis-finish, and the /trellis-doctor template helper.",
    ),
};

/**
 * Mark a Schemastery field `.volatile()` when the host supports volatile config.
 * Legacy `@deepseek-ai/dsh-settings` (0.1.5/0.1.6) lacks `SettingsForms` and
 * expects plain values, while minimal 0.2.x profiles omit `dsh-settings` (`{}`)
 * and retain volatile Schemastery support.
 *
 * @template T
 * @param {T & { volatile?: () => T }} field
 * @param {Record<string, unknown>} [settings]
 * @returns {T}
 */
export function volatile(field, settings = settingsModule) {
  if (typeof field?.volatile !== "function") return field;
  if (
    settings !== null &&
    typeof settings === "object" &&
    Object.keys(settings).length > 0
  ) {
    return typeof settings.SettingsForms === "function"
      ? field.volatile()
      : field;
  }
  return field.volatile();
}

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isVolatileRef(value) {
  return typeof value === "object" && value !== null && VOLATILE_WRITE in value;
}

// Legacy Settings validates plain values; profile-backed Settings exposes only
// volatile fields. Select the schema from the host capability, not a version.
export const Config = z.object(
  Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, volatile(field)]),
  ),
);

export function hasLiveConfig(config) {
  if (!isPlainRecord(config)) return false;
  return Object.values(config).some(isVolatileRef);
}

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
export function resolveConfig(raw) {
  const entries = isPlainRecord(raw) ? Object.entries(raw) : [];
  const config = Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      isVolatileRef(value) ? value.get() : value,
    ]),
  );
  const maxBytes =
    Number.isSafeInteger(config.maxBytes) && config.maxBytes >= 0
      ? config.maxBytes === 0
        ? 0
        : config.maxBytes
      : 4096;
  const projectRootMarkers = Array.isArray(config.projectRootMarkers)
    ? [
        ...new Set(
          config.projectRootMarkers
            .filter((entry) => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ]
    : [".git"];
  return {
    enabled: typeof config.enabled === "boolean" ? config.enabled : true,
    maxBytes,
    projectRootMarkers,
    skipKeyword:
      typeof config.skipKeyword === "string"
        ? config.skipKeyword.trim()
        : "no-trellis",
    pythonCmd:
      typeof config.pythonCmd === "string" ? config.pythonCmd.trim() : "",
    commandsEnabled:
      typeof config.commandsEnabled === "boolean"
        ? config.commandsEnabled
        : true,
  };
}
