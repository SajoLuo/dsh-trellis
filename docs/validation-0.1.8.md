# 0.1.8 compatibility validation

Validated on Windows / Node 24 on 2026-09-24. No commit, push, or npm release
is implied by this record.

## Automated checks

| DSH host | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| 0.1.7-rc.1 | 114 | 0 | 0 |
| 0.1.6-alpha.2 | 112 | 2 | 0 |
| 0.1.5-rc.2 | 112 | 2 | 0 |

The two skips are explicitly gated new-host integration tests. They exercise
real Loader volatile updates and real subagent catalog/projection/query/Session
services on RC.1. Other tests cover old Settings contracts, pre-step decision
metadata, committed-event projections, replay/fork/compaction, exact session
identity, wait cancellation and lookup/settlement races, and atomic form writes.
The native catalog test supplies a synthetic settlement event; it is not a live
LLM-backed delegation test.

Client build, `git diff --check`, and package dry-run passed. The package contains
16 entries, including the host modules, generated client, manifest, bundle patch,
README and license. These are the initial local results; the Windows/Linux CI
matrix is a separate release gate, recorded on the release commit's Actions run.

## Isolated Web verification

Started a separately installed RC.1 host with its own `DSH_HOME`, local file
plugin installation, and no personal credentials or sessions. Browser checks:

- Plugin detail renders all six fields without an error overlay or browser errors.
- Legacy settings are renamed to `.imported` and all six values appear in the
  active profile patch and form.
- Staged multi-field save lands in one accepted mutation; readback matches disk.
- Reset removes the override and displays the inherited default.
- Disabling workflow functionality leaves its configuration form available.
- Component unload removes the form; enabling restores it without duplicates.
- An external profile edit during a draft causes a revision conflict. The draft
  remains, disk is not overwritten, and discarding loads the new accepted value.

The verification browser and server were stopped afterward. Local DSH was then
upgraded to RC.1 and the web/headless file-install snapshots refreshed to 0.1.8;
host source hashes match the checkout, with profile patches preserved. Personal
settings migration was not triggered; settings and profile files were backed up
before upgrading.

## Upstream diagnostic limitation

`dsh --profile web --dump-config-schema` fails on RC.1's four built-in
`@deepseek-ai/dsh-agent-preset` entries: `preset-standard`, `preset-ptc`,
`preset-minimal`, and `preset-cordis` (unrecognized Loader tree carrier).
The same failure reproduces in a fresh stock home **without dsh-trellis**.
Headless schema export succeeds and includes the Trellis schema. Actual Web
startup and the interactions above succeed. No host source workaround was made.

Remote SSH workspaces and live provider-backed agent runs are not certified by
this validation. Existing Trellis source/template changes were not modified.
