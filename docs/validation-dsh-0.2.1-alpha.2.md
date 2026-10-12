# DSH 0.2.1-alpha.2 compatibility validation

Validated locally on Windows / Node 24.12.0 / pnpm 10.33.0 on 2026-10-12,
using the working tree based on dsh-trellis 0.1.11, subsequently prepared as
0.1.12 at the user's release request. This records local checks, not a remote
CI or publication result; those statuses belong to the corresponding release
tag. No global DSH upgrade was performed.

## Upstream contracts and adaptation

The official [alpha.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2)
points to `d743267388641bc76f17c45ce8b4c231aed1d32c`.

- The [working-directory service](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/session/working-directory/src/index.ts)
  owns the current directory and validates or recovers it through `ensure()`. The
  plugin now resolves the agent-scoped service on each breadcrumb or command
  invocation. Header/process cwd is only the fallback when the service is absent;
  service failure never triggers an operation in the old project. Session identity
  stays stable, and the plugin does not copy task pointers between directories.
- The [native subagent tool](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/subagent/tool-subagent/src/index.ts)
  returns a child ID immediately and no longer accepts `run_in_background`.
  README guidance selects synchronization by actual tool capability, preserving
  legacy foreground dispatch only where its schema supports that parameter.
- The [subagent manager](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/packages/subagent/subagent/src/manager.ts)
  handles notification delivery separately and skips it for `delivery: 'caller'`.
  A matching end event proves execution settlement, not notice delivery.
  `trellis_wait` retains the boolean `settlementNoticeQueued` for compatibility,
  but returns false because delivery is unverified, not because non-delivery is
  proven. Inactive snapshots remain unknown. Dependent gates still require the
  actual child report/transcript and a successful settled outcome.

Explicit alpha peer ranges were added for DSH, Cordis and Schemastery. This does
not claim that the previous DSH admission rules necessarily rejected alpha.2:
DSH's prerelease-aware admission and ordinary npm semver resolution differ.
Runtime tests, not the range alone, are the evidence of compatibility.

The isolated alpha fixture uses DSH 0.2.1-alpha.2, Cordis 4.0.5-alpha.1,
Schemastery 3.18.5-alpha.1, Loader 1.0.6-alpha.1 and Include 1.0.10-alpha.1.
The development checkout retains its frozen RC.1 baseline. The unused direct
`dsh-invariants` development dependency was removed; legitimate older-host
transitive dependencies remain in the lockfile.

## Automated results

| Host | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| 0.1.5-rc.2 | 129 | 0 | 11 |
| 0.1.6-alpha.2 | 129 | 0 | 11 |
| 0.1.7-rc.1 | 131 | 0 | 9 |
| 0.1.7-rc.2 | 134 | 0 | 6 |
| Frozen 0.2.0-rc.1 checkout | 136 | 0 | 4 |
| 0.2.0-rc.2 | 136 | 0 | 4 |
| 0.2.1-alpha.2 | 140 | 0 | 0 |

Skips are explicit capability gates, including three alpha activation tests and
one alpha working-directory test on older hosts. They are not evidence that an
unavailable API was exercised. The four alpha-specific tests were also rerun
as a focused suite and passed.

The new tests exercise:

- Real AgentLoop, SubagentRuntime, SessionQuery and activation lifecycle for
  completed, aborted and failed children. With caller delivery, a real end event
  settles the wait while the parent notification inbox stays empty. Only model
  responses are locally scripted; tests do not manually emit the settlement event.
- Real LocalFileSystem, WorkingDirectory, Session and projections for A-to-B-to-A
  directory changes, session replay and fork, and recovery to the original directory
  when the current temporary directory is removed. Breadcrumbs and command routing
  follow the current directory while the native session ID stays unchanged.
- Late service attachment/removal, agent-scoped ownership, invalid service results,
  service errors and cancellation. Commands launch no subprocess after resolution
  failure. Their subprocess boundary is intercepted to verify cwd and identity.
- Existing dynamic-tool, Settings/Loader, history recovery, projection, wait-catalog
  and lifecycle regressions. Ordinary user-message assertions distinguish user
  source messages from the host's new runtime-context message.

Additional checks passed: frozen offline installation, client build,
`npm pack --dry-run --ignore-scripts --json` (17 entries, including the new
`lib/working-directory.js`) and `git diff --check`.

Reproduction:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm run test:compat 0.1.5-rc.2 0.1.6-alpha.2 0.1.7-rc.1 0.1.7-rc.2 0.2.0-rc.2 0.2.1-alpha.2
pnpm run build:client
npm pack --dry-run --ignore-scripts --json
git diff --check
```

## Limits and remaining work

This pass did not run a browser/Web-profile acceptance test, the actual Git
worktree tool, an external model provider or an SSH remote workspace. Directory
tests use real local temporary directories, not a claim of Git worktree end-to-end
coverage. Personal profiles, credentials and global DSH installations were untouched.
Windows/Linux CI configuration includes alpha.2. At the initial local-validation
stage it had not been dispatched remotely; see the release's CI run for that gate.

The plugin pass itself did not modify Trellis product templates or Python scripts.
After separate plan approval on 2026-10-12, the sibling upstream-trellis task
`10-12-dsh-alpha2-sync` synchronized the DSH guide, shared workflow, dogfood mirror
and marketplace native mirror. Its 16 DSH tests, lint, typecheck, build, pack
dry-run and fresh built-CLI init/update smoke passed. Broader template/regression
checks retain explicitly classified pre-existing Windows/fixture failures; a
whole-repository green gate is not claimed. Details are recorded in that task's
`verification.md`. Existing nested-host identity WIP remains preserved, and the
Trellis task is not committed or archived. These are local template changes, not
a published Trellis update. npm plugin installation still does not automatically
rewrite existing project workflows.
