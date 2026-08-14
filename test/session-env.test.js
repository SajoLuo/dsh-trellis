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
