import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { breadcrumbMessage } from "../lib/breadcrumb.js";
import {
  BREADCRUMB_PROJECTION_KEY as KEY,
  breadcrumbFingerprint,
  breadcrumbProjection,
  registerBreadcrumbProjection,
} from "../lib/breadcrumb-projection.js";
import { sessionRuntime } from "./helpers/session-runtime.js";

const crumb = (digest = "A", maxBytes = 4096) => breadcrumbMessage(
  { status: "no_task", taskPath: null, body: `Workflow ${digest}`, digest },
  maxBytes,
);
const user = (text) => createUserMessage({ content: [{ type: "text", text }] });
const append = (session, message) => session.append("user/message", message, { surfaceOp: "append" });
const replace = (session, seqs, message = user("Compacted history")) =>
  session.append("user/message", message, {
    surfaceOp: { op: "replace", startSeq: seqs[0], endSeq: seqs.at(-1) },
    sourceEventSeqs: seqs,
  });

test("projection ignores unrelated events and retains only stable payload fingerprints", () => {
  const initial = breadcrumbProjection.init();
  const message = crumb();
  assert.equal(breadcrumbProjection.apply(initial, { type: "turn/start" }), initial);
  assert.equal(breadcrumbProjection.apply(initial, { type: "user/message", data: user("hello") }), initial);
  const state = breadcrumbProjection.apply(initial, { seq: 0, type: "user/message", data: message });
  assert.deepEqual(initial, {});
  assert.deepEqual(breadcrumbProjection.stateSchema.parse(state), { 0: breadcrumbFingerprint(message) });
  const reordered = { ...crumb(), source: Object.fromEntries(Object.entries(message.source).reverse()) };
  assert.equal(breadcrumbFingerprint(message), breadcrumbFingerprint(reordered));
  assert.notEqual(breadcrumbFingerprint(message), breadcrumbFingerprint(crumb("A", 30)));
  assert.notEqual(breadcrumbFingerprint(message), breadcrumbFingerprint({ ...message, source: { ...message.source, task: "changed" } }));
  assert.throws(() => breadcrumbProjection.stateSchema.parse({ 0: "invalid" }));
});

test("late registration replays existing Session history without exposing host state on the wire", async (t) => {
  const ctx = await sessionRuntime(t);
  const session = ctx.sessions.create("late-registration");
  append(session, crumb());
  const projection = registerBreadcrumbProjection(ctx);
  assert.equal(projection.isVisible(session, crumb()), true);
  assert.deepEqual(ctx.sessionProjections.snapshot(session).values, {});
  assert.equal(ctx.sessionProjections.checkpoint(session)[KEY].ver, 1);
});

test("live projection advances from committed events without synchronous history reads", async (t) => {
  const ctx = await sessionRuntime(t);
  const projection = registerBreadcrumbProjection(ctx);
  const session = ctx.sessions.create("incremental");
  for (const method of ["snapshotEvents", "eventAt", "ownEvents"]) {
    t.mock.method(session, method, () => { throw new Error(`Unexpected ${method}`); });
  }
  append(session, crumb("A"));
  assert.equal(projection.isVisible(session, crumb("A")), true);
  append(session, user("Unrelated user prompt"));
  assert.equal(projection.isVisible(session, crumb("A")), true);
  append(session, crumb("B"));
  assert.equal(projection.isVisible(session, crumb("A")), false);
  assert.equal(projection.isVisible(session, crumb("B")), true);
  append(session, crumb("A"));
  assert.equal(projection.isVisible(session, crumb("A")), true);
});

test("compaction removes visibility and an identical payload can be reinjected", async (t) => {
  const ctx = await sessionRuntime(t);
  const projection = registerBreadcrumbProjection(ctx);
  const session = ctx.sessions.create("compaction");
  append(session, crumb());
  replace(session, [...session.surface.nodes]);
  assert.equal(projection.isVisible(session, crumb()), false);
  append(session, crumb());
  assert.equal(projection.isVisible(session, crumb()), true);
});

test("surface order wins over event sequence after an early-node replacement", async (t) => {
  const ctx = await sessionRuntime(t);
  const projection = registerBreadcrumbProjection(ctx);
  const session = ctx.sessions.create("surface-order");
  append(session, crumb("A"));
  append(session, crumb("B"));
  replace(session, [0], crumb("C"));
  assert.deepEqual(session.surface.nodes, [2, 1]);
  assert.equal(projection.isVisible(session, crumb("B")), true);
  assert.equal(projection.isVisible(session, crumb("C")), false);
});

