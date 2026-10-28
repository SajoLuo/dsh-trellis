import assert from "node:assert/strict";
import { createServer } from "node:http";

/** Script only the model's decisions; the HTTP adapter, host and tools are real. */
export async function modelServer(mode, rootId) {
  const requests = [];
  const stages = new Map();
  const children = new Map();
  const childIds = new Map();
  const gates = new Map();
  const waitStarted = Promise.withResolvers();
  let taskPath;
  const deferred = (map, key) => {
    if (!map.has(key)) map.set(key, Promise.withResolvers());
    return map.get(key);
  };
  const shell = process.platform === "win32" ? "pwsh" : "bash";
  const command = (action) => ({ name: shell, arguments: { command: `python${process.platform === "win32" ? "" : "3"} -X utf8 e2e-fixture.py ${action}`, description: `Run E2E ${action} action` } });
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, "/v1/chat/completions");
      let body = "";
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body);
      requests.push(input);
      assert.ok(requests.length <= 100, "unexpected model loop");
      const text = JSON.stringify(input.messages);
      const root = [...text.matchAll(/E2E_ROOT:(\w+)/g)].at(-1)?.[1];
      const child = root ? undefined : [...text.matchAll(/E2E_CHILD:(\w+)/g)].at(-1)?.[1];
      const key = root ? `root:${root}` : `child:${child}`;
      const stage = stages.get(key) ?? 0;
      stages.set(key, stage + 1);
      let action;
      if (child) {
        if (stage === 0) {
          const gate = deferred(gates, child);
          await Promise.race([gate.promise, new Promise(resolve => res.once("close", resolve))]);
          if (res.destroyed) return;
          action = { name: "skill", arguments: { name: `trellis-agent-${child}` } };
        } else if (stage === 1) action = command(child);
        else if (stage === 2) action = { name: "send_message", arguments: { agent_id: rootId, message: `${child.toUpperCase()}_REPORT_OK` } };
      } else if (["bootstrap", "finish"].includes(root) && stage === 0) action = command(root);
      else if (["research", "implement", "check", "cancel"].includes(root)) {
        if (stage === 0) action = { name: "subagent", arguments: { description: `E2E ${root} role`, prompt: `Active task: ${taskPath}\nE2E_CHILD:${root}\nLoad only trellis-agent-${root}; carry out the assigned role and report to your parent.` } };
        if (stage === 1) {
          const childId = await deferred(childIds, root).promise;
          action = { name: "trellis_wait", arguments: { subagent_id: childId } };
        }
      } else if (root === "invalid" && stage === 0) action = { name: "trellis_wait", arguments: { subagent_id: "not-a-direct-child" } };
      const names = input.tools?.map(tool => tool.function.name) ?? [];
      if (action) {
        if (mode === "ptc") {
          assert.deepEqual(names, ["run_code"]);
          action = { name: "run_code", arguments: { code: `return await tools[${JSON.stringify(action.name)}](${JSON.stringify(action.arguments)});`, description: "Execute isolated E2E operation" } };
        } else assert.ok(names.includes(action.name), `missing native ${action.name}`);
      }
      const id = `e2e-${requests.length}`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      emit({ role: "assistant" });
      if (action) emit({ tool_calls: [{ index: 0, id, type: "function", function: { name: action.name, arguments: JSON.stringify(action.arguments) } }] });
      else emit({ content: `${key} complete` });
      emit({}, action ? "tool_calls" : "stop");
      res.end("data: [DONE]\n\n");
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    requests, waitStarted, children,
    setTask(path) { taskPath = path; },
    url: `http://127.0.0.1:${server.address().port}/v1`,
    observe(message) {
      if (message.method === "subagent.started") {
        assert.equal(message.params.parentSessionId, rootId, "roles cannot delegate recursively");
        const role = [...stages.keys()].filter(key => key.startsWith("root:")).at(-1).slice(5);
        children.set(role, message.params.childSessionId);
        deferred(childIds, role).resolve(message.params.childSessionId);
      }
      const event = message.method === "session.event" && message.params.event;
      if (["tool/call", "tool/ptc-dispatch-start"].includes(event?.type) && event.data.name === "trellis_wait") {
        const role = [...children].find(([, id]) => id === event.data.arguments?.subagent_id)?.[0];
        // Native tool/call stores JSON arguments; PTC stores the parsed value.
        const args = typeof event.data.arguments === "string" ? JSON.parse(event.data.arguments) : event.data.arguments;
        const actualRole = role ?? [...children].find(([, id]) => id === args?.subagent_id)?.[0];
        if (actualRole === "cancel") waitStarted.resolve();
        else if (actualRole) deferred(gates, actualRole).resolve();
      }
    },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
