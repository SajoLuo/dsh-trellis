/**
 * Idempotent checker and repair utility for project Trellis DSH templates.
 *
 * Keeps `dsh-trellis` self-contained without waiting for upstream Trellis CLI
 * releases when @mindfoldhq/trellis@0.7.0-beta.4 emits stale DSH dispatch,
 * fallback, or resume instructions.
 *
 * @module dsh-trellis/doctor
 */
import { join } from "node:path";
import { nodeFs } from "./node-fs.js";

const RESEARCH_LEGACY_RE =
  /^Run `((?:python3|python|py -3)) \.\/\.trellis\/scripts\/task\.py current --source` to get the active task path\. Prefer an `Active task: <path>` line in the dispatch prompt when present\. If no active task is set, ask the user where to write output; do NOT guess\.$/m;
const RESEARCH_CANONICAL_RE =
  /^Check the dispatch prompt first: if it includes `Active task: <path>`, use that exact path without running `task\.py current`\. Otherwise run `(?:python3|python|py -3) \.\/\.trellis\/scripts\/task\.py current --source` to get the active task path\. If neither yields a task path, ask the user where to write output; do NOT guess\.$/m;

const DSH_GUIDE_TABLE_ROLE_CANONICAL =
  "| Implement/check/research roles | Legacy foreground, verified native yield/result path, or main-session fallback | Native sub-agent with `trellis_wait` when exposed; otherwise the same capability-selected fallback |";
const DSH_GUIDE_TABLE_ROLE_LEGACY =
  "| Implement/check/research roles | Foreground native sub-agent | Background native sub-agent |";

const DSH_GUIDE_TABLE_SYNC_CANONICAL =
  "| Event-driven child synchronization | No dedicated wait tool; native notification/yield may be available | `trellis_wait` when present in the actual tool catalog; otherwise the same native/foreground/main-session paths |";
const DSH_GUIDE_TABLE_SYNC_LEGACY =
  "| Event-driven child wait | Not available | `trellis_wait` |";

const DSH_GUIDE_TABLE_CMD_CANONICAL =
  "| Utility commands | Not available | `/trellis-status`, `/trellis-finish`, `/trellis-doctor` |";
const DSH_GUIDE_TABLE_CMD_LEGACY =
  "| Utility commands | Not available | `/trellis-status`, `/trellis-finish` |";

const DSH_GUIDE_FALLBACK_CANONICAL = [
  "The Trellis adapter does not install a DSH profile plugin. Before dispatching a",
  "role, inspect the actual tool catalog and `subagent` schema, not plugin presence",
  "alone. DSH 0.2.1-alpha.2+ removed `run_in_background` and returns immediately",
  "with a subagent handle (`subagentId` or, on DSH 0.2.2-rc.2+, a subagent `name`",
  "plus resolved `subagentId`); returning a handle is not completion evidence.",
  "",
  "- If `trellis_wait` is exposed, dispatch `subagent` normally, continue",
  "  independent work, then call `trellis_wait` once per dependent child (passing",
  "  the returned `name` when accepted by `subagent_id`, or native `subagentId`).",
  "  Require a settled `completed` outcome and inspect the actual report or",
  "  transcript before entering the dependent gate. `settlementNoticeQueued: false`",
  "  means notice delivery is unverified, not that it failed.",
  "- Without `trellis_wait`, use `run_in_background: false` only when the legacy",
  "  tool schema exposes it; inspect the returned outcome and report before the",
  "  dependent gate. Never pass `run_in_background` on DSH 0.2.1-alpha.2+.",
  "- Without `trellis_wait` or legacy foreground support, dispatch only if the",
  "  host exposes a verified native notification/yield path: yield the parent and",
  "  consume the actual successful result and report or transcript before the",
  "  dependent gate.",
  "- If no reliable synchronization path exists, do the work in the main session,",
  "  loading the task artifacts and referenced specs directly. Do not start an",
  "  unsynchronizable child or load a child-only role skill in the main session.",
  "",
  "Unknown, aborted, or failed outcomes block the dependent gate. The SDK",
  "`session/wait` API is not assumed to be a model-callable tool. Never replace any",
  "path with shell sleep, polling loops, `job_output`, or repeated agent-list",
  "polling.",
].join("\n");

