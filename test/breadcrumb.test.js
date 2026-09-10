import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "@deepseek-ai/dsh-session";
import {
  breadcrumbMessage,
  hasSkipKeyword,
  isBreadcrumbMessage,
  isBreadcrumbVisible,
  sessionEventAt,
  SOURCE_FORM,
  SOURCE_KIND,
} from "../lib/breadcrumb.js";

test("visibility accepts the installed DSH Session V3 implementation", () => {
  const session = Session.create("session-v3-api");
  session.append(
    "user/message",
    breadcrumbMessage(
      { status: "no_task", taskPath: null, body: "No task.", digest: "live" },
      4096,
    ),
    { surfaceOp: "append" },
  );
  assert.equal(isBreadcrumbVisible({ session }, "live"), true);
  assert.equal(sessionEventAt(session, 0)?.seq, 0);
});

test("session event lookup prefers the current DSH API", () => {
  const expected = { seq: 3, type: "user/message" };
  const session = {
    eventAt(seq) {
      assert.equal(seq, 3);
      return expected;
    },
  };
  assert.equal(sessionEventAt(session, 3), expected);
});

test("session event lookup supports legacy collections", () => {
  const expected = { type: "user/message" };
  assert.equal(sessionEventAt({ events: [undefined, expected] }, 1), expected);
  assert.equal(sessionEventAt({ events: new Map([[1, expected]]) }, 1), expected);
});

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

test("visibility supports the legacy event collection", () => {
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

test("visibility uses the current DSH snapshot API and event sequence", () => {
  let snapshotReads = 0;
  const agent = {
    session: {
      surface: { nodes: [2] },
      snapshotEvents() {
        snapshotReads += 1;
        return Object.freeze([
          Object.freeze({
            seq: 1,
            type: "user/message",
            data: {
              source: { kind: SOURCE_KIND, form: SOURCE_FORM, digest: "same" },
            },
          }),
          Object.freeze({
            seq: 2,
            type: "user/message",
            data: {
              source: { kind: SOURCE_KIND, form: SOURCE_FORM, digest: "same" },
            },
          }),
        ]);
      },
    },
  };

  assert.equal(isBreadcrumbVisible(agent, "same"), true);
  assert.equal(snapshotReads, 1);
});
