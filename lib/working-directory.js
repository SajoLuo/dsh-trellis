import { isAbsolute } from "node:path";

/** Resolve each operation's current directory without changing session identity. */
export async function resolveWorkingDirectory(ctx, agent, signal) {
  signal?.throwIfAborted();
  const owner = agent?.ctx ?? ctx;
  const service = agent ? owner.get?.("workingDirectory") : undefined;
  if (service === undefined) {
    return agent?.session?.header?.cwd ?? process.cwd();
  }
  // An available service owns validation/recovery. Never hide its failures by
  // falling back to the original project and inspecting the wrong task.
  if (typeof service.ensure !== "function") {
    throw new Error("DSH workingDirectory service does not support ensure().");
  }
  const cwd = await service.ensure(agent, signal);
  signal?.throwIfAborted();
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    throw new Error("DSH workingDirectory service returned an invalid directory.");
  }
  return cwd;
}