const DSH_GUIDE_FALLBACK_BETA4 = [
  "The Trellis adapter does not install a DSH profile plugin. Before dispatching a",
  "role, check whether the `trellis_wait` tool is available:",
  "",
  "- If available, use DSH's default continuable background mode, continue",
  "  independent work, then call `trellis_wait` once per dependent child id and",
  "  consume each native settlement notice before entering the dependent gate.",
  "- If unavailable, dispatch every child with `run_in_background: false` from the outset",
  "  so the dependent workflow gate cannot overtake it.",
  "",
  "Never replace either path with shell sleep, polling loops, `job_output`, or",
  "repeated agent-list polling.",
].join("\n");

const DSH_GUIDE_FALLBACK_PR657 = [
  "The Trellis adapter does not install a DSH profile plugin. Before dispatching a",
  "role, inspect the actual tool catalog and `subagent` schema, not plugin presence",
  "alone. DSH 0.2.1-alpha.2 returns a `subagentId` immediately and has no",
  "`run_in_background` parameter; a returned child id is not completion evidence.",
  "",
  "- If available, use `trellis_wait` with the normal continuable `subagent`",
  "  contract, continue independent work, then call it once per dependent child id.",
  "  Require a successful settled outcome and inspect the actual report or",
  "  transcript before entering the dependent gate. A wait result or end event",
  "  does not prove a native settlement notice was queued or delivered;",
  "  `settlementNoticeQueued: false` means delivery is unverified, not that it",
  "  definitely failed. Do not wait for a separate notice after a verified result.",
  "- If unavailable, use `run_in_background: false` only when the legacy tool",
  "  schema supports it. Inspect the successful returned outcome and actual report",
  "  or transcript before the dependent gate. Never send this removed parameter",
  "  to alpha.2.",
  "- Without a wait tool or legacy foreground support, dispatch only if the host",
  "  exposes a verified native notification/yield path: yield the parent and",
  "  consume the actual successful result and report or transcript before the",
  "  dependent gate. Native settlement notices are best-effort; merely expecting",
  "  one is not a verified synchronization path.",
  "- If no reliable synchronization path exists, do the work in the main session,",
  "  loading the task artifacts and referenced specs directly. Do not start an",
  "  unsynchronizable child or load a child-only role skill in the main session.",
  "",
  "Unknown, aborted, or failed outcomes leave the dependent gate blocked or failed.",
  "The SDK `session/wait` API is not automatically a model-callable tool: use only",
  "synchronization tools or native yield behavior actually exposed by the host.",
  "",
  "Never replace any path with shell sleep, polling loops, `job_output`, or",
  "repeated agent-list polling.",
].join("\n");

const DSH_GUIDE_RESUME_CANONICAL = [
  "keep",
  "  the workflow in one session or pass `--session-id <id>` on",
  "  `dsh --profile headless` when resuming.",
].join("\n");
const DSH_GUIDE_RESUME_LEGACY = [
  "keep",
  "  the workflow in one session or explicitly resume its returned session id.",
].join("\n");

const WORKFLOW_PROTOCOL_CANONICAL =
  "On DeepSeek Harness, tell the child to load the matching `.dsh/skills/trellis-agent-<role>/SKILL.md` exactly once, then choose synchronization from the actual tool catalog and `subagent` schema, not companion plugin presence alone. With `trellis_wait`, dispatch continuable `subagent`, continue independent work, then call `trellis_wait` once per dependent child (using its returned `name` or native `subagentId`) and verify a settled `completed` outcome plus the actual report or transcript before the dependent gate (`settlementNoticeQueued: false` means notice delivery is unverified, not failed). Without `trellis_wait`, use `run_in_background: false` only when the legacy schema exposes it; DSH 0.2.1-alpha.2+ removed `run_in_background` and returns a child handle immediately, so without a waiter use a verified native notification/yield path or execute in the main session without loading child-only role skills. Unknown, aborted, or failed outcomes block the gate. Never assume SDK `session/wait` is a model-callable tool, and never poll or sleep.";
const WORKFLOW_PROTOCOL_BETA4 =
  "On DeepSeek Harness, tell the child to load the matching `.dsh/skills/trellis-agent-<role>/SKILL.md` exactly once, then choose the synchronization path by capability. If the optional companion plugin exposes `trellis_wait`, dispatch `subagent` in its default continuable background mode, continue independent work, and call `trellis_wait` once per dependent child id when a dependent gate is next; each call returns only after DSH has queued that child's native settlement notice. Without `trellis_wait`, dispatch each child with `run_in_background: false` from the outset so no dependent gate can overtake it. Never simulate waiting with shell sleep, polling loops, `job_output`, repeated `list_agents`, or another long-running command, and never leave a background child without an event-driven wait path.";
