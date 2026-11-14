/**
 * Trellis project state resolution: project root, workflow-state blocks,
 * active task pointer, and status mapping.
 *
 * Pure logic with an injectable filesystem shim so unit tests run without
 * touching a real Trellis project.
 *
 * @module dsh-trellis/workflow
 */
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

/** Workflow-state block and workflow id charset, mirrored from Trellis's workflow.md contract. */
const WORKFLOW_SLUG_RE = /^[A-Za-z0-9_-]+$/;
const STATUS_RE =
  /\[workflow-state:([A-Za-z0-9_-]+)\]([\s\S]*?)\[\/workflow-state:\1\]/g;
const MAX_CACHE_ENTRIES = 64;

/** Same sanitization Trellis task.py applies to context keys. */
export function sanitizeContextKey(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 160)
    .replace(/^[._-]+|[._-]+$/g, "");
}

/** The degrading fallback when workflow.md lacks a block for the resolved status. */
export const FALLBACK_BREADCRUMB =
  "Refer to `.trellis/workflow.md` for the current workflow step (no matching [workflow-state] block found).";

/** Old workflows may not yet define task_error; never turn a bad record into no_task. */
export const TASK_ERROR_BREADCRUMB =
  "The active task record could not be read. Do not create or activate another task. " +
  "Inspect the active task directory and repair its task.json (a JSON object with a non-empty status). " +
  "Preserve existing fields and artifacts; ask the user if the correct status is uncertain.";

/**
 * Parse every `[workflow-state:STATUS] ... [/workflow-state:STATUS]` block.
 * @param {string} content - workflow.md content.
 * @returns {Map<string, string>} status → trimmed body.
 */
export function parseWorkflowStateBlocks(content) {
  const blocks = new Map();
  for (const match of content.matchAll(STATUS_RE)) {
    blocks.set(match[1], match[2].trim());
  }
  return blocks;
}

/**
 * Walk upward from cwd to the first directory containing one of the markers.
 * @param {string} cwd - absolute starting directory.
 * @param {string[]} markers - child names that identify a project root.
 * @param {{exists(path: string): Promise<boolean>}} fs - filesystem shim.
 * @returns {Promise<string | null>}
 */
export async function findProjectRoot(cwd, markers, fs) {
  let current = resolve(cwd);
  for (;;) {
    for (const marker of markers) {
      if (await fs.exists(join(current, marker))) return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Read a file, returning null when absent. Cache by (path, mtimeMs) so the
 * per-turn hot path does not re-read workflow.md on every step.
 * @param {string} path
 * @param {{readFile(path: string): Promise<string | null>, stat(path: string): Promise<{mtimeMs: number} | null>}} fs
 * @param {Map<string, {mtimeMs: number, content: string | null}>} cache
 * @returns {Promise<string | null>}
 */
export async function readCached(path, fs, cache) {
  try {
    const info = await fs.stat(path);
    if (info === null) {
      cache.delete(path);
      return null;
    }
    const hit = cache.get(path);
    if (hit !== undefined && hit.mtimeMs === info.mtimeMs) return hit.content;
    const content = await fs.readFile(path);
    if (!cache.has(path) && cache.size >= MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(path, { mtimeMs: info.mtimeMs, content, blocks: undefined });
    return content;
  } catch {
    cache.delete(path);
    return null;
  }
}

async function readWorkflowBlocks(path, fs, cache) {
  const content = await readCached(path, fs, cache);
  if (content === null || content === undefined) return null;
  const entry = cache?.get?.(path);
  if (entry !== undefined && entry.content === content) {
    if (entry.blocks === undefined) {
      entry.blocks = parseWorkflowStateBlocks(content);
    }
    return entry.blocks;
  }
  return parseWorkflowStateBlocks(content);
}

function parseScalarValue(raw, { yamlNull = false } = {}) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  let value;
  if (trimmed.startsWith('"')) {
    const quoted = /^"((?:\\.|[^"\\])*)"(?:\s*(?:#.*)?)?$/.exec(trimmed);
    value = quoted ? quoted[1] : trimmed;
  } else if (trimmed.startsWith("'")) {
    const quoted = /^'([^']*)'(?:\s*(?:#.*)?)?$/.exec(trimmed);
    value = quoted ? quoted[1] : trimmed;
  } else {
    value = trimmed.replace(/\s+#.*$/, "");
  }
  value = value.trim();
  if (!value) return null;
  if (yamlNull && (value === "null" || value === "~")) return null;
  return value;
}

function parseDeveloperWorkflow(content) {
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^workflow\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = parseScalarValue(match[1]);
    if (value !== null) return value;
  }
  return null;
}

