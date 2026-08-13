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

/** Workflow-state block charset, mirrored from Trellis's workflow.md contract. */
const STATUS_RE =
  /\[workflow-state:([A-Za-z0-9_-]+)\]([\s\S]*?)\[\/workflow-state:\1\]/g;

/** Same sanitization Trellis task.py applies to context keys. */
export function sanitizeContextKey(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
}

/** The degrading fallback when workflow.md lacks a block for the resolved status. */
export const FALLBACK_BREADCRUMB =
  "Refer to `.trellis/workflow.md` for the current workflow step (no matching [workflow-state] block found).";

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
    if (info === null) return null;
    const hit = cache.get(path);
    if (hit !== undefined && hit.mtimeMs === info.mtimeMs) return hit.content;
    const content = await fs.readFile(path);
    cache.set(path, { mtimeMs: info.mtimeMs, content });
    return content;
  } catch {
    return null;
  }
}

/**
 * Resolve the active task for a dsh session.
 *
 * Canonical Trellis semantics are session-pointer-driven. If this session has
 * no usable pointer, mirror `active_task.py`'s conservative class-2 fallback:
 * infer a task only when the runtime contains exactly one session JSON file.
 * Two or more files means multiple windows may be active, so the resolver
 * refuses to guess even when one task happens to be newer.
 *
 * @param {string} root - project root.
 * @param {string} contextKey - sanitized `dsh_<session-id>` key for this agent.
 * @param {{listDir(path: string): Promise<string[]>, readFile(path: string): Promise<string | null>, stat(path: string): Promise<{mtimeMs: number} | null>}} fs
 * @returns {Promise<{path: string, status: string} | null>} task dir-relative path + status.
 */
export async function resolveActiveTask(root, contextKey, fs) {
  // 1. Session-scoped pointer (task.py start / create).
  const sessionsDir = join(root, ".trellis", ".runtime", "sessions");
  let names = [];
  try {
    names = await fs.listDir(sessionsDir);
  } catch {
    names = [];
  }
  for (const name of names) {
    if (name !== `${contextKey}.json`) continue;
    let data = null;
    try {
      data = JSON.parse((await fs.readFile(join(sessionsDir, name))) ?? "null");
    } catch {
      continue;
    }
    if (
      data === null ||
      typeof data !== "object" ||
      typeof data.current_task !== "string"
    )
      continue;
    const status = await readTaskStatus(root, data.current_task, fs);
    if (status !== null) return { path: data.current_task, status };
  }

  // 2. Official single-session fallback. Count files before parsing so one
  // malformed pointer cannot make a multi-window runtime look unambiguous.
  const sessionFiles = names.filter((name) => name.endsWith(".json"));
  if (sessionFiles.length !== 1) return null;

  let fallback = null;
  try {
    fallback = JSON.parse(
      (await fs.readFile(join(sessionsDir, sessionFiles[0]))) ?? "null",
    );
  } catch {
    return null;
  }
  if (
    fallback === null ||
    typeof fallback !== "object" ||
    typeof fallback.current_task !== "string" ||
    fallback.current_task === ""
  ) {
    return null;
  }
  const status = await readTaskStatus(root, fallback.current_task, fs);
  return status === null ? null : { path: fallback.current_task, status };
}

/**
 * Read one task.json status, or null when missing/unparseable.
 * @param {string} root
 * @param {string} taskPath - repo-root relative task dir (e.g. `.trellis/tasks/04-17-foo`).
 * @param {{readFile(path: string): Promise<string | null>}} fs
 * @returns {Promise<string | null>}
 */
export async function readTaskStatus(root, taskPath, fs) {
  try {
    const data = JSON.parse(
      (await fs.readFile(join(root, taskPath, "task.json"))) ?? "null",
    );
    if (
      data !== null &&
      typeof data === "object" &&
      typeof data.status === "string"
    ) {
      return data.status;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Map a task.json status to a workflow-state breadcrumb status.
 * @param {string | null} status
 * @returns {"planning" | "in_progress" | "no_task"}
 */
export function mapStatus(status) {
  if (status === "planning") return "planning";
  if (status === "in_progress") return "in_progress";
  return "no_task";
}

/**
 * Resolve the full Trellis state for one session step.
 * @param {object} options
 * @param {string} options.cwd
 * @param {string[]} options.markers
 * @param {string} options.contextKey - sanitized session context key.
 * @param {object} options.fs - filesystem shim ({exists, listDir, readFile, stat}).
 * @param {Map<string, {mtimeMs: number, content: string | null}>} options.cache
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
  const workflowPath = join(root, ".trellis", "workflow.md");
  const content = await readCached(workflowPath, fs, cache);
  if (content === null || content === undefined) return null;
  const blocks = parseWorkflowStateBlocks(content);
  if (blocks.size === 0) return null;
  const task = await resolveActiveTask(root, contextKey, fs);
  const status = mapStatus(task?.status ?? null);
  const body = blocks.get(status) ?? FALLBACK_BREADCRUMB;
  const digest = createHash("sha1")
    .update(`${status}\n${task?.path ?? ""}\n${body}`)
    .digest("hex");
  return { root, status, taskPath: task?.path ?? null, body, digest };
}