const WORKFLOW_PROTOCOL_PR657 =
  "On DeepSeek Harness, tell the child to load the matching `.dsh/skills/trellis-agent-<role>/SKILL.md` exactly once, then choose synchronization by the actual tool catalog and schema, not optional companion plugin presence alone. With `trellis_wait`, use the normal continuable `subagent` contract (default continuable background mode where supported), continue independent work, then call `trellis_wait` once per dependent child id; require a successful settled outcome and inspect the actual report or transcript before the dependent gate. A wait result or end event does not prove a native settlement notice was queued or delivered. Without `trellis_wait`, use `run_in_background: false` only if the legacy schema supports it. DSH 0.2.1-alpha.2 returns a `subagentId` immediately and has no `run_in_background`: without a waiter, use a verified native notification/yield path, yield the parent and consume the actual successful result and report or transcript; if no reliable synchronization path exists, do the work in the main session and do not start an unsynchronizable child. Unknown, aborted, or failed outcomes block the dependent gate. Never assume the SDK `session/wait` API is a model-callable tool. Never simulate waiting with shell sleep, polling loops, `job_output`, repeated `list_agents`, or another long-running command.";

const WORKFLOW_IN_PROGRESS_CANONICAL =
  "On DeepSeek Harness, role instructions ship as collision-free `trellis-agent-implement` / `trellis-agent-check` / `trellis-agent-research` skills under `.dsh/skills/`. Main sessions must not load them: tell the child to load the matching role skill once. Check the actual tool catalog and schema: with `trellis_wait`, dispatch continuable `subagent`, continue independent work, call `trellis_wait` once per child (`name` or `subagentId`), and verify settled `completed` outcome plus actual report/transcript. Without a waiter, use `run_in_background: false` only if the legacy schema supports it; on DSH 0.2.1-alpha.2+ use a verified native notification/yield path or work directly in the main session. Unknown/aborted/failed outcomes block the gate; never poll, sleep, or assume SDK `session/wait` is a model tool.";
const WORKFLOW_IN_PROGRESS_BETA4 =
  "On DeepSeek Harness, role instructions ship as collision-free `trellis-agent-implement` / `trellis-agent-check` / `trellis-agent-research` skills under `.dsh/skills/`. The main session must not load them itself: tell the child to load the matching role skill exactly once. If `trellis_wait` is available, use the default background mode, do independent work, then call `trellis_wait` once per dependent child id and consume each native settlement notice before entering the dependent gate. If it is unavailable, dispatch every child with `run_in_background: false` from the outset. Do not poll, sleep, or start a background child without an event-driven wait path.";
const WORKFLOW_IN_PROGRESS_PR657 =
  "On DeepSeek Harness, role instructions ship as collision-free `trellis-agent-implement` / `trellis-agent-check` / `trellis-agent-research` skills under `.dsh/skills/`. The main session must not load them itself: tell the child to load the matching role skill exactly once. Choose by the actual tool catalog and schema: with `trellis_wait`, use normal continuable dispatch, do independent work, then wait once per dependent child id and inspect a successful settled outcome plus the actual report or transcript. A wait result or end event does not prove a native settlement notice was queued or delivered. Without a waiter, use `run_in_background: false` only if the legacy schema supports it. DSH 0.2.1-alpha.2 returns a `subagentId` immediately and has no `run_in_background`: use a verified native notification/yield path, yield the parent and consume the actual successful result and report or transcript, or do the work in the main session if no reliable synchronization path exists. Unknown, aborted, or failed outcomes block the dependent gate; do not start an unsynchronizable child, poll, sleep, or assume the SDK `session/wait` API is a model-callable tool.";

const WORKFLOW_DEFAULT_CANONICAL =
  "Main-session default: dispatch implement/check sub-agents, except the capability-selected DeepSeek Harness main-session fallback above. Sub-agent self-exemption:";
const WORKFLOW_DEFAULT_BETA4 =
  "Main-session default: dispatch implement/check sub-agents. Sub-agent self-exemption:";

