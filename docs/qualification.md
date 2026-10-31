# Qualification record (Task 0)

**Status: partial.** Items marked *source* were established by reading upstream code at the pinned revisions. Items marked *synthetic* ran FirstMate's real collector at `355a307` against throwaway homes with `scripts/capture-fixtures.sh` (no live harnesses, fake tmux, network tools stubbed). Nothing has run against a live FirstMate home or a Herdr app.

| Item | Source | Synthetic | Live |
| --- | --- | --- | --- |
| Checkout ships `fm-bearings-snapshot.sh --json --fields paths,endpoints` returning `fm-bearings.v1` | done | confirmed | pending |
| Collector honors `FM_HOME`; `home` is the last two path segments | done | confirmed | pending |
| `paths[].status` is `$STATE/<id>.status` | done | confirmed | pending |
| Override scrub list | done (below) | — | re-derive per checkout |
| Fixtures | hand-written | `tests/fixtures/captured/` decodes with no issues | capture from a real home |
| Not-requested `omitted[]` pairs | read | confirmed, exactly four | — |
| Away window exits 3 with `fm-afk-return:` | read | confirmed | pending |
| Collection latency (P17) | bounds read (below) | 25 tasks 4.2 s, 50 tasks 7.5 s | pending with real endpoints |
| Network attempts with `forgeReads: false`, no secondmates | — | 0 in every run | pending with remote homes |
| Collector write set under `data/` and `state/` | cache dir only, by source | not measured | pending |
| Native APIs used by `main.js` | names and arity checked statically (below) | `herdr-app check` pending |
| First-dock and uninstall behaviour | `mod.json` docking rule read | pending |
| Fork contains `355a307` | not checked | pending |

## Pins

| Component | Revision |
| --- | --- |
| FirstMate | `355a30710d6e545fe57f720896ed440ee5d99a9a` |
| Herdr app | `8180cbe6c947519e8015dd7c35801a93e08a7d66` (mod API identical to `v0.1.10`) |
| Herdr core | `d02842335e33e4d70324e1122baeed8701f49e9b` (`0.1.15`) |

## Producer field mapping (source)

From the jq object at the end of `bin/fm-bearings-snapshot.sh`. Example values are illustrative, not captured.

| Field | Shape | Panel use |
| --- | --- | --- |
| `schema` | `"fm-bearings.v1"` | exact match |
| `home` | `"captain/firstmate"` (last two segments of `fm_home`) | label check |
| `generated` | `"2026-10-30T12:00:00Z"` (`FM_BEARINGS_NOW` or `date -u`) | freshness |
| `prs` | string note | header |
| `in_flight[]` | `{id, kind, state, repo, name, doing}`; children as `"<mate>/<id>"` | Underway |
| `decisions_open[]` | `{id, key, verb: "captain-hold", summary, owner}`; live holds only | Captain's Call |
| `landed[]` | `{id, what, artifact ("-" if none), owner}` | Recently Landed |
| `gates[]` | `{id, title, blocked_by ("-"), reason, owner, filed}`; `(return-catchup)`, `(main-inventory)` synthetic | Charted Next |
| `secondmates[]` | `{id, state, doing, provenance, freshness, age_seconds, contradiction, reason}` | Secondmates |
| `secondmate_reconcile[]` | `{id, spawn_gen, host, kind, ids}` | required, not rendered |
| `reports[]`, `recorded_prs[]` | `{id, path}`, `{id, url}` | artifacts |
| `unhealthy_endpoints[]` | `{id, backend, target, exists, agent}`; present only when non-empty | Endpoint warnings |
| `paths[]` (`--fields paths`) | `{id, worktree, home, status, report}`, `"-"` when absent | details, home check |
| `endpoints[]` (`--fields endpoints`) | `{id, backend, target, exists, agent}` | details |
| `omitted[]` | `{surface, reveal}` | disclosures |
| `contributions` | object | required, not rendered |

Always-present "not requested" pairs at this revision: “backlog item bodies” / `--fields bodies`, “watch/steer actions” / `--fields actions`, “full scout-report inventory” / `--all-reports`, “live PR discovery + checks” / `--include-prs`.

## Override scrub list (source)

Variables read by `fm-bearings-snapshot.sh`, `fm-fleet-snapshot.sh`, `fm-crew-state.sh`, `fm-afk-return.sh` and `fm-backend.sh` that redirect paths, cache writes or the clock:

`FM_ROOT_OVERRIDE`, `FM_STATE_OVERRIDE`, `FM_DATA_OVERRIDE`, `FM_CONFIG_OVERRIDE`, `FM_PROJECTS_OVERRIDE`, `FM_SNAPSHOT_CACHE_DIR`, `FM_SNAPSHOT_NOW`, `FM_SNAPSHOT_NOW_EPOCH`, `FM_BEARINGS_NOW`, `FM_CREW_STATE_META_OVERRIDE`, `FM_CREW_STATE_STATUS_OVERRIDE`.

Re-derive on the selected checkout with:

```sh
grep -ohE '\$\{?FM_[A-Z_]*(OVERRIDE|_NOW[A-Z_]*|CACHE_DIR)\b' \
  bin/fm-bearings-snapshot.sh bin/fm-fleet-snapshot.sh bin/fm-crew-state.sh \
  bin/fm-afk-return.sh bin/fm-backend.sh | tr -d '${' | sort -u
```

## Collector costs (source)

- Per task: `fm-crew-state.sh`, 8 concurrent, 10 s bound each (`FM_SNAPSHOT_CREW_STATE_TIMEOUT`, `FM_SNAPSHOT_LOCAL_READ_CONCURRENCY`).
- Passed runs without a merge receipt: 5 s GitHub PR read unless `FM_CREW_STATE_NO_FORGE=1`.
- Remote secondmate homes (default 20): `fm-on.sh <id> fm-remote-file.sh get state/home-summary.json`, shared 5 s budget (`FM_SNAPSHOT_BUDGET`), cached copy on failure.
- Away guard: `fm-afk-return.sh guard`; exit 3 with an `fm-afk-return:` message during an active away window, before any snapshot work.
- Temp files go to `$TMPDIR`; the only write under the home is `state/secondmate-summary-cache/`.

## Static API check (source)

`tests/gpui-api.test.mjs` checks every method name `main.js` calls, whether it passes arguments, its `herdr`, `gpui-kit` and `gpui-base` imports, and its `theme()` colours against `tests/fixtures/gpui-surface.json`. `scripts/extract-gpui-surface.mjs` extracted that surface from herdr-app at the pinned revision; the sources it reads are identical at herdr-app `e3cdccc`. Result: no problems. Evidence per name:

| Evidence | Names in `main.js` |
| --- | --- |
| Hand-bound param styles (`style.rs`) | `bg border_b border_color border_t gap h mb min_h min_w mx my pb px py rounded text_color text_size` |
| Engine behaviours | `id on_click on_key_down overflow_y_scrollbar tooltip value` |
| Engine prelude methods | `child children hover track_focus when` |
| GPUI `Styled` fns | `flex_1 flex_none flex_wrap items_center truncate` |
| Shipped mods only (exercised by herdr-app's render tests) | `border_1 cursor_pointer font_medium font_semibold h_full size_full`, and `InputState`/`Input` `new` and `on` |

It proves names and argument presence, not argument types, which element a method applies to, or layout. `herdr-app check` is still required.

`selectable` exists only on `TextView` (Markdown/HTML). Making artifact references selectable that way means escaping task text so it renders literally and no link becomes clickable; deferred.

## Native APIs to verify on the host

`main.js` uses these as the shipped mods do; `herdr-app check` and a live session must confirm them:

- `InputState.new({placeholder})`, `.on("change")`, `.value()`, `Input.new(state)`.
- `cx.focus_handle()`, `.track_focus()`, `.on_key_down(e)` with `e.key` values `up`, `down`, `enter`, `escape`, `pageup`, `pagedown`, `left`, `right` and `e.modifiers.alt`.
- `.tooltip(text)`, `.flex_wrap()`, `.overflow_y_scrollbar()`, `.border_b(1)`, `.min_w(0)`, `.truncate()`.
- `cx.timer.every`, `cx.spawn`, `watchFolder`, `async close(cx)`, `appHome()`.
- `globalThis.performance.now` in QuickJS/LLRT (the controller falls back to `Date.now` with backward-jump clamping if absent).
- Selectable text for artifact references: not implemented yet; details show plain text.

## Synthetic capture results

`scripts/capture-fixtures.sh` at FirstMate `355a307`, recorded in `tests/fixtures/captured/manifest.json`:

| Scenario | Exit | Time | Bytes | Network attempts |
| --- | --- | --- | --- | --- |
| empty | 0 | 0.67 s | 1,165 | 0 |
| normal | 0 | 0.77 s | 4,054 | 0 |
| holds | 0 | 0.51 s | 2,772 | 0 |
| away | 3 | 0.03 s | 0 | 0 |
| 25 tasks | 0 | 4.2 s | 17,664 | 0 |
| 50 tasks | 0 | 7.5 s | 30,014 | 0 |

Time grows by roughly 130–150 ms per task here, which would reach Herdr's 30-second limit near 200 tasks. That is a lower bound: these tasks have a fake tmux and no harness, so no endpoint read is slow and none hits the 10-second crew-state bound. P17 still needs real endpoints.

Field sets in the captured output match the hand-written fixtures exactly. Captain's Call held only the live hold; blocked, dated and aged holds were Charted Next gates; a task whose status line asked for a decision without a captain hold stayed in Underway with state `unknown`.

## Next steps

1. On the qualified host, capture from a real disposable home with live harnesses and a registered secondmate; measure P17 with real endpoints and count SSH reads.
2. Record the collector's write set under `data/` and `state/`.
3. Install the mod, run `herdr-app check`, record first-dock and uninstall behaviour, and fix any GPUI API mismatches.
