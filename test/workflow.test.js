import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve, sep } from "node:path";
import {
  parseWorkflowStateBlocks,
  resolveTrellisState,
  sanitizeContextKey,
  mapStatus,
  FALLBACK_BREADCRUMB,
} from "../lib/workflow.js";
import { truncateUtf8 } from "../lib/breadcrumb.js";

/** In-memory filesystem shim for workflow.js, keyed by absolute path. */
function memoryFs(initial = {}) {
  const files = new Map();
  for (const [key, value] of Object.entries(initial)) files.set(key, value);
  const mtimes = new Map();
  let tick = 1;
  const info = (path) => {
    if (!files.has(path)) return null;
    if (!mtimes.has(path)) mtimes.set(path, tick++);
    return { mtimeMs: mtimes.get(path) };
  };
  return {
    files,
    async exists(path) {
      if (files.has(path)) return true;
      const prefix = `${path}${sep}`;
      return [...files.keys()].some((p) => p.startsWith(prefix));
    },
    async stat(path) {
      return info(path);
    },
    async readFile(path) {
      return files.has(path) ? files.get(path) : null;
    },
    async listDir(path) {
      const prefix = `${path}${sep}`;
      const names = new Set();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          names.add(key.slice(prefix.length).split(sep)[0]);
        }
      }
      return [...names];
    },
  };
}

const projectRoot = resolve("fixture-project");
const proj = (rel) => join(projectRoot, rel);

const WORKFLOW_MD = `# Workflow
[workflow-state:no_task]
No active task. Ask for task-creation consent.
[/workflow-state:no_task]
[workflow-state:task_error]
Repair the active task record. Do not create or activate another task.
[/workflow-state:task_error]
[workflow-state:planning]
Load trellis-brainstorm; stay in planning.
[/workflow-state:planning]
[workflow-state:in_progress]
Flow: implement -> check -> update-spec -> commit.
[/workflow-state:in_progress]
`;

test("parseWorkflowStateBlocks extracts every status body", () => {
  const blocks = parseWorkflowStateBlocks(WORKFLOW_MD);
  assert.equal(blocks.size, 4);
  assert.equal(
    blocks.get("no_task"),
    "No active task. Ask for task-creation consent.",
  );
  assert.equal(
    blocks.get("planning"),
    "Load trellis-brainstorm; stay in planning.",
  );
  assert.match(blocks.get("in_progress"), /implement -> check/);
});

test("parseWorkflowStateBlocks ignores unrelated bracketed text", () => {
  const blocks = parseWorkflowStateBlocks(
    "[Claude Code, Cursor]\nstuff\n[/Claude Code]\n[workflow-state:no_task]\nbody\n[/workflow-state:no_task]",
  );
  assert.deepEqual([...blocks.keys()], ["no_task"]);
});

test("sanitizeContextKey matches Trellis task.py sanitization", () => {
  assert.equal(
    sanitizeContextKey("019e456c-ea72-7b60-a8a6"),
    "019e456c-ea72-7b60-a8a6",
  );
  assert.equal(sanitizeContextKey("a b!c"), "a_b_c");
  assert.equal(sanitizeContextKey("..__x.."), "x");
});

test("mapStatus preserves task errors and known workflow states", () => {
  assert.equal(mapStatus("planning"), "planning");
  assert.equal(mapStatus("in_progress"), "in_progress");
  assert.equal(mapStatus("task_error"), "task_error");
  assert.equal(mapStatus("completed"), "no_task");
  assert.equal(mapStatus(null), "no_task");
});

test("resolveTrellisState: no trellis project → null", async () => {
  const fs = memoryFs();
  const state = await resolveTrellisState({
    cwd: proj("sub"),
    markers: [".git"],
    contextKey: "dsh_x",
    fs,
    cache: new Map(),
  });
  assert.equal(state, null);
});

test("resolveTrellisState: no active task → no_task breadcrumb", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(join(".trellis", "workflow.md"))]: WORKFLOW_MD,
  });
  const state = await resolveTrellisState({
    cwd: proj("sub"),
    markers: [".git"],
    contextKey: "dsh_x",
    fs,
    cache: new Map(),
  });
  assert.ok(state);
  assert.equal(state.status, "no_task");
  assert.equal(state.taskPath, null);
  assert.equal(state.body, "No active task. Ask for task-creation consent.");
});

test("resolveTrellisState: exact session pointer → in_progress breadcrumb", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(join(".trellis", "workflow.md"))]: WORKFLOW_MD,
    [proj(join(".trellis", "tasks", "04-17-foo", "task.json"))]: JSON.stringify(
      { status: "in_progress" },
    ),
    [proj(join(".trellis", ".runtime", "sessions", "dsh_x.json"))]:
      JSON.stringify({
        current_task: ".trellis/tasks/04-17-foo",
      }),
  });
  const state = await resolveTrellisState({
    cwd: proj(""),
    markers: [".git"],
    contextKey: "dsh_x",
    fs,
    cache: new Map(),
  });
  assert.equal(state.status, "in_progress");
  assert.equal(state.taskPath, ".trellis/tasks/04-17-foo");
});

