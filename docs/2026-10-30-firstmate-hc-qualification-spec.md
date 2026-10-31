# FirstMate hc Backend Qualification for Herdr — Specification and Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. The execution method is chosen at implementation time. Checkboxes track proposed work, not completed work.

**Goal:** Establish whether FirstMate's experimental upstream `hc` execution backend runs real FirstMate tasks correctly with Herdr app 0.1.10 and herdr-core 0.1.15, and fix demonstrated gaps narrowly.

**Relationship to the fleet panel:** This work was split out of the [fleet panel specification](2026-10-30-firstmate-herdr-technical-spec.md) in its revision 3. The panel consumes no interface from it and renders whatever backend FirstMate's Bearings model reports. A failure here blocks claims of an integrated hc setup; it does not block the panel.

**Date:** 2026-10-30. **Status:** Proposed qualification specification; no runtime validation completed. **Owner:** Andrew Goldfinch.

## 1. Decision and scope

Reuse FirstMate's experimental upstream `hc` backend, introduced by commit `355a30710d6e545fe57f720896ed440ee5d99a9a`. Qualify it rather than implement a duplicate. Do not build a second adapter to bypass a qualification failure.

The qualification harness may launch, steer and terminate its own disposable workers through FirstMate. Upstream `hc` currently refuses all `--secondmate` spawns, not just remote ones. Existing child summaries remain display-only data.

This work does not assert durable task resumption or exactly-once external delivery. Those remain separate execution-provider questions.

## 2. Evidence and compatibility baseline

Source review established the following, not live interoperability:

| Component | Reviewed revision | Relevant contract |
| --- | --- | --- |
| FirstMate upstream | `355a30710d6e545fe57f720896ed440ee5d99a9a` | Experimental `bin/backends/hc.sh`, `docs/hc-backend.md` and the verification record; adoption baseline |
| Herdr core | `d02842335e33e4d70324e1122baeed8701f49e9b` (the 0.1.15 release commit) | `hc` CLI, including `run --no-parent --outlive-parent --no-notify --keep`; terminal RPCs, status and event semantics |
| Herdr app | `8180cbe6c947519e8015dd7c35801a93e08a7d66` (two commits before `v0.1.10`) | Display of the `default` session; `herdr.space` / `herdr.tab` label adoption |

The old `herdr` adapter is not interchangeable with `hc`: it uses old CLI commands, pane targets and pane events. The new core has terminal addresses, separate app presentation, program-reported status and a different event protocol. Do not alias `herdr` to `hc` or silently redirect the old backend.

The opening contract of the adapter in `AndrewGoldfinch/firstmate`, branch `experiment/pi-durable-supervision`, still describes the older `herdr` session/workspace/tab/pane interface. That inspection does not establish whether `355a307` is present in Andrew's branch. Check ancestry and dependencies before adoption, without modifying the held Pi Durable experiment implicitly.

Qualify Herdr app **0.1.10** with herdr-core **0.1.15** as the initial target pair. Record actual binary versions, build revisions and checksums. Changelogs confirm these releases, not their compatibility with this project. App 0.1.10 fixes `herdr-app check` crashes involving scrolling lists and layout animations; core 0.1.15 fixes restoration of kept terminals and spaces after shutdown or reboot. Restored shells do not establish task resumption.

