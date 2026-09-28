# DSH 0.1.7-rc.2 compatibility validation

Validated on Windows / Node 24.12.0 / pnpm 10.33.0 on 2026-09-28.
Initially validated against plugin 0.1.8, then prepared as 0.1.9 at the user's
release request. This adds regression coverage, CI configuration and documentation,
not a runtime change. Existing peer ranges already admit RC.2.

## Automated results

| DSH host | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| 0.1.7-rc.2 | 125 | 0 | 0 |
| 0.1.7-rc.1 | 122 | 3 | 0 |
| 0.1.6-alpha.2 | 120 | 5 | 0 |
| 0.1.5-rc.2 | 120 | 5 | 0 |

The three RC.2-only tests require `Session.toolHistory`. The older two hosts
also skip the pre-existing native catalog and volatile Loader integration tests.
RC.1 uses the checkout's frozen lockfile; the other hosts use isolated temporary
copies with their published DSH package versions. The compatibility runner pins
Cordis/Schemastery/Loader/Include explicitly and rejects unsupported hosts rather
than assigning every non-RC.1 version the legacy dependency set.

Reproduction:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:client
pnpm test
pnpm run test:compat 0.1.7-rc.2 0.1.5-rc.2 0.1.6-alpha.2
npm pack --dry-run --ignore-scripts
git diff --check
```

Client build, frozen install, package dry-run and diff checks passed. The package
still contains 16 files; new tests, runner helpers and validation documents are
not shipped as runtime files. Windows/Linux CI now includes RC.2 alongside the
RC.1 baseline and two older hosts. Remote CI is a separate release gate; its
result is recorded in the tagged release.

## New coverage

- Five compatibility-manifest tests check exact toolchain versions, the old
  `code-runtime` versus `ptc-runtime` rename, input immutability and rejection of
  unsupported versions. `dsh-agent-loop` is a development-only dependency.
- Three RC.2 integrations run the real AgentLoop, LLM runtime, Session store,
  projection registry, system prompt, tool runtime, agent registry and Loader.
  Only model responses and unrelated command/shell/subagent services are stubbed.
  No provider credentials or network model calls are used.
- Each integration enables/disables/re-enables the plugin and changes volatile
  settings. It verifies logged tool additions/removals, current request headers,
  and route-specific wire declarations/messages for absent, `addition-only` and
  `in-history` tool-update capabilities. Identical breadcrumbs remain deduplicated.
- Replayed and forked mixed user/developer history rebuilds the breadcrumb
  projection. Replacing the breadcrumb surface node permits reinjection; the
  real host starts a new request series with current tools as its baseline.
  Old tool updates remain logged but are not replayed to the model in that series.
  This is a surface-replacement contract test, not an LLM summarizer test.
- Three catalog-failure tests preserve corrupt/missing-session errors, clean up
  listeners, and reject stale waits after unload, including a late lookup failure.
  Existing tests still cover cancellation, direct-child identity and settlement
  races. These are not live LLM-backed subagent delegation tests.

## Official references and boundaries

- [RC.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.2)
- [Dynamic tool registration merge](https://github.com/deepseek-ai/deepseek-harness/commit/f6a2c700af9edc9b7f48699c454e19c5c26a3fd9)
- [RC.2 tool-update integration contracts](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/core/agent-loop/tests/tool-updates.spec.ts)
- [RC.2 model capability definitions](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.2/packages/llm/llm/src/types.ts)

No fresh RC.2 Web browser, remote workspace, real provider or global CLI upgrade
is certified by this pass. The RC.1 Web checks remain in `validation-0.1.8.md`.
Unreleased upstream failed-tool recovery and Windows PTY changes are not part of
the RC.2 package tests. Trellis source/templates, personal profiles and installed
file-plugin snapshots were not changed. This record describes local pre-release
checks; commit, push, publication and remote CI results belong to the tagged release.
