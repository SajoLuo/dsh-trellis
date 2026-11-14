import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULTS } from "../src/client/form.js";

function createDomEnv() {
  const styles = new Set();
  return {
    styles,
    document: {
      querySelector() { return styles.values().next().value ?? null; },
      createElement() { const tag = { dataset: {}, remove() { styles.delete(tag); } }; return tag; },
      head: { appendChild(tag) { styles.add(tag); } },
    },
  };
}

async function clientHarness(initialSlots = {}, options = {}) {
  const modern = typeof options === "boolean" ? options : Boolean(options.modern);
  const dom = (typeof options === "object" && options?.dom) || createDomEnv();
  const available = typeof options === "object" && Array.isArray(options.services)
    ? options.services
    : [modern ? "configForms" : "settingsScope"];
  const definitions = new Map(Object.entries(initialSlots));
  const registrations = new Map();
  const dependencies = new Map();
  const effects = [];
  const locales = new Set();
  const snapshot = { status: "ready", writable: true, value: DEFAULTS, base: {}, user: {} };
  const modernScope = { kind: "configForms", getSnapshot: () => snapshot, subscribe: () => () => {} };
  const legacyScope = { kind: "settingsScope", getSnapshot: () => snapshot, subscribe: () => () => {} };
  let declaration;
  vm.runInNewContext(await readFile(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load(value) { declaration = value; } } },
    document: dom.document,
  });
  const client = declaration.factory((name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`Unexpected bundled client import: ${name}`);
  });
  const pendingInjections = new Map();
  const ctx = {
    inject(services, callback) {
      pendingInjections.set(services[0], callback);
    },
    effect(callback) { const result = callback(); effects.push(result); return result; },
    locale: { register(ns) { locales.add(ns); return () => locales.delete(ns); } },
    settingsScope: { bind({ namespace }) { assert.equal(namespace, "dsh-trellis"); return legacyScope; } },
    configForms: { get(namespace) { assert.equal(namespace, "dsh-trellis"); return modernScope; } },
    slots: {
      spec(name) { return definitions.get(name); },
      inject(name, callback) {
        const record = { callback, dispose: definitions.has(name) ? callback() : undefined };
        const records = dependencies.get(name) ?? [];
        records.push(record);
        dependencies.set(name, records);
        effects.push(() => { record.dispose?.(); });
      },
      register(opts, Component) {
        const id = `${opts.name}:${opts.key ?? opts.id}`;
        assert.equal(registrations.has(id), false, "duplicate slot registration");
        registrations.set(id, { options: opts, Component });
        return () => registrations.delete(id);
      },
    },
  };
  client.apply(ctx);
  for (const service of available) {
    pendingInjections.get(service)?.(ctx);
  }
  return {
    registrations, styles: dom.styles, locales, modernScope, legacyScope,
    mount(name, spec) {
      definitions.set(name, spec);
      for (const record of dependencies.get(name) ?? []) {
        record.dispose ??= record.callback();
      }
    },
    unmount(name) {
      definitions.delete(name);
      for (const record of dependencies.get(name) ?? []) {
        record.dispose?.();
        record.dispose = undefined;
      }
    },
    dispose() {
      dependencies.clear();
      for (const dispose of effects.splice(0).reverse()) dispose?.();
    },
    render(name, view) {
      const entry = [...registrations.values()].find(({ options }) => options.name === name);
      assert.ok(entry);
      return renderToStaticMarkup(React.createElement(entry.Component, {
        ...entry.options.inject(), t: (key) => key, view,
      }));
    },
  };
}

for (const modern of [false, true]) test(`${modern ? "configForms" : "legacy"} bundle page renders an open form and summary`, async () => {
  const h = await clientHarness({ "plugins.bundle.config": { kind: "keyed" } }, modern);
  assert.deepEqual([...h.registrations.keys()], ["plugins.bundle.config:dsh-trellis"]);
  const page = h.render("plugins.bundle.config", "page");
  assert.match(page, /<section class="dsh-trellis-page"/);
  assert.match(page, /dsh-trellis-max-bytes/);
  assert.match(page, />save<\/button>/);
  assert.doesNotMatch(page, /<li|aria-expanded|dsh-trellis-header/);
  assert.equal(h.render("plugins.bundle.config", "summary"), "description");
  h.dispose();
  assert.equal(h.registrations.size, 0);
  assert.equal(h.styles.size, 0);
  assert.equal(h.locales.size, 0);
});

