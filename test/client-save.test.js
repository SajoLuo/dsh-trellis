import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import { DEFAULTS, savePlan } from "../src/client/form.js";

const writes = [{ field: "maxBytes", kind: "set", value: 512 }, { field: "pythonCmd", kind: "unset" }];
test("new form commits all edits atomically with the edit-start revision", async () => {
  let calls = 0;
  const scope = {
    async mutate(ops, revision) {
      calls++;
      assert.equal(revision, 7);
      assert.deepEqual(ops, [{ op: "set", path: ["maxBytes"], value: 512 }, { op: "unset", path: ["pythonCmd"] }]);
      return true;
    },
    getSnapshot: () => ({ user: { maxBytes: 512 } }),
    set() { assert.fail("not atomic"); }, unset() { assert.fail("not atomic"); },
  };
  assert.equal(await savePlan(scope, writes, 7), true);
  assert.equal(calls, 1);
});
test("refused/conflicting writes do not masquerade as a successful save", async () => {
  assert.equal(await savePlan({ mutate: async () => false, getSnapshot() { assert.fail("refusal is final"); } }, writes, 7), false);
  assert.equal(await savePlan({ mutate: async () => true, getSnapshot: () => ({ user: {} }) }, writes, 7), false);
  await assert.rejects(savePlan({ mutate: async () => { throw new Error("disconnected"); } }, writes, 7), /disconnected/);
});
test("legacy form retains sequential writes and stops on refusal", async () => {
  const calls = [];
  const scope = { set: async () => { calls.push("set"); return false; }, unset: async () => calls.push("unset") };
  assert.equal(await savePlan(scope, writes, 7), false);
  assert.deepEqual(calls, ["set"]);
});

function createNodeDom() {
  const eventTarget = () => ({
    listeners: new Map(),
    addEventListener(type, fn) {
      let set = this.listeners.get(type);
      if (!set) this.listeners.set(type, (set = new Set()));
      set.add(fn);
    },
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    },
  });
  const createElement = (tagName) => {
    const el = {
      ...eventTarget(),
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      nodeName: tagName.toUpperCase(),
      namespaceURI: "http://www.w3.org/1999/xhtml",
      attachEvent() {},
      detachEvent() {},
      childNodes: [],
      attributes: {},
      style: {},
      dataset: {},
      ownerDocument: null,
      parentNode: null,
      firstChild: null,
      lastChild: null,
      nextSibling: null,
      previousSibling: null,
      setAttribute(k, v) { this.attributes[k] = String(v); },
      removeAttribute(k) { delete this.attributes[k]; },
      remove() { this.parentNode?.removeChild(this); },
      get textContent() {
        return this.childNodes
          .map((child) => (child.nodeType === 3 ? child.data : child.textContent))
          .join("");
      },
      set textContent(value) {
        this.childNodes = [];
        const text = String(value ?? "");
        if (text !== "") this.appendChild(doc.createTextNode(text));
      },
      appendChild(child) { return this.insertBefore(child, null); },
      insertBefore(child, before) {
        child.parentNode = this;
        const idx = before ? this.childNodes.indexOf(before) : -1;
        if (idx >= 0) this.childNodes.splice(idx, 0, child);
        else this.childNodes.push(child);
        syncSiblings(this);
        return child;
      },
      removeChild(child) {
        const idx = this.childNodes.indexOf(child);
        if (idx >= 0) this.childNodes.splice(idx, 1);
        child.parentNode = null;
        child.previousSibling = null;
        child.nextSibling = null;
        syncSiblings(this);
        return child;
      },
      contains(node) {
        for (let cur = node; cur; cur = cur.parentNode) {
          if (cur === this) return true;
        }
        return false;
      },
    };
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") el.value = "";
    el.ownerDocument = doc;
    return el;
  };
  const syncSiblings = (parent) => {
    parent.firstChild = parent.childNodes[0] ?? null;
    parent.lastChild = parent.childNodes[parent.childNodes.length - 1] ?? null;
    for (let i = 0; i < parent.childNodes.length; i++) {
      parent.childNodes[i].previousSibling = parent.childNodes[i - 1] ?? null;
      parent.childNodes[i].nextSibling = parent.childNodes[i + 1] ?? null;
    }
  };
  const doc = {
    ...eventTarget(),
    nodeType: 9,
    documentElement: null,
    head: null,
    HTMLIFrameElement: class {},
    querySelector() { return null; },
    createElement,
    createElementNS: (_ns, tag) => createElement(tag),
    createTextNode: (data) => ({
      nodeType: 3, data: String(data), nodeValue: String(data),
      ownerDocument: doc, parentNode: null, previousSibling: null, nextSibling: null,
    }),
    createComment: (data) => ({
      nodeType: 8, data: String(data),
      ownerDocument: doc, parentNode: null, previousSibling: null, nextSibling: null,
    }),
    defaultView: null,
  };
  doc.documentElement = createElement("html");
  doc.head = createElement("head");
  doc.defaultView = {
    document: doc,
    HTMLElement: Object,
    Node: Object,
    HTMLIFrameElement: doc.HTMLIFrameElement,
    navigator: { userAgent: "node" },
  };
  return doc;
}

