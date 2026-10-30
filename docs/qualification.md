# Qualification record (Task 0)

**Status: partial.** Everything below marked *source* was established by reading upstream code at the pinned revisions. Nothing has been run against a live FirstMate home or a Herdr app. Running FirstMate's collector was blocked by this environment's sandbox policy, and no Herdr binary was available.

| Item | Source | Live |
| --- | --- | --- |
| Checkout ships `fm-bearings-snapshot.sh --json --fields paths,endpoints` returning `fm-bearings.v1` | done | pending |
| Collector honors `FM_HOME`; `home` is the last two path segments | done | pending |
| `paths[].status` is `$STATE/<id>.status` | done | pending |
| Override scrub list | done (below) | re-derive per checkout |
| Fixtures | hand-written from source | capture and sanitize |
| Collection latency at 25 and 50 tasks (P17) | bounds read (below) | pending |
| Collector write set under `data/` and `state/` | cache dir only, by source | pending |
| SSH and forge reads per collection | read (below) | pending |
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

## Next steps

1. On the qualified host, run the collector against a disposable home, capture the fixture set listed in `tests/fixtures/README.md`, sanitize, and diff shapes against these hand-written ones.
2. Measure P17 latency and the write set; count SSH and forge reads with `forgeReads` on and off.
3. Install the mod, run `herdr-app check`, record first-dock and uninstall behaviour, and fix any GPUI API mismatches.