const WORKFLOW_RESEARCH_CANONICAL =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-research` exactly once, chosen from the actual tool catalog and schema: with `trellis_wait`, dispatch continuable children concurrently when useful, continue unrelated work, call `trellis_wait` once per child (`name` or `subagentId`), and verify settled `completed` outcome plus actual report/transcript before advancing. Without a waiter, use `run_in_background: false` only when legacy schema supports it; on DSH 0.2.1-alpha.2+ use a verified native notification/yield path or research in the main session. Unknown/aborted/failed outcomes block advancement; never poll, sleep, or assume SDK `session/wait`.";
const WORKFLOW_RESEARCH_BETA4 =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-research` exactly once. If `trellis_wait` is available, use the default continuable background mode, dispatch independent questions concurrently when useful, continue unrelated work, then call `trellis_wait` once per child id and consume each settlement notice before advancing. Without `trellis_wait`, dispatch each required child with `run_in_background: false`; do not poll or sleep.";
const WORKFLOW_RESEARCH_PR657 =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-research` exactly once. Choose by the actual tool catalog and schema: with `trellis_wait`, use normal continuable dispatch, research independent questions concurrently when useful, continue unrelated work, then wait once per child id and inspect a successful settled outcome plus the actual report or transcript before advancing. A wait result or end event does not prove a native settlement notice was queued or delivered. Without a waiter, use `run_in_background: false` only if the legacy schema supports it. DSH 0.2.1-alpha.2 returns a `subagentId` immediately and has no `run_in_background`: use a verified native notification/yield path, yield the parent and consume the actual successful result and report or transcript, or research in the main session if no reliable synchronization path exists. Unknown, aborted, or failed outcomes block advancement; do not start an unsynchronizable child, poll, sleep, or assume the SDK `session/wait` API is a model-callable tool.";

const WORKFLOW_IMPLEMENT_CANONICAL =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-implement` exactly once, chosen from the actual tool catalog and schema: with `trellis_wait`, dispatch continuable `subagent`, continue independent work, call `trellis_wait` once (`name` or `subagentId`), and verify settled `completed` outcome plus actual report/transcript before Phase 2.2. Without a waiter, use `run_in_background: false` only when legacy schema supports it; on DSH 0.2.1-alpha.2+ use a verified native notification/yield path or implement in the main session. Unknown/aborted/failed outcomes block Phase 2.2; never poll, sleep, or assume SDK `session/wait`.";
const WORKFLOW_IMPLEMENT_BETA4 =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-implement` exactly once. If `trellis_wait` is available, use the default background mode, continue independent work, then wait once for that child id and consume its successful native settlement notice before Phase 2.2. Without `trellis_wait`, dispatch that child with `run_in_background: false`. Do not poll or sleep.";
const WORKFLOW_IMPLEMENT_PR657 =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-implement` exactly once. Choose by the actual tool catalog and schema: with `trellis_wait`, use normal continuable dispatch, continue independent work, then wait once for that child id and inspect a successful settled outcome plus the actual report or transcript before Phase 2.2. A wait result or end event does not prove a native settlement notice was queued or delivered. Without a waiter, use `run_in_background: false` only if the legacy schema supports it. DSH 0.2.1-alpha.2 returns a `subagentId` immediately and has no `run_in_background`: use a verified native notification/yield path, yield the parent and consume the actual successful result and report or transcript, or implement in the main session if no reliable synchronization path exists. Unknown, aborted, or failed outcomes block Phase 2.2; do not start an unsynchronizable child, poll, sleep, or assume the SDK `session/wait` API is a model-callable tool.";