test("resolveTrellisState: session-scoped pointer wins over another session", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(join(".trellis", "workflow.md"))]: WORKFLOW_MD,
    [proj(join(".trellis", "tasks", "04-17-a", "task.json"))]: JSON.stringify({
      status: "in_progress",
    }),
    [proj(join(".trellis", "tasks", "04-17-b", "task.json"))]: JSON.stringify({
      status: "planning",
    }),
    [proj(join(".trellis", ".runtime", "sessions", "dsh_me.json"))]:
      JSON.stringify({
        platform: "dsh",
        current_task: ".trellis/tasks/04-17-b",
        last_seen_at: "2026-08-14T00:00:00Z",
      }),
    [proj(join(".trellis", ".runtime", "sessions", "dsh_other.json"))]:
      JSON.stringify({
        current_task: ".trellis/tasks/04-17-a",
      }),
  });
  const state = await resolveTrellisState({
    cwd: proj(""),
    markers: [".git"],
    contextKey: "dsh_me",
    fs,
    cache: new Map(),
  });
  assert.equal(state.status, "planning");
  assert.equal(state.taskPath, ".trellis/tasks/04-17-b");
});

test("resolveTrellisState: sole foreign-session pointer is not read or borrowed", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(join(".trellis", "workflow.md"))]: WORKFLOW_MD,
    [proj(join(".trellis", "tasks", "04-17-a", "task.json"))]: JSON.stringify({
      status: "in_progress",
    }),
    [proj(join(".trellis", ".runtime", "sessions", "codex_zzz.json"))]:
      JSON.stringify({
        platform: "codex",
        current_task: ".trellis/tasks/04-17-a",
        last_seen_at: "2026-08-14T00:00:00Z",
      }),
  });
  const before = [...fs.files];
  const originalRead = fs.readFile;
  const reads = [];
  fs.readFile = async (path) => {
    reads.push(path);
    return originalRead(path);
  };
  const state = await resolveTrellisState({
    cwd: proj(""),
    markers: [".git"],
    contextKey: "dsh_me",
    fs,
    cache: new Map(),
  });
  assert.equal(state.status, "no_task");
  assert.equal(state.taskPath, null);
  assert.ok(!reads.some((path) => path.endsWith("codex_zzz.json")));
  assert.deepEqual([...fs.files], before);
});

test("resolveTrellisState: multiple foreign session pointers refuse to guess", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(join(".trellis", "workflow.md"))]: WORKFLOW_MD,
    [proj(join(".trellis", "tasks", "04-17-a", "task.json"))]: JSON.stringify({
      status: "in_progress",
    }),
    [proj(join(".trellis", "tasks", "04-17-b", "task.json"))]: JSON.stringify({
      status: "planning",
    }),
    [proj(join(".trellis", ".runtime", "sessions", "dsh_a.json"))]:
      JSON.stringify({
        current_task: ".trellis/tasks/04-17-a",
      }),
    [proj(join(".trellis", ".runtime", "sessions", "dsh_b.json"))]:
      JSON.stringify({
        current_task: ".trellis/tasks/04-17-b",
      }),
  });
  const state = await resolveTrellisState({
    cwd: proj(""),
    markers: [".git"],
    contextKey: "dsh_unknown",
    fs,
    cache: new Map(),
  });
  assert.equal(state.status, "no_task");
  assert.equal(state.taskPath, null);
});

test("resolveTrellisState: zero workflow-state blocks → silent", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(join(".trellis", "workflow.md"))]: "# no blocks",
  });
  const state = await resolveTrellisState({
    cwd: proj(""),
    markers: [".git"],
    contextKey: "dsh_x",
    fs,
    cache: new Map(),
  });
  assert.equal(state, null);
});

test("resolveTrellisState: in_progress with no matching block uses fallback text", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(join(".trellis", "workflow.md"))]:
      "[workflow-state:no_task]\nbody\n[/workflow-state:no_task]",
    [proj(join(".trellis", "tasks", "t", "task.json"))]: JSON.stringify({
      status: "in_progress",
    }),
    [proj(join(".trellis", ".runtime", "sessions", "dsh_x.json"))]:
      JSON.stringify({
        current_task: ".trellis/tasks/t",
      }),
  });
  const state = await resolveTrellisState({
    cwd: proj(""),
    markers: [".git"],
    contextKey: "dsh_x",
    fs,
    cache: new Map(),
  });
  assert.equal(state.status, "in_progress");
  assert.equal(state.body, FALLBACK_BREADCRUMB);
});

test("truncateUtf8 respects byte budget without splitting code points", () => {
  const text = "中文字符串" + "a".repeat(100);
  const cut = truncateUtf8(text, 13);
  assert.ok(Buffer.byteLength(cut, "utf8") <= 13);
  assert.ok(!cut.endsWith("\ufffd"));
  assert.equal(truncateUtf8("short", 100), "short");
});

