import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve, sep } from "node:path";
import {
  breadcrumbMessage,
  createBreadcrumbComposer,
  hasSkipKeyword,
  isBreadcrumbMessage,
  SOURCE_FORM,
  SOURCE_KIND,
} from "../lib/breadcrumb.js";

test("breadcrumb message carries stable ownership metadata", () => {
  const message = breadcrumbMessage(
    {
      status: "in_progress",
      taskPath: ".trellis/tasks/demo",
      body: "Do the next step.",
      digest: "abc",
    },
    4096,
  );
  assert.equal(isBreadcrumbMessage(message), true);
  assert.deepEqual(message.source, {
    kind: SOURCE_KIND,
    form: SOURCE_FORM,
    status: "in_progress",
    task: ".trellis/tasks/demo",
    digest: "abc",
  });
});

test("skip keyword matches standalone text only", () => {
  const messages = (text) => [{ content: [{ type: "text", text }] }];
  assert.equal(
    hasSkipKeyword(messages("please no-trellis this turn"), "no-trellis"),
    true,
  );
  assert.equal(
    hasSkipKeyword(messages("prefixno-trellissuffix"), "no-trellis"),
    false,
  );
  assert.equal(
    hasSkipKeyword(messages("foo-no-trellis bar no-trellis-baz"), "no-trellis"),
    false,
  );
  assert.equal(
    hasSkipKeyword(messages("/no-trellis and #no-trellis"), "no-trellis"),
    true,
  );
  assert.equal(hasSkipKeyword(messages("please NO-TRELLIS now"), "  no-trellis "), true);
  assert.equal(hasSkipKeyword(messages("hello world"), "   "), false);
  assert.equal(hasSkipKeyword(messages("请 跳过。"), "跳过"), true);
  assert.equal(hasSkipKeyword(messages("请跳过"), "跳过"), false);
  assert.equal(
    hasSkipKeyword(
      [
        { role: "assistant", content: [{ type: "text", text: "no-trellis" }] },
        { role: "tool", content: [{ type: "text", text: "no-trellis" }] },
        { role: "system", content: "no-trellis" },
        { role: "user", content: [{ type: "image", text: "no-trellis" }] },
      ],
      "no-trellis",
    ),
    false,
  );
  assert.equal(
    hasSkipKeyword(
      [{ role: "user", content: [{ type: "text", text: "no-trellis" }] }],
      "no-trellis",
    ),
    true,
  );
});

test("composer suppresses no_task for subagents while keeping active and error tasks, and hashes punctuation session ids", async () => {
  const root = resolve("breadcrumb-subagent-project");
  const files = new Map([
    [join(root, ".trellis", "workflow.md"), [
      "[workflow-state:no_task]\nNo task\n[/workflow-state:no_task]",
      "[workflow-state:planning]\nPlan task\n[/workflow-state:planning]",
      "[workflow-state:task_error]\nFix task\n[/workflow-state:task_error]",
    ].join("\n")],
  ]);
  const fs = {
    async exists(path) {
      if (files.has(path)) return true;
      const prefix = `${path}${sep}`;
      return [...files.keys()].some((entry) => entry.startsWith(prefix));
    },
    async stat(path) { return files.has(path) ? { mtimeMs: 1 } : null; },
    async readFile(path) { return files.get(path) ?? null; },
  };
  const { compose } = createBreadcrumbComposer(
    { maxBytes: 4096, skipKeyword: "no-trellis", projectRootMarkers: [".trellis"] },
    {},
    { fs },
  );
  const signal = new AbortController().signal;

  assert.equal(
    await compose({ session: { header: { id: "sub-1", cwd: root, origin: "subagent" } } }, [], signal),
    undefined,
  );
  assert.ok(
    await compose({ session: { header: { id: "main-1", cwd: root } } }, [], signal),
  );

  const hashId = createHash("sha256").update("...").digest("hex").slice(0, 24);
  files.set(
    join(root, ".trellis", ".runtime", "sessions", `dsh_${hashId}.json`),
    JSON.stringify({ current_task: ".trellis/tasks/active" }),
  );
  files.set(
    join(root, ".trellis", "tasks", "active", "task.json"),
    JSON.stringify({ status: "planning" }),
  );
  const subActive = await compose(
    { session: { header: { id: "...", cwd: root, origin: "subagent" } } },
    [],
    signal,
  );
  assert.equal(subActive.source.status, "planning");

  files.set(join(root, ".trellis", "tasks", "active", "task.json"), "{broken");
  const subError = await compose(
    { session: { header: { id: "...", cwd: root, origin: "subagent" } } },
    [],
    signal,
  );
  assert.equal(subError.source.status, "task_error");
});