test("provenance does not erase a still-visible breadcrumb", async (t) => {
  const ctx = await sessionRuntime(t);
  const projection = registerBreadcrumbProjection(ctx);
  const session = ctx.sessions.create("provenance");
  append(session, crumb());
  append(session, user("Other text"));
  session.append("user/message", user("Rewrite"), {
    surfaceOp: { op: "replace", startSeq: 1, endSeq: 1 }, sourceEventSeqs: [0, 1],
  });
  assert.equal(projection.isVisible(session, crumb()), true);
});

test("resumed and forked sessions dedupe on their first read and stay isolated", async (t) => {
  const ctx = await sessionRuntime(t);
  const projection = registerBreadcrumbProjection(ctx);
  const parent = ctx.sessions.create("parent");
  const seed = [append(parent, crumb())];
  const resumed = ctx.sessions.create("resumed", { seed });
  const fork = ctx.sessions.create("fork", {
    seed, inheritedEventCount: seed.length,
    meta: { isSeeded: true, parentSession: parent.id },
  });
  assert.equal(projection.isVisible(resumed, crumb()), true);
  assert.equal(projection.isVisible(fork, crumb()), true);
  append(fork, crumb("B"));
  assert.equal(projection.isVisible(fork, crumb()), false);
  assert.equal(projection.isVisible(parent, crumb()), true);
  assert.equal(projection.isVisible(ctx.sessions.create("unrelated"), crumb()), false);
});

test("checkpoint JSON roundtrip and tail replay produce the same domain state", async (t) => {
  const ctx = await sessionRuntime(t);
  registerBreadcrumbProjection(ctx);
  const session = ctx.sessions.create("checkpoint");
  const events = [append(session, crumb())];
  const checkpoint = JSON.parse(JSON.stringify(ctx.sessionProjections.checkpoint(session)));
  events.push(append(session, crumb("B")));
  const floor = ctx.sessionProjections.restoreFloor(checkpoint);
  const restored = ctx.sessionProjections.restore(
    checkpoint, events.filter((event) => event.seq >= floor), floor, session.header, session.inheritedEventCount,
  );
  assert.deepEqual(restored.checkpoint, ctx.sessionProjections.checkpoint(session));
  assert.deepEqual(restored.snapshot.values, {});
  checkpoint[KEY].val[0] = "0".repeat(64);
  assert.notDeepEqual(checkpoint[KEY].val, ctx.sessionProjections.stateOf(session, KEY));
});

test("registration reference counts and runtime remount preserve replay correctness", async (t) => {
  const ctx = await sessionRuntime(t);
  const session = ctx.sessions.create("reload");
  const first = registerBreadcrumbProjection(ctx);
  const second = registerBreadcrumbProjection(ctx);
  append(session, crumb());
  first.dispose();
  assert.equal(second.isVisible(session, crumb()), true);
  second.dispose();
  assert.equal(ctx.sessionProjections.stateOf(session, KEY), undefined);
  assert.throws(() => second.isVisible(session, crumb()), /not registered/);
  const reloaded = registerBreadcrumbProjection(ctx);
  assert.equal(reloaded.isVisible(session, crumb()), true);
});

test("Cordis unload removes only the owning plugin's projection", async (t) => {
  const ctx = await sessionRuntime(t);
  const fiber = ctx.plugin({
    inject: ["sessionProjections"],
    apply(owner) {
      registerBreadcrumbProjection(owner);
    },
  });
  await fiber.await();
  const session = ctx.sessions.create("owning-scope");
  append(session, crumb());
  assert.ok(ctx.sessionProjections.stateOf(session, KEY)[0]);
  await fiber.dispose();
  assert.equal(ctx.sessionProjections.stateOf(session, KEY), undefined);
  assert.ok(ctx.sessions.get(session.id));
});

test("legacy registry uses a schema-validated projection view, not a Session snapshot", () => {
  let definition;
  let removed = false;
  const registry = {
    register(value) { definition = value; return () => { removed = true; }; },
    snapshot() {
      const state = definition.apply(definition.init(), { seq: 5, type: "user/message", data: crumb() });
      return { values: { [KEY]: definition.schema.parse(definition.view(state)) } };
    },
  };
  const projection = registerBreadcrumbProjection({ sessionProjections: registry });
  const session = { surface: { nodes: [5] } };
  assert.equal(projection.isVisible(session, crumb()), true);
  assert.equal(projection.isVisible(session, crumb("B")), false);
  projection.dispose();
  assert.equal(removed, true);
  assert.throws(() => registerBreadcrumbProjection({}), /requires.*sessionProjections/);
});

test("production modules never read synchronous Session history", async () => {
  const directory = new URL("../lib/", import.meta.url);
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".js")) continue;
    const source = await readFile(new URL(file, directory), "utf8");
    assert.doesNotMatch(source, /\b(?:eventAt|snapshotEvents|ownEvents)\s*\(|\bsession\.events\b/, file);
  }
});