for (const [name, record] of [
  ["malformed JSON", "{broken"],
  ["null", "null"],
  ["array", "[]"],
  ["scalar", '"planning"'],
  ["missing status", "{}"],
  ["empty status", '{"status":""}'],
  ["blank status", '{"status":"  "}'],
  ["non-string status", '{"status":false}'],
  ["missing file", null],
  ["unreadable file", new Error("EACCES")],
]) {
  test(`resolveTrellisState: ${name} preserves the bound task as task_error`, async () => {
    const taskPath = ".trellis/tasks/broken";
    const taskJson = proj(join(taskPath, "task.json"));
    const fs = memoryFs({
      [proj(".git")]: "",
      [proj(".trellis/workflow.md")]: WORKFLOW_MD,
      [proj(".trellis/.runtime/sessions/dsh_me.json")]: JSON.stringify({ current_task: taskPath }),
      ...(typeof record === "string" ? { [taskJson]: record } : {}),
    });
    if (record instanceof Error) {
      const originalRead = fs.readFile;
      fs.readFile = async (path) => {
        if (path === taskJson) throw record;
        return originalRead(path);
      };
    }
    const before = [...fs.files];
    const state = await resolveTrellisState({ cwd: projectRoot, markers: [".git"], contextKey: "dsh_me", fs, cache: new Map() });
    assert.equal(state.status, "task_error");
    assert.equal(state.taskPath, taskPath);
    assert.match(state.body, /Do not create or activate another task/);
    assert.deepEqual([...fs.files], before);
  });
}

for (const errorBlock of [
  "",
  "\n[workflow-state:task_error]\n  \n[/workflow-state:task_error]",
]) {
  test(`resolveTrellisState: ${errorBlock ? "empty" : "missing"} task-error block uses a safe fallback`, async () => {
    const fs = memoryFs({
      [proj(".git")]: "",
      [proj(".trellis/workflow.md")]:
        "[workflow-state:no_task]\nCreate a task.\n[/workflow-state:no_task]" + errorBlock,
      [proj(".trellis/.runtime/sessions/dsh_me.json")]: '{"current_task":".trellis/tasks/broken"}',
      [proj(".trellis/tasks/broken/task.json")]: "{broken",
    });
    const state = await resolveTrellisState({
      cwd: projectRoot, markers: [".git"], contextKey: "dsh_me", fs, cache: new Map(),
    });
    assert.equal(state.status, "task_error");
    assert.equal(state.taskPath, ".trellis/tasks/broken");
    assert.match(state.body, /Do not create or activate another task/);
    assert.match(state.body, /task\.json/);
  });
}

test("resolveTrellisState: empty identity cannot resolve a generic session pointer", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(".trellis/workflow.md")]: WORKFLOW_MD,
    [proj(".trellis/.runtime/sessions/.json")]: '{"current_task":".trellis/tasks/foreign"}',
    [proj(".trellis/tasks/foreign/task.json")]: '{"status":"planning"}',
  });
  const state = await resolveTrellisState({ cwd: projectRoot, markers: [".git"], contextKey: "", fs, cache: new Map() });
  assert.equal(state.status, "no_task");
  assert.equal(state.taskPath, null);
});

for (const record of [
  "{broken", "null", "[]", "{}", '{"current_task":""}', '{"current_task":"  "}',
]) {
  test(`resolveTrellisState: invalid own pointer ${record} does not borrow a foreign session`, async () => {
    const fs = memoryFs({
      [proj(".git")]: "",
      [proj(".trellis/workflow.md")]: WORKFLOW_MD,
      [proj(".trellis/.runtime/sessions/dsh_me.json")]: record,
      [proj(".trellis/.runtime/sessions/dsh_other.json")]: '{"current_task":".trellis/tasks/foreign"}',
      [proj(".trellis/tasks/foreign/task.json")]: '{"status":"planning"}',
    });
    const before = [...fs.files];
    const state = await resolveTrellisState({ cwd: projectRoot, markers: [".git"], contextKey: "dsh_me", fs, cache: new Map() });
    assert.equal(state.status, "no_task");
    assert.equal(state.taskPath, null);
    assert.deepEqual([...fs.files], before);
  });
}

test("resolveTrellisState: exact binding does not require listing session files", async () => {
  const fs = memoryFs({
    [proj(".git")]: "",
    [proj(".trellis/workflow.md")]: WORKFLOW_MD,
    [proj(".trellis/.runtime/sessions/dsh_me.json")]: '{"current_task":".trellis/tasks/own"}',
    [proj(".trellis/tasks/own/task.json")]: '{"status":"planning"}',
  });
  delete fs.listDir;
  const state = await resolveTrellisState({ cwd: projectRoot, markers: [".git"], contextKey: "dsh_me", fs, cache: new Map() });
  assert.equal(state.status, "planning");
  assert.equal(state.taskPath, ".trellis/tasks/own");
});
