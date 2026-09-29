# DSH 0.2.0-rc.1 compatibility validation

Validated on Windows / Node 24.12.0 / pnpm 10.33.0 on 2026-09-29.
Initially validated as a working-tree adaptation on top of plugin 0.1.9, then
prepared as 0.1.10 at the user's release request. The npm 0.1.9 artifact does not
contain the new 0.2 peer ranges.

## Compatibility decision

- The official host release is `dsh-v0.2.0-rc.1`, commit
  `4878cdabd87d4041bdaff61d04c966883b9fd07a`. At inspection time npm `next`
  pointed to 0.2.0-rc.1 while `latest` remained 0.1.7-rc.2.
- The previous `^0.1.7-rc.1` range does not admit 0.2.0-rc.1, even with the
  host's `includePrerelease: true` gate. All seven DSH peers and `engines.dsh`
  now additionally declare `^0.2.0-rc.1`; existing ranges remain intact.
- DSH development packages and the frozen lockfile now target 0.2.0-rc.1.
  Cordis 4.0.4, Schemastery 3.18.4, Loader 1.0.5 and Include 1.0.9 are unchanged.
- The host's failed-tool recovery needs regression coverage, not another plugin
  recovery layer. Its Settings editor performance change retains the composition
  and revision contract. No plugin runtime or generated client change was needed.
- The bundle patch, `manifestVersion: 1`, profile installation commands,
  pre-step injection, shell identity and Trellis templates are unchanged.

## Automated results

| DSH host | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| 0.2.0-rc.1 | 129 | 0 | 0 |
| 0.1.7-rc.2 | 127 | 2 | 0 |
| 0.1.7-rc.1 | 124 | 5 | 0 |
| 0.1.6-alpha.2 | 122 | 7 | 0 |
| 0.1.5-rc.2 | 122 | 7 | 0 |

All hosts execute the same 129 tests. The two failed-tool tests require
`ToolCallRecovery`; three dynamic-tool tests require `Session.toolHistory`.
The oldest two hosts additionally skip the native catalog and volatile Loader
integrations. Skips are explicit capability guards, not swallowed errors.

Reproduction:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:client
pnpm test
pnpm run test:compat 0.1.5-rc.2 0.1.6-alpha.2 0.1.7-rc.1 0.1.7-rc.2
npm pack --dry-run --ignore-scripts
git diff --check
```

The default checkout uses the frozen 0.2 lockfile. Compatibility tests install
older published package sets into isolated temporary copies and leave them for
inspection. The runner also supports 0.2 explicitly when no host arguments are
given. CI configuration runs the baseline and four older hosts on Windows and
Linux; this local pass does not claim a new remote CI result.

Frozen install, client build, package dry-run and diff checks passed. The package
still contains 16 files; tests, fixture helpers and validation documents are not
shipped as runtime files. Rebuilding the client produced no tracked bundle change.

### New regression coverage

`test/failed-tool-history.test.js` runs the real AgentLoop, ToolRuntime, Session,
projection registry and the plugin's actual wait tool, with a scripted local LLM
adapter and a cold direct-child catalog fixture. Commands and shell registration
are stubbed because they are unrelated to this scenario. Two scheduler fault
injections exercise the upstream recovery boundary:

1. Failure during execution-mode selection: the affected and later calls receive
   `TOOL_NOT_STARTED` because dispatch never began.
2. Failure finalizing an executed wait: the affected call receives
   `TOOL_OUTCOME_UNKNOWN`; the later call still receives `TOOL_NOT_STARTED`.

Both preserve an earlier committed result and the original failure, commit all
missing tool results before step/turn closure, release wait listeners, and keep
exactly one breadcrumb. An explicit subsequent user turn receives paired tool
history and completes without replaying any wait. This verifies host failure
recovery and continuation, not automatic retry or real-provider behavior.

`test/wait-catalog.test.js` also verifies that a successful settlement event
arriving during a subsequently rejected catalog lookup cannot mask that failure.
The exact lookup error survives and its listener is removed. Existing tests keep
covering cancellation, unload, direct-child identity and inactive/unknown outcomes.

## Isolated Web acceptance

Installed the full `@deepseek-ai/dsh@0.2.0-rc.1` CLI into a new temporary prefix,
then set `DSH_HOME` to a new directory beneath it. No personal credentials, profile
configuration or sessions were copied. Used the actual CLI commands:

```powershell
# Use the isolated CLI entry point and DSH_HOME for both commands.
node <isolated-prefix>/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile web add file:C:/path/to/dsh-trellis
node <isolated-prefix>/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 0 --no-open
```

Normal plugin admission and startup passed without `allow-version`. Browser
acceptance used a dedicated agent-browser 0.38.1 session. The stock preview notice
was acknowledged and API-key setup was skipped; no model request was submitted.

- Plugin detail rendered all six controls with one running component and no
  duplicated form.
- Editing `maxBytes=6144` and `skipKeyword=verify-020` did not write the profile
  patch until Save. One save persisted both values to `cordis.patch.yml`; the
  rendered readback and disk values agreed.
- Resetting `maxBytes` and saving removed that user-layer key, displayed the
  inherited 4096, and retained the unrelated skip-keyword override.
- Saving `enabled=false` retained the configuration form. Component disable
  removed the form; re-enable restored one form and retained saved values.
  Whole-bundle disable/re-enable likewise removed/restored the form once.
- With draft `maxBytes=8192`, an external edit changed the isolated profile value
  to 7168. Save was refused, the 8192 draft and failure status stayed visible,
  and disk remained 7168. Discarding the draft read 7168 into the form.
- Re-enabling the config and reloading the browser preserved saved values and
  showed one form/component. Browser errors and console output were empty;
  the server emitted no further diagnostics during these operations.

Screenshots of initial startup, the conflict state and final readback were
inspected locally. The dedicated browser session and isolated Web server were
stopped after verification; temporary fixtures remain available for inspection.
The test did not uninstall the npm package or test remote workspaces.

## Official references and boundaries

- [0.2.0-rc.1 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.1)
- [Peer admission contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/boot/app-boot/src/plugin-compatibility.ts)
- [Failed-tool recovery merge](https://github.com/deepseek-ai/deepseek-harness/commit/67f648cf0ce3b031adbfca60d04c5bc68ecc8123)
- [Settings editor performance merge](https://github.com/deepseek-ai/deepseek-harness/commit/3366973eeac79e598c23d16f1abfe0b0ec79bee0)
- [Settings contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.1/packages/settings/settings/README.md)

This pass does not certify external model requests, real LLM-backed subagent
delegation, remote workspaces or a global CLI upgrade. Existing Trellis source,
templates and unfinished task edits were left untouched. No personal profile
refresh was performed. This record describes local pre-release checks; commit,
push, publication and remote CI results belong to the tagged release.