const WORKFLOW_CHECK_CANONICAL =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-check` exactly once, chosen from the actual tool catalog and schema: with `trellis_wait`, dispatch continuable `subagent`, continue independent work, call `trellis_wait` once (`name` or `subagentId`), and verify settled `completed` outcome plus actual report/transcript before Phase 3. Without a waiter, use `run_in_background: false` only when legacy schema supports it; on DSH 0.2.1-alpha.2+ use a verified native notification/yield path or check in the main session. Unknown/aborted/failed outcomes block Phase 3; never poll, sleep, or assume SDK `session/wait`.";
const WORKFLOW_CHECK_BETA4 =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-check` exactly once. If `trellis_wait` is available, use the default background mode, continue independent work, then wait once for that child id and consume its successful native settlement notice before Phase 3. Without `trellis_wait`, dispatch that child with `run_in_background: false`. Do not poll or sleep.";
const WORKFLOW_CHECK_PR657 =
  "- **DeepSeek Harness**: tell the child to load `trellis-agent-check` exactly once. Choose by the actual tool catalog and schema: with `trellis_wait`, use normal continuable dispatch, continue independent work, then wait once for that child id and inspect a successful settled outcome plus the actual report or transcript before Phase 3. A wait result or end event does not prove a native settlement notice was queued or delivered. Without a waiter, use `run_in_background: false` only if the legacy schema supports it. DSH 0.2.1-alpha.2 returns a `subagentId` immediately and has no `run_in_background`: use a verified native notification/yield path, yield the parent and consume the actual successful result and report or transcript, or check in the main session if no reliable synchronization path exists. Unknown, aborted, or failed outcomes block Phase 3; do not start an unsynchronizable child, poll, sleep, or assume the SDK `session/wait` API is a model-callable tool.";

const CLI_ADAPTER_CANONICAL =
  'return ["dsh", "--profile", "headless", "--session-id", session_id]';
const CLI_ADAPTER_LEGACY =
  'return ["dsh", "--profile", "tui", "--resume", session_id]';

const META_SKILL_CANONICAL =
  "choose synchronization by actual tool capability: `trellis_wait` when exposed, schema-supported legacy foreground, verified native notification/yield, or main-session work when no reliable child synchronization exists. See `references/platform-files/agents.md` for settled-outcome/report gates and DSH 0.2.1-alpha.2+ / 0.2.2+ subagent contracts.";
const META_SKILL_BETA4 =
  "with the optional `dsh-trellis` plugin its continuable subagents use event-driven settlement waits, otherwise required children are dispatched in the foreground from the start.";
const META_SKILL_PR657 =
  "choose synchronization by actual tool capability: `trellis_wait` when exposed, schema-supported legacy foreground, verified native notification/yield, or main-session work when no reliable child synchronization exists. See `references/platform-files/agents.md` for successful-outcome/report gates and alpha.2's immediate-return contract.";

const META_AGENTS_CANONICAL =
  "| DeepSeek Harness | `.dsh/skills/trellis-agent-*/SKILL.md` (child-only role prompts; choose synchronization from the actual tool catalog and schema, not optional plugin presence alone; with `trellis_wait`, verify settled `completed` outcome via `name` or `subagentId` and inspect actual report/transcript; DSH 0.2.1-alpha.2+ has no `run_in_background`, so without a waiter use a verified native notification/yield path or main-session fallback) |";
const META_AGENTS_BETA4 =
  "| DeepSeek Harness | `.dsh/skills/trellis-agent-*/SKILL.md` (role prompts as child-only skills; optional `trellis_wait` enables continuable background settlement; without it, dispatch every child with `run_in_background: false` from the outset) |";
const META_AGENTS_PR657 =
  "| DeepSeek Harness | `.dsh/skills/trellis-agent-*/SKILL.md` (child-only role prompts; choose synchronization from the actual tool catalog and schema, not optional plugin presence alone; see the DSH contract below) |";

const META_PLATFORM_MAP_CANONICAL =
  "None installed by Trellis (pull-based roles; use exposed `trellis_wait`, schema-supported legacy foreground, verified native notification/yield, or main-session fallback; see `agents.md`)";
const META_PLATFORM_MAP_BETA4 =
  "None installed by Trellis (pull-based roles; optional `dsh-trellis` adds event-driven wait, otherwise foreground dispatch)";