function parseConfigDefaultWorkflow(content) {
  for (const rawLine of String(content).split(/\r?\n/)) {
    if (/^\s*(?:#|$)/.test(rawLine)) continue;
    const match = /^default_workflow\s*:\s*(.*)$/.exec(rawLine);
    if (!match) continue;
    const value = parseScalarValue(match[1], { yamlNull: true });
    if (value !== null) return value;
  }
  return null;
}

async function resolveWorkflowBlocks(root, taskWorkflow, fs, cache) {
  let selectedId = taskWorkflow;
  if (selectedId === null) {
    const devContent = await readCached(
      join(root, ".trellis", ".developer"),
      fs,
      cache,
    );
    if (devContent !== null && devContent !== undefined) {
      selectedId = parseDeveloperWorkflow(devContent);
    }
  }
  if (selectedId === null) {
    const configContent = await readCached(
      join(root, ".trellis", "config.yaml"),
      fs,
      cache,
    );
    if (configContent !== null && configContent !== undefined) {
      selectedId = parseConfigDefaultWorkflow(configContent);
    }
  }
  if (
    selectedId !== null &&
    selectedId !== "default" &&
    WORKFLOW_SLUG_RE.test(selectedId)
  ) {
    const customBlocks = await readWorkflowBlocks(
      join(root, ".trellis", "workflows", `${selectedId}.md`),
      fs,
      cache,
    );
    if (customBlocks !== null) return customBlocks;
  }
  return readWorkflowBlocks(join(root, ".trellis", "workflow.md"), fs, cache);
}

/**
 * Resolve the active task for a dsh session.
 *
 * Read only this session's pointer. A sole foreign session is not proof of
 * ownership (Trellis #608). Child agents receive an explicit Active task:
 * dispatch prompt; they must not borrow arbitrary session bindings here.
 * Once bound, an unreadable task record is task_error, not an absent task.
 *
 * @param {string} root - project root.
 * @param {string} contextKey - sanitized `dsh_<session-id>` key for this agent.
 * @param {{readFile(path: string): Promise<string | null>}} fs
 * @returns {Promise<{path: string, status: string, workflow: string | null} | null>} task dir-relative path, status, and optional workflow id.
 */
export async function resolveActiveTask(root, contextKey, fs) {
  if (!contextKey) return null;
  const pointer = join(
    root, ".trellis", ".runtime", "sessions", `${contextKey}.json`,
  );
  let data = null;
  try {
    data = JSON.parse((await fs.readFile(pointer)) ?? "null");
  } catch {
    return null;
  }
  if (
    data === null ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.current_task !== "string" ||
    data.current_task.trim() === ""
  ) {
    return null;
  }
  const { status, workflow } = await readTaskRecord(root, data.current_task, fs);
  return {
    path: data.current_task,
    status: status ?? "task_error",
    workflow,
  };
}

async function readTaskRecord(root, taskPath, fs) {
  try {
    const data = JSON.parse(
      (await fs.readFile(join(root, taskPath, "task.json"))) ?? "null",
    );
    if (
      data !== null &&
      typeof data === "object" &&
      !Array.isArray(data)
    ) {
      const status =
        typeof data.status === "string" && data.status.trim() !== ""
          ? data.status
          : null;
      const workflow =
        typeof data.workflow === "string" && data.workflow.trim() !== ""
          ? data.workflow.trim()
          : null;
      return { status, workflow };
    }
    return { status: null, workflow: null };
  } catch {
    return { status: null, workflow: null };
  }
}

/**
 * Read a non-empty task.json status, or null for an unreadable/invalid record.
 * @param {string} root
 * @param {string} taskPath - repo-root relative task dir (e.g. `.trellis/tasks/04-17-foo`).
 * @param {{readFile(path: string): Promise<string | null>}} fs
 * @returns {Promise<string | null>}
 */
export async function readTaskStatus(root, taskPath, fs) {
  const { status } = await readTaskRecord(root, taskPath, fs);
  return status;
}

/**
 * Map a task.json status to a workflow-state breadcrumb status.
 * @param {unknown} status
 * @returns {string}
 */
export function mapStatus(status) {
  if (status === null || status === undefined) return "no_task";
  if (typeof status !== "string") return "task_error";
  const trimmed = status.trim();
  if (trimmed === "") return "no_task";
  return WORKFLOW_SLUG_RE.test(trimmed) ? trimmed : "task_error";
}

/**
 * Resolve the full Trellis state for one session step.
 * @param {object} options
 * @param {string} options.cwd
 * @param {string[]} options.markers
 * @param {string} options.contextKey - sanitized session context key.
 * @param {object} options.fs - filesystem shim ({exists, readFile, stat}).
 * @param {Map<string, {mtimeMs: number, content: string | null, blocks?: Map<string, string>}>} options.cache
 * @returns {Promise<{root: string, status: string, taskPath: string | null, body: string, digest: string} | null>}
 */
export async function resolveTrellisState({
  cwd,
  markers,
  contextKey,
  fs,
  cache,
}) {
  const root = await findProjectRoot(cwd, markers, fs);
  if (root === null) return null;
  const task = await resolveActiveTask(root, contextKey, fs);
  const blocks = await resolveWorkflowBlocks(
    root,
    task?.workflow ?? null,
    fs,
    cache,
  );
  if (blocks === null || blocks.size === 0) return null;
  const status = mapStatus(task?.status ?? null);
  const body =
    status === "task_error"
      ? blocks.get(status) || TASK_ERROR_BREADCRUMB
      : blocks.get(status) ?? FALLBACK_BREADCRUMB;
  const digest = createHash("sha1")
    .update(`${status}\n${task?.path ?? ""}\n${body}`)
    .digest("hex");
  return { root, status, taskPath: task?.path ?? null, body, digest };
}
