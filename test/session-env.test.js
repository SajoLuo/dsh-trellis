import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dshContextKey,
  registerSessionEnv,
  SESSION_ENV_CONTRIBUTOR,
} from "../lib/session-env.js";

test("dshContextKey matches Trellis sanitization", () => {
  assert.equal(dshContextKey("session one/two"), "dsh_session_one_two");
  assert.equal(dshContextKey(""), "");
  assert.equal(dshContextKey("   "), "");
  assert.equal(dshContextKey(null), "");
  assert.equal(dshContextKey(123), "");

  const expectedHash = createHash("sha256").update("...").digest("hex").slice(0, 24);
  assert.equal(dshContextKey("..."), `dsh_${expectedHash}`);
  assert.equal(dshContextKey("  ...  "), `dsh_${expectedHash}`);

  const cjkHash = createHash("sha256").update("中文会话").digest("hex").slice(0, 24);
  assert.equal(dshContextKey("中文会话"), `dsh_${cjkHash}`);

  const longId = "a".repeat(200);
  const longKey = dshContextKey(longId);
  assert.equal(longKey.length, 160);
  assert.match(longKey, /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/);

  const boundaryId = `${"a".repeat(156)}_bbb`;
  assert.equal(dshContextKey(boundaryId), `dsh_${"a".repeat(156)}`);
});

test("managed shell identity is derived from the current execution, not ambient context", () => {
  let contributor;
  let disposed = false;
  const ctx = {
    shellEnv: {
      register(value) {
        contributor = value;
        return () => {
          disposed = true;
        };
      },
    },
  };

  const dispose = registerSessionEnv(ctx);
  assert.equal(contributor.name, SESSION_ENV_CONTRIBUTOR);
  assert.deepEqual(Object.keys(contributor.variables), [
    "DSH_TRELLIS_CONTEXT_ID",
  ]);
  assert.deepEqual(
    contributor.resolve({
      agent: { session: { header: { id: "inner dsh" } } },
    }),
    { DSH_TRELLIS_CONTEXT_ID: "dsh_inner_dsh" },
  );
  assert.deepEqual(contributor.resolve({}), {});

  dispose();
  assert.equal(disposed, true);
});
