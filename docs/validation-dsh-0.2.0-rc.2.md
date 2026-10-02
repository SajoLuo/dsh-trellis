# DSH 0.2.0-rc.2 compatibility validation

Validated locally on Windows / Node 24.12.0 / pnpm 10.33.0 on 2026-10-02,
using the working tree based on dsh-trellis 0.1.10, subsequently prepared as
0.1.11 at the user's release request. This records local checks, not a remote
CI result; publication and remote CI status belong to the tagged release.

## Decision and installation guidance

The official release `dsh-v0.2.0-rc.2` points to
`639ed015397290b3745d163aafe02ffee4aa3f84`. The inspected Settings,
pre-step, session projection and subagent interfaces retain their RC.1
contracts. The existing `^0.2.0-rc.1` host peer declarations admit RC.2;
no additional peer range or runtime shim is necessary.

The compatibility runner now explicitly includes RC.2, using Cordis 4.0.4,
Schemastery 3.18.4, Loader 1.0.5 and Include 1.0.9. Windows/Linux CI is
configured to run RC.2 alongside the frozen RC.1 baseline and four older
hosts. It has not been dispatched or run remotely for this patch.

README documents the desktop's managed CLI and the distinction between
`desktop`, `web` and `headless` profiles. It also recommends an explicit
package version when necessary: the desktop's pnpm 11 release-age policy can
make an unversioned installation select a version older than the preview.
The previously inspected desktop logs showed unversioned 0.1.9 rejected
against DSH 0.2.0-rc.2 and explicit 0.1.10 admitted. This pass does not disable
that policy, bypass peer admission or alter personal profiles.

## Automated results

| Host | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Frozen RC.1 checkout | 130 | 0 | 0 |
| Isolated RC.2 dependencies | 130 | 0 | 0 |

The extra compatibility manifest test accounts for the increase from the
129 tests recorded for the tagged 0.1.10 release. The same real AgentLoop,
Session, projection, Settings/Loader and wait-tool scenarios run on both
hosts; local scripted responses do not call an external provider.

Reproduction:

```powershell
pnpm test
pnpm run test:compat 0.2.0-rc.2
pnpm run build:client
npm pack --dry-run --ignore-scripts
git diff --check
```

Client build, package dry-run and diff checks passed. The package contains
16 runtime files; rebuilding produced no tracked client change. The isolated
fixture resolved the allowed floating tsdown version to 0.22.14 and zod to
4.6.5; the checkout's frozen lockfile was not changed. Historical host sets
were not rerun locally in this pass.

## Isolated Web acceptance

Installed the full `@deepseek-ai/dsh@0.2.0-rc.2` package into a fresh temporary
prefix and set `DSH_HOME` to a new directory beneath it. Used actual CLI
`plugin --profile web add file:C:/path/to/dsh-trellis` and
`web --host 127.0.0.1 --port 0 --no-open`. Normal admission succeeded without
`allow-version`. No personal credentials, settings or sessions were copied.
Browser acceptance used a dedicated agent-browser 0.38.1 session; API-key
onboarding was skipped and no model request was submitted.

- Detail displayed all six controls and one running component.
- Draft `maxBytes=6144`, `skipKeyword=verify-rc2` did not write disk before
  Save. One save persisted both fields; UI and profile patch agreed.
- Restoring maxBytes and saving removed its override, displayed inherited
  4096 and preserved the skip-keyword value.
- Saving `enabled=false` retained the form. Component and whole-bundle
  disable removed it; each re-enable restored exactly one form/component
  with saved values intact.
- With draft 8192, an external edit of the isolated profile set maxBytes
  to 7168. Save was refused, the 8192 draft and failure status remained,
  and disk stayed 7168. Discard loaded 7168.
- Re-enabled configuration and browser reload preserved saved values and
  one component/form. Browser errors and console output were empty.

The conflict screenshot was visually inspected. The dedicated browser and
Web server were stopped after acceptance; temporary fixtures remain for
inspection. No global DSH or personal profile was upgraded.

## Official references and limits

- [DSH RC.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2)
- [Peer admission](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/boot/app-boot/src/plugin-compatibility.ts)
- [Settings contract](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/settings/settings/README.md)
- [pnpm 11 release-age defaults](https://pnpm.io/blog/releases/11.0)

This does not certify Linux/macOS native execution, desktop-managed binary
ancestry, remote workspaces, provider conversations or real LLM-backed
subagent delegation. Trellis archive/identity source changes are separate
from this plugin check and have their own task validation record.
