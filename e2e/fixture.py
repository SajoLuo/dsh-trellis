"""Actions performed by real DSH Shell/PTC tools inside the disposable project."""
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path.cwd()
STATE = ROOT / ".trellis/.runtime/e2e-state.json"


def run(*args):
    result = subprocess.run(args, text=True, encoding="utf-8", capture_output=True)
    print(result.stdout, end="")
    print(result.stderr, end="", file=sys.stderr)
    result.check_returncode()
    return result.stdout.strip()


def task(*args):
    return run(sys.executable, ".trellis/scripts/task.py", *args)


def identity():
    session = os.environ["DSH_SESSION_ID"]
    context = os.environ["DSH_TRELLIS_CONTEXT_ID"]
    assert context == "dsh_" + session, (session, context)
    assert context != os.environ.get("CODEX_THREAD_ID")
    return session, context


session, context = identity()
action = sys.argv[1]
if action == "bootstrap":
    task("create", "E2E add function", "--slug", "e2e-add", "--description",
         "Implement add(a, b); research, implement, check, and archive with a journal.",
         "--base-branch", "main", "--no-start")
    directory = next(path for path in (ROOT / ".trellis/tasks").glob("*-e2e-add") if path.is_dir())
    relative = directory.relative_to(ROOT).as_posix()
    (directory / "prd.md").write_text("# Add contract\nImplement add(a,b) as a pure ES module.\n\n## Acceptance\nThe supplied Node tests must pass for positive, negative and fractional inputs.\n", encoding="utf-8")
    (ROOT / ".trellis/spec/add-contract.md").write_text("# Add contract\nExport a pure add(a,b) function. Preserve negative numbers and fractions. Test with node --test. Research writes only research.md; implementation changes src/add.js; review runs the supplied test.\n", encoding="utf-8")
    for role in ("implement", "check"):
        task("add-context", relative, role, ".trellis/spec/add-contract.md", "Implementation and review contract")
    task("validate", relative)
    task("set-branch", relative, "codex/e2e")
    task("start", relative)
    binding = ROOT / ".trellis/.runtime/sessions" / (context + ".json")
    assert binding.is_file(), binding
    assert relative in binding.read_text(encoding="utf-8")
    STATE.write_text(json.dumps({"task": relative, "session": session, "context": context}), encoding="utf-8")
    print("BOOTSTRAP_OK", context)
elif action == "research":
    state = json.loads(STATE.read_text(encoding="utf-8"))
    assert context != state["context"], "child must keep its own native identity"
    (ROOT / state["task"] / "research.md").write_text("Use a pure ES module add(a, b); validate negative and fractional numbers.\n", encoding="utf-8")
    assert not (ROOT / "src/add.js").exists(), "research must not implement"
    print("RESEARCH_OK", context)
elif action == "implement":
    state = json.loads(STATE.read_text(encoding="utf-8"))
    assert (ROOT / state["task"] / "research.md").is_file()
    (ROOT / "src").mkdir(exist_ok=True)
    (ROOT / "src/add.js").write_text("export const add = (a, b) => a + b;\n", encoding="utf-8")
    print("IMPLEMENT_OK", context)
elif action == "check":
    run("node", "--test")
    print("CHECK_OK", context)
elif action == "finish":
    state = json.loads(STATE.read_text(encoding="utf-8"))
    assert state["session"] == session, "finish must use the bound parent"
    run("node", "--test")
    run("git", "add", "src", "test", state["task"], ".trellis/spec/add-contract.md")
    run("git", "commit", "-m", "feat: implement verified e2e add function")
    commit = run("git", "rev-parse", "HEAD")
    task("finish")
    task("archive", state["task"], "--no-commit")
    run(sys.executable, ".trellis/scripts/add_session.py", "--title", "DSH E2E verified",
        "--commit", commit, "--summary", "research / implement / check and event-driven wait passed", "--no-commit")
    assert any("DSH E2E verified" in path.read_text(encoding="utf-8") for path in (ROOT / ".trellis/workspace/e2e").glob("journal-*.md"))
    assert not (ROOT / state["task"]).exists()
    binding = ROOT / ".trellis/.runtime/sessions" / (context + ".json")
    if binding.exists():
        assert not json.loads(binding.read_text(encoding="utf-8")).get("current_task")
    run("git", "add", ".trellis")
    run("git", "commit", "-m", "chore: archive verified task and record journal")
    assert not run("git", "status", "--porcelain"), "fixture must finish with a clean worktree"
    print("FINISH_OK", context)
else:
    raise ValueError(action)