const TEMPLATE_RULES = [
  {
    path: [".dsh", "DSH.md"],
    label: ".dsh/DSH.md",
    regions: [
      {
        canonical: DSH_GUIDE_TABLE_ROLE_CANONICAL,
        legacy: [DSH_GUIDE_TABLE_ROLE_LEGACY],
      },
      {
        canonical: DSH_GUIDE_TABLE_SYNC_CANONICAL,
        legacy: [DSH_GUIDE_TABLE_SYNC_LEGACY],
      },
      {
        canonical: DSH_GUIDE_TABLE_CMD_CANONICAL,
        legacy: [DSH_GUIDE_TABLE_CMD_LEGACY],
      },
      {
        canonical: DSH_GUIDE_FALLBACK_CANONICAL,
        legacy: [DSH_GUIDE_FALLBACK_BETA4, DSH_GUIDE_FALLBACK_PR657],
      },
      {
        canonical: DSH_GUIDE_RESUME_CANONICAL,
        legacy: [DSH_GUIDE_RESUME_LEGACY],
      },
    ],
  },
  {
    path: [".dsh", "skills", "trellis-agent-research", "SKILL.md"],
    label: ".dsh/skills/trellis-agent-research/SKILL.md",
    regions: [
      {
        canonicalPattern: RESEARCH_CANONICAL_RE,
        legacyRegex: RESEARCH_LEGACY_RE,
        replace:
          "Check the dispatch prompt first: if it includes `Active task: <path>`, use that exact path without running `task.py current`. Otherwise run `$1 ./.trellis/scripts/task.py current --source` to get the active task path. If neither yields a task path, ask the user where to write output; do NOT guess.",
      },
    ],
  },
  {
    path: [".trellis", "workflow.md"],
    label: ".trellis/workflow.md",
    regions: [
      {
        canonical: WORKFLOW_PROTOCOL_CANONICAL,
        legacy: [WORKFLOW_PROTOCOL_BETA4, WORKFLOW_PROTOCOL_PR657],
      },
      {
        canonical: WORKFLOW_IN_PROGRESS_CANONICAL,
        legacy: [WORKFLOW_IN_PROGRESS_BETA4, WORKFLOW_IN_PROGRESS_PR657],
      },
      {
        canonical: WORKFLOW_DEFAULT_CANONICAL,
        legacy: [WORKFLOW_DEFAULT_BETA4],
      },
      {
        canonical: WORKFLOW_RESEARCH_CANONICAL,
        legacy: [WORKFLOW_RESEARCH_BETA4, WORKFLOW_RESEARCH_PR657],
      },
      {
        canonical: WORKFLOW_IMPLEMENT_CANONICAL,
        legacy: [WORKFLOW_IMPLEMENT_BETA4, WORKFLOW_IMPLEMENT_PR657],
      },
      {
        canonical: WORKFLOW_CHECK_CANONICAL,
        legacy: [WORKFLOW_CHECK_BETA4, WORKFLOW_CHECK_PR657],
      },
    ],
  },
  {
    path: [".trellis", "scripts", "common", "cli_adapter.py"],
    label: ".trellis/scripts/common/cli_adapter.py",
    regions: [
      {
        canonical: CLI_ADAPTER_CANONICAL,
        legacy: [CLI_ADAPTER_LEGACY],
      },
    ],
  },
  {
    path: [".agents", "skills", "trellis-meta", "SKILL.md"],
    label: ".agents/skills/trellis-meta/SKILL.md",
    regions: [
      {
        canonical: META_SKILL_CANONICAL,
        legacy: [META_SKILL_BETA4, META_SKILL_PR657],
      },
    ],
  },
  {
    path: [
      ".agents",
      "skills",
      "trellis-meta",
      "references",
      "platform-files",
      "agents.md",
    ],
    label: ".agents/skills/trellis-meta/references/platform-files/agents.md",
    regions: [
      {
        canonical: META_AGENTS_CANONICAL,
        legacy: [META_AGENTS_BETA4, META_AGENTS_PR657],
      },
    ],
  },
  {
    path: [
      ".agents",
      "skills",
      "trellis-meta",
      "references",
      "platform-files",
      "platform-map.md",
    ],
    label: ".agents/skills/trellis-meta/references/platform-files/platform-map.md",
    regions: [
      {
        canonical: META_PLATFORM_MAP_CANONICAL,
        legacy: [META_PLATFORM_MAP_BETA4],
      },
    ],
  },
];

function applyRegionTransforms(text, regions) {
  let current = text;
  let canonicalCount = 0;

  for (const region of regions) {
    if (
      region.canonicalPattern
        ? region.canonicalPattern.test(current)
        : current.includes(region.canonical)
    ) {
      canonicalCount += 1;
      continue;
    }

    if (region.legacyRegex) {
      const updated = current.replace(region.legacyRegex, region.replace);
      if (updated !== current) {
        current = updated;
        canonicalCount += 1;
      }
      continue;
    }

    for (const variant of region.legacy ?? []) {
      const idx = current.indexOf(variant);
      if (idx === -1) continue;
      current =
        current.slice(0, idx) +
        region.canonical +
        current.slice(idx + variant.length);
      canonicalCount += 1;
      break;
    }
  }

  return {
    nextText: current,
    changed: current !== text,
    allCanonical: canonicalCount === regions.length,
  };
}

