/**
 * Per-turn workflow-state breadcrumb: composition, dedupe, and visibility.
 *
 * @module dsh-trellis/breadcrumb
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { join } from "node:path";
import { resolveTrellisState, sanitizeContextKey } from "./workflow.js";
import { nodeFs } from "./node-fs.js";

export const SOURCE_KIND = "dsh-trellis";
export const SOURCE_FORM = "breadcrumb";

/**
 * Truncate UTF-8 text to a byte budget without splitting a code point.
 * @param {string} value
 * @param {number} maxBytes
 * @returns {string}
 */
export function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  let end = Math.max(0, Math.trunc(maxBytes));
  while (end > 0 && (bytes.readUInt8(end) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

/**
 * Compose the model-visible breadcrumb message for a resolved state.
 * @param {{status: string, taskPath: string | null, body: string, digest: string}} state
 * @param {number} maxBytes
 * @returns {ReturnType<typeof createUserMessage>}
 */
export function breadcrumbMessage(state, maxBytes) {
  const taskLine = state.taskPath === null ? "" : `\nActive task: ${state.taskPath}`;
  const text = truncateUtf8(
    `<system-reminder>\nTrellis workflow state: ${state.status}${taskLine}\n\n${state.body}\n</system-reminder>`,
    maxBytes,
  );
  return createUserMessage({
    content: [{ type: "text", text }],
    source: {
      kind: SOURCE_KIND,
      form: SOURCE_FORM,
      status: state.status,
      task: state.taskPath,
      digest: state.digest,
    },
  });
}

/** Whether a user message carries our breadcrumb source. */
export function isBreadcrumbMessage(message) {
  const source = message?.source;
  return (
    typeof source === "object" &&
    source !== null &&
    source.kind === SOURCE_KIND &&
    source.form === SOURCE_FORM
  );
}

/** Whether the same breadcrumb payload is already visible in the session surface. */
export function isBreadcrumbVisible(agent, digest) {
  const visibleSeqs = new Set(agent.session.surface.nodes);
  for (const [seq, event] of agent.session.events.entries()) {
    if (!visibleSeqs.has(seq) || event.type !== "user/message") continue;
    const source = event.data?.source;
    if (source?.kind === SOURCE_KIND && source?.form === SOURCE_FORM && source.digest === digest) {
      return true;
    }
  }
  return false;
}

/**
 * Does the claimed prompt batch contain the skip keyword as a standalone word?
 * @param {Array<{content?: unknown}>} messages
 * @param {string} keyword
 */
export function hasSkipKeyword(messages, keyword) {
  if (!keyword) return false;
  const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  for (const message of messages) {
    const content = message?.content;
    const parts = Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }];
    for (const part of parts) {
      if (typeof part?.text === "string" && pattern.test(part.text)) return true;
    }
  }
  return false;
}

/**
 * Build the plugin-owned pre-step composer.
 * @param {object} resolved - normalized plugin config.
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @returns {{ compose(agent: any, messages: any[], signal: AbortSignal): Promise<any> }}
 */
export function createBreadcrumbComposer(resolved, ctx) {
  const cache = new Map();
  const lastInjected = new WeakMap();

  const compose = async (agent, messages, signal) => {
    if (resolved.maxBytes <= 0 || !Number.isFinite(resolved.maxBytes)) return undefined;
    if (hasSkipKeyword(messages, resolved.skipKeyword)) return undefined;
    const cwd = agent.session.header.cwd ?? process.cwd();
    const sessionId = agent.session.header.id ?? "";
    const contextKey = sessionId === "" ? "dsh" : `dsh_${sanitizeContextKey(sessionId)}`;
    signal?.throwIfAborted();
    const state = await resolveTrellisState({
      cwd,
      markers: resolved.projectRootMarkers,
      contextKey,
      fs: nodeFs,
      cache,
    });
    signal?.throwIfAborted();
    if (state === null) return undefined;
    const previous = lastInjected.get(agent.session);
    if (previous !== undefined && previous.digest === state.digest) {
      if (isBreadcrumbVisible(agent, state.digest)) return undefined;
    }
    lastInjected.set(agent.session, { digest: state.digest });
    return breadcrumbMessage(state, resolved.maxBytes);
  };

  return { compose };
}
