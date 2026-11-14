import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWaitTool } from "../lib/wait-tool.js";

const row = { id: "checker-id", name: "checker", createdAt: 123, mode: "continuable" };
function harness(t, options = {}) {
  const handlers = new Set();
  const parent = { id: "reviewer-id", ctx: { on() { throw new Error("wrong parent scope"); } } };
  const root = { id: "root-id", ctx: { on(event, fn) {
    assert.equal(event, "subagent/end"); handlers.add(fn); return () => handlers.delete(fn);
  } } };
  let tool;
  let observations = 0;
  let disposals = 0;
  const observation = {
    projections: options.missingCatalog ? undefined : { values: { subagentCatalog: options.entries ?? [row] } },
    [Symbol.dispose]() { disposals++; },
  };
  const dispose = registerWaitTool({
    tools: { register(value) { tool = value; return () => {}; } },
    subagents: {
      rootOf(agent) { assert.equal(agent, parent); return root; },
      async resolveName(agent, name, signal) {
        assert.equal(agent, parent);
        return options.resolveName ? options.resolveName(name, signal)
          : name === "reviewer/checker" ? row.id : name;
      },
    },
    get(name) {
      if (name === "sessionQuery") return options.missingQuery ? undefined : {
        async observeSession(id, { signal }) {
          assert.equal(id, parent.id); observations++;
          return options.observe ? options.observe(signal, observation) : observation;
        },
      };
      assert.equal(name, "sessions");
      return { get(id) {
        assert.equal(id, row.id);
        return options.inactive ? undefined : { header: {
          id, parentSession: parent.id, origin: "subagent", createdAt: 123, ...options.header,
        } };
      } };
    },
  });
  t.after(dispose);
  return {
    tool, dispose, handlers,
    run: (name = "reviewer/checker", signal) => tool.execute({ subagent_id: name }, { agent: parent, signal }),
    end(info = {}) { for (const fn of [...handlers]) fn({ id: row.id, parentSessionId: parent.id, stopReason: "completed", ...info }); },
    observed: () => observations,
    disposed: () => disposals,
  };
}

test("named nested wait uses the root scope and returns a stable Session id", async (t) => {
  const h = harness(t);
  const pending = h.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.disposed(), 1, "catalog observation ends before waiting");
  h.end({ parentSessionId: "sibling-id" });
  assert.equal(h.handlers.size, 1, "another direct creator cannot settle this wait");
  h.end();
  assert.equal((await pending).subagentId, row.id);
  assert.equal(h.handlers.size, 0);
});

for (const phase of ["resolve", "catalog"]) {
  test(`settlement during named ${phase} lookup is retained`, async (t) => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const h = harness(t, phase === "resolve" ? {
      async resolveName() { entered.resolve(); await release.promise; return row.id; },
    } : {
      async observe(_signal, observation) { entered.resolve(); await release.promise; return observation; },
    });
    const pending = h.run();
    await entered.promise;
    h.end({ stopReason: "aborted" });
    release.resolve();
    assert.equal((await pending).outcome, "aborted");
    assert.equal(h.disposed(), 1);
    assert.equal(h.handlers.size, 0);
  });
}

test("a stable Session id and a cold named child remain supported without claiming success", async (t) => {
  const h = harness(t, { inactive: true });
  const result = await h.run(row.id);
  assert.equal(result.subagentId, row.id);
  assert.equal(result.state, "already-inactive");
  assert.equal(result.outcome, "unknown");
  assert.equal(h.disposed(), 1);
});

for (const [label, options, expected] of [
  ["sibling", { entries: [] }, /direct continuable/],
  ["external", { entries: [{ ...row, mode: "external" }] }, /direct continuable/],
  ["missing query", { missingQuery: true }, /requires sessionQuery/],
  ["missing catalog", { missingCatalog: true }, /catalog is unavailable/],
  ["reused child id", { header: { createdAt: 456 } }, /lifecycle/],
]) test(`named wait rejects ${label} and releases all resources`, async (t) => {
  const h = harness(t, options);
  await assert.rejects(h.run(), expected);
  assert.equal(h.handlers.size, 0);
  assert.equal(h.disposed(), options.missingQuery ? 0 : 1);
});

test("a captured end cannot bypass the live child generation check", async (t) => {
  let h;
  h = harness(t, { header: { createdAt: 456 }, async resolveName() { h.end(); return row.id; } });
  await assert.rejects(h.run(), /lifecycle/);
  assert.equal(h.handlers.size, 0);
  assert.equal(h.disposed(), 1);
});

for (const phase of ["resolve", "catalog"]) {
  test(`named ${phase} failure preserves its error, even after an end event`, async (t) => {
    const error = new Error(`${phase} unavailable`);
    let h;
    const fail = async () => { h.end(); throw error; };
    h = harness(t, phase === "resolve" ? { resolveName: fail } : { observe: fail });
    await assert.rejects(h.run(), caught => caught === error);
    assert.equal(h.handlers.size, 0);
    assert.equal(h.disposed(), 0);
  });
}

for (const phase of ["resolve", "catalog"]) {
  test(`unload during named ${phase} lookup cannot report inactive success`, async (t) => {
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    let lookupSignal;
    const h = harness(t, { inactive: true, ...(phase === "resolve" ? {
      async resolveName(_name, signal) { lookupSignal = signal; entered.resolve(); await release.promise; return row.id; },
    } : {
      async observe(signal, observation) { lookupSignal = signal; entered.resolve(); await release.promise; return observation; },
    }) });
    const pending = h.run();
    const rejected = assert.rejects(pending, /unloaded/);
    await entered.promise;
    h.dispose();
    assert.equal(lookupSignal.aborted, true);
    assert.equal(h.handlers.size, 0);
    release.resolve();
    await rejected;
    assert.equal(h.disposed(), phase === "resolve" ? 0 : 1);
  });
}

test("root session rejects lead and slash paths without leaking resources", async (t) => {
  const handlers = new Set();
  const root = {
    id: "root-id",
    ctx: {
      on(event, fn) {
        assert.equal(event, "subagent/end");
        handlers.add(fn);
        return () => handlers.delete(fn);
      },
    },
  };
  let tool;
  let disposals = 0;
  const dispose = registerWaitTool({
    tools: { register(value) { tool = value; return () => {}; } },
    subagents: {
      rootOf(agent) { assert.equal(agent, root); return root; },
      async resolveName(caller, name) {
        assert.equal(caller, root);
        if (name === "lead") return root.id;
        if (name === "a/b") return "grandchild-id";
        if (name.includes("/")) throw new Error(`agent name ${JSON.stringify(name)} was not found`);
        return name;
      },
    },
    get(name) {
      assert.equal(name, "sessionQuery");
      return {
        async observeSession(id) {
          assert.equal(id, root.id);
          return {
            projections: { values: { subagentCatalog: [row] } },
            [Symbol.dispose]() { disposals++; },
          };
        },
      };
    },
  });
  t.after(dispose);

  await assert.rejects(
    tool.execute({ subagent_id: "lead" }, { agent: root }),
    /direct continuable subagent/,
  );
  assert.equal(disposals, 1);
  assert.equal(handlers.size, 0);

  await assert.rejects(
    tool.execute({ subagent_id: "a/b" }, { agent: root }),
    /direct continuable subagent/,
  );
  assert.equal(disposals, 2);
  assert.equal(handlers.size, 0);

  await assert.rejects(
    tool.execute({ subagent_id: "missing/child" }, { agent: root }),
    /was not found/,
  );
  assert.equal(disposals, 2);
  assert.equal(handlers.size, 0);
});