/**
 * Check or idempotently repair Trellis DSH templates under `root`.
 *
 * @param {string} root
 * @param {{ fs?: typeof nodeFs, fix?: boolean, signal?: AbortSignal }} [options]
 * @returns {Promise<{ kind: "success" | "error", text: string, summary?: { ok: number, drift: number, fixed: number, warn: number, skip: number } }>}
 */
export async function runTrellisDoctor(root, options = {}) {
  const fs = options.fs ?? nodeFs;
  const fix = options.fix === true;
  const signal = options.signal;

  const aborted = () => signal?.aborted === true;
  if (aborted()) return { kind: "error", text: "Trellis command cancelled." };

  const lines = [];
  const summary = { ok: 0, drift: 0, fixed: 0, warn: 0, skip: 0 };

  const hasDshGuide = await fs.exists(join(root, ".dsh", "DSH.md"));
  const hasImplementSkill = await fs.exists(
    join(root, ".dsh", "skills", "trellis-agent-implement", "SKILL.md"),
  );
  if (aborted()) return { kind: "error", text: "Trellis command cancelled." };

  if (!hasDshGuide || !hasImplementSkill) {
    summary.warn += 1;
    lines.push(
      "[warn] .dsh/: missing DSH templates; run 'npx @mindfoldhq/trellis@beta init --dsh'",
    );
  }

  const activeTaskPy = await fs.readFile(
    join(root, ".trellis", "scripts", "common", "active_task.py"),
  );
  if (aborted()) return { kind: "error", text: "Trellis command cancelled." };

  if (
    activeTaskPy !== null &&
    !activeTaskPy.includes("DSH_TRELLIS_CONTEXT_ID")
  ) {
    summary.warn += 1;
    lines.push(
      "[warn] .trellis/scripts/common/active_task.py: missing DSH_TRELLIS_CONTEXT_ID (likely @mindfoldhq/trellis@0.6.17); upgrade with 'npx @mindfoldhq/trellis@beta init --dsh'",
    );
  }

  for (const rule of TEMPLATE_RULES) {
    if (aborted()) return { kind: "error", text: "Trellis command cancelled." };
    const fullPath = join(root, ...rule.path);
    const raw = await fs.readFile(fullPath);
    if (raw === null) continue;

    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    const normalized = eol === "\r\n" ? raw.replace(/\r\n/g, "\n") : raw;
    const { nextText, changed, allCanonical } = applyRegionTransforms(
      normalized,
      rule.regions,
    );

    if (changed) {
      if (fix) {
        if (aborted()) return { kind: "error", text: "Trellis command cancelled." };
        const encoded =
          eol === "\r\n" ? nextText.replace(/\n/g, "\r\n") : nextText;
        try {
          await fs.writeFile(fullPath, encoded);
        } catch (error) {
          return {
            kind: "error",
            text: `Failed to update ${rule.label}: ${error?.message ?? String(error)}`,
          };
        }
        summary.fixed += 1;
        lines.push(`[fixed] ${rule.label}`);
      } else {
        summary.drift += 1;
        lines.push(`[drift] ${rule.label}`);
      }
      continue;
    }

    if (allCanonical) {
      summary.ok += 1;
      lines.push(`[ok] ${rule.label}`);
    } else {
      summary.skip += 1;
      lines.push(`[skip] ${rule.label}: customized content left untouched`);
    }
  }

  let footer;
  if (!fix && summary.drift > 0) {
    footer = `Found ${summary.drift} outdated DSH template file(s). Run /trellis-doctor --fix to update them idempotently.`;
  } else if (fix && summary.fixed > 0) {
    footer = `Updated ${summary.fixed} DSH template file(s).`;
  } else if (summary.warn === 0 && summary.skip === 0) {
    footer = "All checked Trellis DSH templates are up to date.";
  } else if (summary.warn === 0) {
    footer = "No automatically repairable DSH template drift found.";
  } else {
    footer = "Resolve warnings above after running @mindfoldhq/trellis@beta init --dsh.";
  }

  const header = `Trellis DSH template doctor (${fix ? "fix" : "check"}):`;
  const text = [header, ...lines, "", footer].join("\n");
  return { kind: "success", text, summary };
}
