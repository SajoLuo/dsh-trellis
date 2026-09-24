import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULTS } from "../src/client/form.js";

async function clientHarness(initialSlots = {}, modern = false) {
  const definitions = new Map(Object.entries(initialSlots));
  const registrations = new Map();
  const dependencies = new Map();
  const effects = [];
  const styles = new Set();
  const locales = new Set();
  const snapshot = { status: "ready", writable: true, value: DEFAULTS, base: {}, user: {} };
  const scope = { getSnapshot: () => snapshot, subscribe: () => () => {} };
  let declaration;
  vm.runInNewContext(await readFile(new URL("../lib/client.js", import.meta.url), "utf8"), {
    window: { __ModuleLoader__: { load(value) { declaration = value; } } },
    document: {
      querySelector() { return styles.values().next().value ?? null; },
      createElement() { const tag = { dataset: {}, remove() { styles.delete(tag); } }; return tag; },
      head: { appendChild(tag) { styles.add(tag); } },
    },
  });
  const client = declaration.factory((name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`Unexpected bundled client import: ${name}`);
  });
  const ctx = {
    inject(services, callback) {
      if (services[0] === (modern ? "configForms" : "settingsScope")) callback(ctx);
    },
    effect(callback) { const dispose = callback(); effects.push(dispose); return dispose; },
    locale: { register(ns) { locales.add(ns); return () => locales.delete(ns); } },
    settingsScope: { bind({ namespace }) { assert.equal(namespace, "dsh-trellis"); return scope; } },
    configForms: { get(namespace) { assert.equal(namespace, "dsh-trellis"); return scope; } },
    slots: {
      spec(name) { return definitions.get(name); },
      inject(name, callback) {
        const record = { callback, dispose: definitions.has(name) ? callback() : undefined };
        dependencies.set(name, record);
        effects.push(() => { record.dispose?.(); dependencies.delete(name); });
      },
      register(options, Component) {
        const id = `${options.name}:${options.key ?? options.id}`;
        assert.equal(registrations.has(id), false, "duplicate slot registration");
        registrations.set(id, { options, Component });
        return () => registrations.delete(id);
      },
    },
  };
  client.apply(ctx);
  return {
    registrations, styles, locales,
    mount(name, spec) {
      definitions.set(name, spec);
      const record = dependencies.get(name);
      record.dispose ??= record.callback();
    },
    unmount(name) {
      definitions.delete(name);
      const record = dependencies.get(name);
      record.dispose?.();
      record.dispose = undefined;
    },
    dispose() { for (const dispose of effects.splice(0).reverse()) dispose?.(); },
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