for (const kind of ["keyed", "list"]) {
  test(`legacy ${kind} Settings retains its expandable card`, async () => {
    const h = await clientHarness({ "settings.plugin.item": { kind } });
    const entry = [...h.registrations.values()][0];
    assert.equal(entry.options[kind === "keyed" ? "key" : "id"], "dsh-trellis");
    const card = h.render("settings.plugin.item");
    assert.match(card, /<li class="dsh-trellis-card"/);
    assert.match(card, /aria-expanded="false"/);
    assert.doesNotMatch(card, /dsh-trellis-max-bytes/);
    h.dispose();
  });
}

test("late slot ownership and repeated page-owner reloads do not duplicate registrations", async () => {
  const h = await clientHarness();
  assert.equal(h.registrations.size, 0);
  for (let i = 0; i < 3; i++) {
    h.mount("plugins.bundle.config", { kind: "keyed" });
    h.mount("plugins.bundle.config", { kind: "keyed" });
    assert.equal(h.registrations.size, 1);
    h.unmount("plugins.bundle.config");
    assert.equal(h.registrations.size, 0);
  }
  h.mount("plugins.bundle.config", { kind: "keyed" });
  h.dispose();
  assert.equal(h.registrations.size, 0);
  assert.equal(h.styles.size, 0);
  assert.equal(h.locales.size, 0);
});

test("overlapping plugin mounts ref-count shared style element without removing active CSS", async () => {
  const dom = createDomEnv();
  const first = await clientHarness({}, { modern: true, dom });
  assert.equal(dom.styles.size, 1);
  const styleTag = [...dom.styles][0];
  assert.equal(styleTag.dataset.pluginRefs, "1");

  const second = await clientHarness({}, { modern: true, dom });
  assert.equal(dom.styles.size, 1);
  assert.equal(styleTag.dataset.pluginRefs, "2");

  first.dispose();
  assert.equal(dom.styles.size, 1);
  assert.equal(styleTag.dataset.pluginRefs, "1");

  second.dispose();
  assert.equal(dom.styles.size, 0);

  const third = await clientHarness({}, { modern: true, dom });
  assert.equal(dom.styles.size, 1);
  assert.equal([...dom.styles][0].dataset.pluginRefs, "1");
  third.dispose();
  assert.equal(dom.styles.size, 0);
});

for (const services of [
  ["configForms", "settingsScope"],
  ["settingsScope", "configForms"],
]) {
  test(`hosts providing both ${services.join(" + ")} register once using configForms`, async () => {
    const h = await clientHarness(
      { "settings.plugin.item": { kind: "keyed" }, "plugins.bundle.config": { kind: "keyed" } },
      { services },
    );
    assert.deepEqual(
      [...h.registrations.keys()].sort(),
      ["plugins.bundle.config:dsh-trellis", "settings.plugin.item:dsh-trellis"],
    );
    for (const entry of h.registrations.values()) {
      assert.equal(entry.options.inject().scope, h.modernScope);
    }
    h.dispose();
    assert.equal(h.registrations.size, 0);
  });
}

test("multiple mounted settings instances emit unique useId prefixes and aria-describedby links", async () => {
  const h = await clientHarness({ "plugins.bundle.config": { kind: "keyed" } }, { modern: true });
  const entry = [...h.registrations.values()][0];
  const combined = renderToStaticMarkup(React.createElement(
    React.Fragment,
    null,
    React.createElement(entry.Component, { ...entry.options.inject(), t: (key) => key, view: "page" }),
    React.createElement(entry.Component, { ...entry.options.inject(), t: (key) => key, view: "page" }),
  ));
  const maxBytesIds = [...combined.matchAll(/id="([^"]*dsh-trellis-max-bytes)"/g)].map((m) => m[1]);
  assert.equal(maxBytesIds.length, 2);
  assert.notEqual(maxBytesIds[0], maxBytesIds[1]);
  for (const id of maxBytesIds) {
    assert.match(combined, new RegExp(`for="${id}"`));
    assert.match(combined, new RegExp(`aria-describedby="${id}-hint"`));
    assert.match(combined, new RegExp(`id="${id}-hint"`));
  }
  h.dispose();
});
