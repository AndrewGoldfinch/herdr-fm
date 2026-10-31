# Fixtures

## Captured (`captured/`)

Real `fm-bearings.v1` output from FirstMate's own collector, written by `bash scripts/capture-fixtures.sh <firstmate-checkout>` against synthetic homes with network tools stubbed out. `captured/manifest.json` records the FirstMate revision, exit codes, timings, byte counts and network attempts (all zero). Lab paths are rewritten so the home reads `/home/captain/firstmate`; the clock is pinned to `2026-10-30T12:00:00Z`, so a recapture at the same revision is identical. `tests/captured.test.mjs` decodes them.

| File | Scenario |
| --- | --- |
| `empty.json` | Empty home |
| `normal.json` | Two live tasks and one whose terminal is gone, a queued gate, a landed PR, a scout report |
| `holds.json` | Live, blocked, dated and aged captain holds, and a task whose status line asks for a decision without a hold |
| `manifest.json` | Also records the away run (exit 3) and 25/50-task timings |

The synthetic tasks have no running harness, so every `state` reads `unknown`. Secondmates, truncation and malformed output cannot be produced this way yet; the hand-written fixtures below still cover them.

## Hand-written (this folder)

These fixtures are **source-derived, not captured**. They were written by hand from the `fm-bearings.v1` model that `bin/fm-bearings-snapshot.sh` builds at FirstMate `355a30710d6e545fe57f720896ed440ee5d99a9a` (the jq object assembled near the end of that script), because the producer could not be run when they were made.

The captured output confirmed their field sets exactly. Values differ only in wording (for example the `prs` note and gate reasons) and in `state`, which is `unknown` without a harness. They stay for the scenarios the capture cannot produce.

All fixtures use the configured home `/home/captain/firstmate`, whose Bearings label is `captain/firstmate`.

| File | Scenario |
| --- | --- |
| `normal.json` | Rows in every section, a secondmate child, endpoints, paths, reports and PRs (P02, P07) |
| `empty.json` | Valid model with no rows (P01) |
| `holds.json` | Live holds, blocked/dated/aged gates, synthetic warning gates, a parked task whose status line asks for a decision (P03) |
| `cached-secondmate.json` | Cached and unreadable secondmate summaries (P04) |
| `partial.json` | Bounds, truncation, malformed rows and disclosures, unhealthy endpoints (P10) |
| `hostile.json` | Shell syntax, command-like strings, Unicode and regex characters (P11) |
| `duplicate.json` | Duplicate ids and a `<mate>/<id>` beside the same `<id>` (P08) |
| `old-schema.json` | A canonical `fm-fleet-snapshot.v1` document passed by mistake (P06) |
| `redirected-state.json` | Correct label but status paths under another home, as an inherited `FM_STATE_OVERRIDE` would produce (P19) |
