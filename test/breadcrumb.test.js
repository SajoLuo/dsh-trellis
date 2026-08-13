import { test } from "node:test";
import assert from "node:assert/strict";
import {
  breadcrumbMessage,
  hasSkipKeyword,
  isBreadcrumbMessage,
  isBreadcrumbVisible,
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
});

test("visibility only counts matching breadcrumb events on the visible surface", () => {
  const agent = {
    session: {
      surface: { nodes: [2] },
      events: new Map([
        [
          1,
          {
            type: "user/message",
            data: {
              source: { kind: SOURCE_KIND, form: SOURCE_FORM, digest: "same" },
            },
          },
        ],
        [
          2,
          {
            type: "user/message",
            data: {
              source: { kind: SOURCE_KIND, form: SOURCE_FORM, digest: "same" },
            },
          },
        ],
      ]),
    },
  };
  assert.equal(isBreadcrumbVisible(agent, "same"), true);
  assert.equal(isBreadcrumbVisible(agent, "other"), false);
});