FirstMate [PR #8011](https://github.com/kunchenguid/firstmate/pull/8011) (“feat: report worker status through OSC 7501”, open on October 31, 2026, branched from `355a307`) is tracked as an enhancement in section 6, not adopted. It touches none of the files the adapter contract or the fleet panel reads.

Upstream verification primarily uses core 0.1.13 on macOS, plus a 0.1.14 socket-precedence probe. It reports lifecycle smoke tests, a stand-in scout's spawn/send/peek/teardown, and bare Claude Code/Codex liveness. Real-harness spawn, ship spawn, real composer submit confirmation, native status under FirstMate launch and app grouping remain explicitly unverified. Pi/OpenCode were not installed in that live guard. These are upstream-reported results, not tests run for this project.

## 3. Existing adapter contract to preserve

- Explicit selection through FirstMate's backend configuration or explicit launch option; inherited `HC_TERMINAL_ID` must not select hc.
- One terminal per task, with Treehouse continuing to own worktrees.
- Creation uses `--no-parent --outlive-parent --no-notify`, giving workers lifetimes independent of the terminal running FirstMate.
- Metadata records `backend=hc`, `window=<session>:<address>`, `hc_session` and `hc_terminal`.
- Labels `firstmate.task` and `firstmate.home` are checked before operations requiring ownership. Display names alone must never authorize an action.
- Every adapter call restores the recorded `HC_SESSION` and drops inherited `HC_SOCKET`, which otherwise takes precedence.
- `hc send` submits automatically. FirstMate handles the launch-line Enter and composer confirmation; do not add another unconditional Enter in an integration layer.
- Liveness checks include local process-group inspection when the foreground program is a wrapper. This is not evidence of remote process visibility.
- Teardown kills, removes and verifies absence. Supervision currently polls; the adapter does not consume core events.
- Native program status under real FirstMate launches and visual grouping by `herdr.space` / `herdr.tab` remain qualification targets.
- All `--secondmate` spawns are refused by the documented adapter.

## 4. Integration test environments

Use a dedicated checkout or worktree containing the upstream merge and its dependencies. Inspect the user's fork before choosing rebase/merge/cherry-pick; do not assume one file is sufficient. Leave the held Pi Durable branch and its frozen conclusions unchanged.

For CLI lifecycle and fault tests, use a short private temporary root, unique `HC_SESSION`, and isolated XDG state/runtime directories as upstream does. Record and sanitize inherited HC variables. Upstream encountered Unix socket length limits; long workspace paths are unsuitable for these private sockets.

**App visibility requires a separate setup:** the reviewed documentation says Herdr.app displays the `default` session. A named private-core test therefore cannot prove visual integration. Use a disposable OS user/VM with app and core sharing the same default-session environment and an isolated FirstMate home. Create a separate sentinel task, and never stop the user's normal default core. Do not assume undocumented app session switching works.

Use harmless synthetic repositories and bounded prompts. Existing agent authentication is configured outside fixtures; record versions and redact credentials/output. Integration logs identify which operator/harness initiated mutations. A skipped test is not a pass.

## 5. Integration acceptance matrix

| ID | Probe | Required evidence |
| --- | --- | --- |
| I01 | Run upstream adapter tests on the target versions | Unit/fake, private-core smoke and installed-harness liveness results; explicit skips |
| I02 | Real task through FirstMate | Spawn in an isolated worktree, process recognized, bounded prompt produces expected artifact; repeat scout and ship paths before claiming both |
| I03 | App visibility and grouping | Task appears in the disposable default-session app; observed space/tab mapping and actual terminal identity recorded |
| I04 | Steering, inspection and teardown | One follow-up submitted once, correct captured output/state, task removed, sentinel PID/terminal unchanged |
| I05 | Selection and session isolation | Inherited HC markers do not select backend; conflicting HC_SOCKET/HC_SESSION cannot redirect recorded-task operations |
| I06 | Ownership and replacement | Same task IDs in different homes, mismatched labels and stale/replaced targets refuse misdirected input/termination; disclose any same-label replacement gap |
| I07 | Real composers and status | Separate results for submit confirmation, wrapper liveness and native status for Claude Code, Codex, Pi and OpenCode |
| I08 | Parent loss and core restart | Expected independent lifetime on parent exit; crash/restart state is honest, no duplicate launch or false resumed-agent claim |
| I09 | Kept-terminal restore and stale callbacks | Test kept-shell restoration separately from non-kept FirstMate tasks; delayed old observations never update a replacement generation |
| I10 | Unsupported modes | hc secondmate attempts fail clearly; existing child summaries remain displayable without probing or spawning them |
| I11 | Model-pin readback | For each harness launched with `--model` (and `--effort`), the pin FirstMate records (`model=`/`effort=` in task metadata, `model` in the ledger's `task.dispatched`) matches the launch argv read back through `hc get` (foreground and process group) and, where the harness exposes it, the model the harness itself reports. Repeat after `--relaunch` and after core restart |
| I12 | State-preservation regressions | Task metadata (`spawn_gen`, `backend`, `hc_session`, `hc_terminal`, `model`, `effort`), status log and backlog are byte-identical before and after each of: app restart, app update, core restart, kept-terminal restore, fleet-panel collection, panel close and hot reload. Only documented writes differ (the collector's `state/secondmate-summary-cache/`, FirstMate's own status appends) |

For I07 classify each dimension as PASS, FAIL, NOT RUN or UNSUPPORTED, recording exact versions. Missing native status is displayed as unknown by any consumer and blocks claims of native-status support. Missing installation/authentication is NOT RUN, not UNSUPPORTED.

For I11, FirstMate threads `--model` only into harnesses verified to support that axis and omits it otherwise, and some harnesses accept an invalid model at launch (`bin/fm-spawn.sh` header). A pin that was omitted, not applied or not readable is NOT APPLIED or UNKNOWN, never PASS. Argv alone proves the flag was passed, not the model in use; record which evidence each row rests on. hc's OSC 7501 status (`state`, `kind`, `progress`, `app`, `title`, `msg`) has no model field, so hc offers no native readback.

For I12, diff the files themselves, not their summaries, and record the method. Any unexplained byte change fails the row, including a change that leaves the projection identical. Rerun I12 whenever the adapter, the launch path or the panel's collector invocation changes; it is the regression guard for the restart behaviour I08 and I09 qualify.

## 6. Phases

| Phase | Deliverable | Entry / exit condition |
| --- | --- | --- |
| H1 — first integration milestone | One real FirstMate task launched, visible in Herdr, steered, inspected and terminated without affecting a sentinel task | I01–I04 pass for one installed real harness on app 0.1.10 / core 0.1.15 |
| H2 — qualification and hardening | Reused upstream hc backend, documented harness matrix and narrowly scoped fixes | I01–I12 run; every advertised supported combination passes its required tests |

H1 can run alongside the panel's fixture and UI work. Broader support claims require the relevant I05–I12 safety tests and per-harness results. Do not claim all four harnesses from a stand-in or bare-process liveness test. Do not claim a harness honours model pins without its I11 row, or that any restart path preserves task state without I12.

### Tracked enhancement: worker-side OSC 7501 reporting (FirstMate #8011)

PR #8011 adds `bin/fm-osc7501.sh`, armed by `fm-spawn.sh` inside each launch, which writes OSC 7501 root records (`app=firstmate-<harness>`, `title=fm-<task>`) to the worker's own terminal. It maps an open `needs-decision` or held status to `blocked` (`kind=question`), `blocked` to `blocked` (`kind=permission` or `auth`), busy activity to `working`, `failed` to `error` and `done` to `done`. It is on by default per home (`config/osc7501-status`), stands down for harnesses that report natively (Claude Code ≥ 2.1.295, Pi ≥ 1.1.0 per the PR), and skips `backend=herdr` and `t3code`. The PR calls it Stage 2 of a staged herdr-core/app plan, with core/app integration as Stage 3.

Why it is tracked rather than adopted:

- It is open. The automated review at the time of reading still listed two P1 issues: the capability probe can consume typed input on unknown terminals, and on Rex the bridge's own `working` record can keep a finished worker busy.
- It would answer I07's “native status under real FirstMate launches” for non-native harnesses, but with FirstMate-derived status, not the harness's own. Rows must record which reporter produced the status.
- It changes no file the adapter contract or the fleet panel reads.

If it merges, add these conditional probes before relying on it, classified like I07:

| ID | Probe | Required evidence |
| --- | --- | --- |
| O1 | Mapping | For each status-log state above, `hc get` `.status` shows the mapped record with `app=firstmate-<harness>` |
| O2 | Native stand-down | A native-reporting harness version gets no FirstMate record; an older version does |
| O3 | Input safety | Typed input during launch on an unknown terminal reaches the worker intact; the saved `stty` mode is restored |
| O4 | Lifecycle | After agent exit, parent death, `--relaunch` and teardown: one watcher per terminal, `done`/`error` kept, otherwise `idle`; a finished worker is never left `working` |
| O5 | Restart | After core restart and kept-terminal restore, no stale `working` record outlives the agent; I12 still passes |

### Hardening after qualification

Fix demonstrated gaps in the reused upstream adapter and contribute focused changes where appropriate. Label/task checks are existing safeguards, not proof of generation-safe ownership after every restart. Test same-label replacement and record any missing fence before any panel action phase targets hc terminals.

Event-driven supervision remains optional future work. If introduced, honor initial snapshots and missed-event resynchronization; do not imply the current polling adapter already does this. The core 0.1.15 restoration fix and independent worker lifetimes do not prove durable execution or exactly-once external delivery.

## 7. Implementation plan

### Task H — reuse and qualify the upstream hc integration

**Files:** `docs/hc-qualification.md`, `eval/hc-matrix.csv`, `eval/hc-scenarios.md`; any actual adapter fixes belong in the isolated FirstMate checkout, not the panel mod.

**Consumes:** the panel's Task 0 host/checkout record when available, otherwise an equivalent record made here, and the upstream hc implementation. **Produces:** a real-worker milestone result, versions and evidence for I01–I12.

- [ ] Confirm the selected checkout contains commit `355a30710d6e545fe57f720896ed440ee5d99a9a` or an inspected equivalent and its dependencies; record the actual checkout SHA.
- [ ] Run from that checkout: `bash tests/fm-backend-hc.test.sh`, `bash tests/fm-backend-hc-smoke.test.sh`, and `bash tests/fm-backend-hc-liveness-live-e2e.test.sh`. Require the documented completion markers and inspect skipped-harness output; exit zero alone is insufficient.
- [ ] Run I02–I04 in the disposable default-session app setup, using existing FirstMate commands, one real harness and a sentinel. Record the artifact, steering result, visual identity and teardown evidence.
- [ ] Run I05–I10 in their appropriate private/default environments. Record one row per test/harness/version with result and evidence path; do not mark planned probes as completed.
- [ ] Run I11 for every installed harness with and without `--model`/`--effort`, recording the evidence each result rests on (metadata, argv, harness report).
- [ ] Snapshot task metadata, status logs and backlog, run each I12 trigger, and diff the files; attach the diffs to the row.
- [ ] If FirstMate #8011 has merged into the selected checkout, run O1–O5 and record which reporter produced each status; otherwise record the PR as NOT RUN.
- [ ] If a probe fails, add a focused regression test in FirstMate before modifying its adapter. Preserve existing selection/ownership safeguards and rerun affected upstream tests.
- [ ] Commit the qualification report independently of panel code. A failed milestone leaves the hc integration explicitly experimental.

## 8. Source references

Reviewed October 30, 2026. Source pins are review baselines, not a claim that later releases are compatible. The changelog links follow upstream; qualification must record immutable revisions and binary checksums.

- [FirstMate PR #8011: worker status through OSC 7501](https://github.com/kunchenguid/firstmate/pull/8011) (tracked, open)
- [OSC 7501 Program Status Protocol proposal](https://control-codes.page/proposals/osc-7501/) (revision 0.4, as cited by the PR)
- [Upstream hc implementation commit](https://github.com/kunchenguid/firstmate/commit/355a30710d6e545fe57f720896ed440ee5d99a9a)
- [hc backend operator contract](https://github.com/kunchenguid/firstmate/blob/355a30710d6e545fe57f720896ed440ee5d99a9a/docs/hc-backend.md)
- [hc adapter source](https://github.com/kunchenguid/firstmate/blob/355a30710d6e545fe57f720896ed440ee5d99a9a/bin/backends/hc.sh)
- [Upstream live verification record](https://github.com/kunchenguid/firstmate/blob/355a30710d6e545fe57f720896ed440ee5d99a9a/docs/verification/runtime-backends.md#hc)
- [Existing FirstMate Herdr adapter](https://github.com/kunchenguid/firstmate/blob/355a30710d6e545fe57f720896ed440ee5d99a9a/bin/backends/herdr.sh)
- [Herdr core CLI](https://github.com/herdrdev/herdr-core/blob/d02842335e33e4d70324e1122baeed8701f49e9b/docs/commands.md)
- [Herdr core protocol and event semantics](https://github.com/herdrdev/herdr-core/blob/d02842335e33e4d70324e1122baeed8701f49e9b/schema/README.md)
- [Herdr app mod guide](https://github.com/herdrdev/herdr-app/blob/8180cbe6c947519e8015dd7c35801a93e08a7d66/defaults/AGENTS.md)
- [App changelog: 0.1.10](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md)
- [Core changelog: 0.1.15](https://github.com/herdrdev/herdr-core/blob/master/CHANGELOG.md)
