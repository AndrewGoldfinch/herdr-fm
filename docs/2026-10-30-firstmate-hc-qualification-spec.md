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

For I07 classify each dimension as PASS, FAIL, NOT RUN or UNSUPPORTED, recording exact versions. Missing native status is displayed as unknown by any consumer and blocks claims of native-status support. Missing installation/authentication is NOT RUN, not UNSUPPORTED.

## 6. Phases

| Phase | Deliverable | Entry / exit condition |
| --- | --- | --- |
| H1 — first integration milestone | One real FirstMate task launched, visible in Herdr, steered, inspected and terminated without affecting a sentinel task | I01–I04 pass for one installed real harness on app 0.1.10 / core 0.1.15 |
| H2 — qualification and hardening | Reused upstream hc backend, documented harness matrix and narrowly scoped fixes | I01–I10 run; every advertised supported combination passes its required tests |

H1 can run alongside the panel's fixture and UI work. Broader support claims require the relevant I05–I10 safety tests and per-harness results. Do not claim all four harnesses from a stand-in or bare-process liveness test.

### Hardening after qualification

Fix demonstrated gaps in the reused upstream adapter and contribute focused changes where appropriate. Label/task checks are existing safeguards, not proof of generation-safe ownership after every restart. Test same-label replacement and record any missing fence before any panel action phase targets hc terminals.

Event-driven supervision remains optional future work. If introduced, honor initial snapshots and missed-event resynchronization; do not imply the current polling adapter already does this. The core 0.1.15 restoration fix and independent worker lifetimes do not prove durable execution or exactly-once external delivery.

## 7. Implementation plan

### Task H — reuse and qualify the upstream hc integration

**Files:** `docs/hc-qualification.md`, `eval/hc-matrix.csv`, `eval/hc-scenarios.md`; any actual adapter fixes belong in the isolated FirstMate checkout, not the panel mod.

**Consumes:** the panel's Task 0 host/checkout record when available, otherwise an equivalent record made here, and the upstream hc implementation. **Produces:** a real-worker milestone result, versions and evidence for I01–I10.

- [ ] Confirm the selected checkout contains commit `355a30710d6e545fe57f720896ed440ee5d99a9a` or an inspected equivalent and its dependencies; record the actual checkout SHA.
- [ ] Run from that checkout: `bash tests/fm-backend-hc.test.sh`, `bash tests/fm-backend-hc-smoke.test.sh`, and `bash tests/fm-backend-hc-liveness-live-e2e.test.sh`. Require the documented completion markers and inspect skipped-harness output; exit zero alone is insufficient.
- [ ] Run I02–I04 in the disposable default-session app setup, using existing FirstMate commands, one real harness and a sentinel. Record the artifact, steering result, visual identity and teardown evidence.
- [ ] Run I05–I10 in their appropriate private/default environments. Record one row per test/harness/version with result and evidence path; do not mark planned probes as completed.
- [ ] If a probe fails, add a focused regression test in FirstMate before modifying its adapter. Preserve existing selection/ownership safeguards and rerun affected upstream tests.
- [ ] Commit the qualification report independently of panel code. A failed milestone leaves the hc integration explicitly experimental.

## 8. Source references

Reviewed October 30, 2026. Source pins are review baselines, not a claim that later releases are compatible. The changelog links follow upstream; qualification must record immutable revisions and binary checksums.

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
