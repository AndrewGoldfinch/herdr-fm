# Fixtures

These fixtures are **source-derived, not captured**. They were written by hand from the `fm-bearings.v1` model that `bin/fm-bearings-snapshot.sh` builds at FirstMate `355a30710d6e545fe57f720896ed440ee5d99a9a` (the jq object assembled near the end of that script), because the producer could not be run when they were made.

Task 0 replaces or confirms each one with sanitized output captured from `bin/fm-bearings-snapshot.sh --json --fields paths,endpoints` on the qualified host. Until then, a passing test proves the panel matches this reading of the source, not the live producer.

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