function findElements(node, predicate, out = []) {
  if (node?.nodeType === 1 && predicate(node)) out.push(node);
  for (const child of node?.childNodes ?? []) findElements(child, predicate, out);
  return out;
}

async function mountCompiledSettingsPage(scope) {
  const prev = {
    act: globalThis.IS_REACT_ACT_ENVIRONMENT,
    document: globalThis.document,
    window: globalThis.window,
  };
  const doc = createNodeDom();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.document = doc;
  globalThis.window = doc.defaultView;

  let declaration;
  vm.runInNewContext(await readFile(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load(value) { declaration = value; } } },
    document: doc,
  });
  const client = declaration.factory((name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`Unexpected import: ${name}`);
  });
  let Page;
  const ctx = {
    inject(services, callback) { if (services[0] === "configForms") callback(ctx); },
    effect(fn) { return fn(); },
    locale: { register: () => () => {} },
    configForms: { get: () => scope },
    slots: {
      spec: () => ({ kind: "keyed" }),
      inject: (_name, cb) => cb(),
      register(opts, Component) {
        if (opts.name === "plugins.bundle.config") Page = Component;
        return () => {};
      },
    },
  };
  client.apply(ctx);
  const container = doc.createElement("div");
  doc.documentElement.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Page, { scope, t: (key) => key, view: "page" }));
  });
  const fire = async (type, target) => {
    const event = {
      type, target, currentTarget: target, bubbles: true, cancelable: true,
      defaultPrevented: false, stopPropagation() {}, preventDefault() {},
    };
    await React.act(async () => {
      for (const fn of container.listeners.get(type) ?? []) fn(event);
      await Promise.resolve();
    });
  };
  const changeInput = async (target, value) => {
    await fire("focusin", target);
    target.value = value;
    await fire("input", target);
    await fire("keyup", target);
    await fire("focusout", target);
  };
  return {
    container,
    fire,
    changeInput,
    async dispose() {
      await React.act(async () => { root.unmount(); });
      if (prev.act === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
      else globalThis.IS_REACT_ACT_ENVIRONMENT = prev.act;
      if (prev.document === undefined) delete globalThis.document;
      else globalThis.document = prev.document;
      if (prev.window === undefined) delete globalThis.window;
      else globalThis.window = prev.window;
    },
  };
}

test("failed save state clears when external convergence restores clean state, and clearing 0 preserves empty invalid input", async () => {
  const listeners = new Set();
  let snapshot = {
    status: "ready", writable: true, revision: 1,
    value: { ...DEFAULTS, maxBytes: 4096 }, base: {}, user: {},
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async mutate() {
      snapshot = {
        status: "ready", writable: true, revision: 2,
        value: { ...DEFAULTS, maxBytes: 1024 }, base: {}, user: { maxBytes: 1024 },
      };
      for (const fn of listeners) fn();
      return false;
    },
  };

  const mounted = await mountCompiledSettingsPage(scope);
  try {
    const maxBytesInput = () => findElements(
      mounted.container,
      (el) => el.tagName === "INPUT" && (el.attributes.id ?? "").endsWith("dsh-trellis-max-bytes"),
    )[0];
    const saveButton = () => findElements(
      mounted.container,
      (el) => el.tagName === "BUTTON" && el.textContent === "save",
    )[0];
    const errorStatus = () => findElements(
      mounted.container,
      (el) => el.attributes.class === "dsh-trellis-error",
    )[0];

    await mounted.changeInput(maxBytesInput(), "512");
    assert.equal("disabled" in saveButton().attributes, false);

    await mounted.fire("click", saveButton());
    assert.ok(errorStatus(), "failed banner should appear after conflict");
    assert.equal(saveButton().attributes["aria-describedby"], errorStatus().attributes.id);

    // External update converges host to the draft value -> !dirty clears stale failed state
    snapshot = {
      status: "ready", writable: true, revision: 3,
      value: { ...DEFAULTS, maxBytes: 512 }, base: {}, user: { maxBytes: 512 },
    };
    await React.act(async () => {
      for (const fn of listeners) fn();
    });
    assert.equal(errorStatus(), undefined, "stale failed banner must clear on convergence");

    // Reset host to 0, then clear input to "": must retain "" without snapping back to "0"
    snapshot = {
      status: "ready", writable: true, revision: 4,
      value: { ...DEFAULTS, maxBytes: 0 }, base: {}, user: { maxBytes: 0 },
    };
    await React.act(async () => {
      for (const fn of listeners) fn();
    });
    assert.equal(maxBytesInput().value, "0");

    await mounted.changeInput(maxBytesInput(), "");
    assert.equal(maxBytesInput().value, "");
    assert.equal(maxBytesInput().attributes["aria-invalid"], "true");
    assert.equal("disabled" in saveButton().attributes, true);
  } finally {
    await mounted.dispose();
  }
});
