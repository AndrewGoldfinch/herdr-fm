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
| Native APIs used by `main.js` | names and arity checked statically against 0.1.10, 0.1.11 and 0.1.12 (below) | — | `herdr-app check` pending on every pair |
| Polling, slow snapshots, disconnects, hot reloads (P20–P23) | 0.1.11 and 0.1.16 fixes read (below) | — | pending on every pair |
| App termination, core saves, read side effects, watch semantics (P24–P27) | 0.1.12 and 0.1.17 fixes read (below) | — | pending on every pair |
| Watch paths from a symlinked home | canonicalization found in `src/files.rs` on all three app versions; fixed in the controller with tests | — | pending (P27) |
| First-dock and uninstall behaviour | `mod.json` docking rule read | — | pending |
| Fork contains `355a307` | not checked | — | pending |

## Pins

| Component | Revision |
| --- | --- |
| FirstMate | `355a30710d6e545fe57f720896ed440ee5d99a9a` |
| Herdr app | `8180cbe6c947519e8015dd7c35801a93e08a7d66` (mod API identical to `v0.1.10`) |
| Herdr app | `e12fd31866f33cb613922d0b33ea506e6f23ce3c` (`v0.1.11`; same mod surface, plain QuickJS interpreter) |
| Herdr core | `d02842335e33e4d70324e1122baeed8701f49e9b` (`0.1.15`) |
| Herdr core | `e07c2a1bedd62cf4787ee026ee23ee79c7d95491` (`0.1.16`; core–holder reconnect, `shell = [...]`) |
| Herdr app | `4aa3460749947e7771aa39a8a2cec58d46649926` (`v0.1.12`; same mod surface; Linux watches skip git-ignored directories) |
| Herdr core | `ce87721557176f6cddaac1c7aefbf76929923263` (`0.1.17`; saves outside the state lock, prompt reads, macOS launchd core) |

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

`tests/gpui-api.test.mjs` checks every method name `main.js` calls, whether it passes arguments, its `herdr`, `gpui-kit` and `gpui-base` imports, and its `theme()` colours against `tests/fixtures/gpui-surface.json` (app 0.1.10 API), `tests/fixtures/gpui-surface-0.1.11.json` (`v0.1.11`) and `tests/fixtures/gpui-surface-0.1.12.json` (`v0.1.12`). `scripts/extract-gpui-surface.mjs` extracted all three. They are identical for everything `main.js` uses; shipped mods add the method names `hint` (0.1.11) and `keyboard`, `rebuilt`, `reconnect`, `shared` (0.1.12). Result on all three: no problems. Evidence per name:

| Evidence | Names in `main.js` |
| --- | --- |
| Hand-bound param styles (`style.rs`) | `bg border_b border_color border_t gap h mb min_h min_w mx my pb px py rounded text_color text_size` |
| Engine behaviours | `id on_click on_key_down overflow_y_scrollbar tooltip value` |
| Engine prelude methods | `child children hover track_focus when` |
| GPUI `Styled` fns | `flex_1 flex_none flex_wrap items_center truncate` |
| Shipped mods only (exercised by herdr-app's render tests) | `border_1 cursor_pointer font_medium font_semibold h_full size_full`, and `InputState`/`Input` `new` and `on` |

It proves names and argument presence, not argument types, which element a method applies to, or layout. `herdr-app check` is still required.

`selectable` exists only on `TextView` (Markdown/HTML). Making artifact references selectable that way means escaping task text so it renders literally and no link becomes clickable; deferred.

## Herdr 0.1.11 and core 0.1.16 (source)

- App 0.1.11 (`9af0ecc`) runs mods on the plain QuickJS interpreter instead of the JIT. The engine comment says the JIT's upkeep ran on the main thread and grew with every loaded mod copy, because module generations are never freed. Expect memory to grow with hot reloads on both versions (P23) and CPU stalls only on 0.1.10. Re-measure P14 decode time in the app, not only in Node.
- Core 0.1.16 (`a5ed044`, `cfbb01d`, `7487a93`, `b52679c`, issue #47) reconnects to its holder instead of freezing terminals. The collector's `hc read` and `hc get` calls for hc tasks run inside each collection, so P22 breaks that link mid-collection.
- Core 0.1.16 adds `shell = [...]` for new terminals and keep recovery. That affects the hc adapter's typed launch line (hc spec I13), not the panel, whose collector runs through `env` and `bash` explicitly.

## Herdr 0.1.12 and core 0.1.17 (source)

- **Reads (#60, `277f6a6`).** Core 0.1.17 answers a read of a full-screen agent at a prompt at once and never scrolls the prompt. On 0.1.15 and 0.1.16 that read took about 25 seconds, so crew-state's 10-second bound would report such hc tasks as `unknown` and slow each collection. The synthetic P17 numbers above used tmux stand-ins and do not show this; measure P17 with hc workers on each pair.
- **Linux folder watches (`b66d1db`).** App 0.1.12 skips git-ignored directories, rejects trees over 4,096 non-ignored directories, and reports the watch root when pending paths overflow. FirstMate's `.gitignore` lists `state/`, `data/`, `config/` and `projects/`. The panel watches `state/` and `data/` as roots, so their direct files should still report; confirm in P27.
- **Watch paths are canonical** in `next_change` on every app version reviewed. A home reached through a symlink used to lose every change event to the panel's prefix filter; `notifyChange` now takes the watched folder and judges canonical paths by their own segments (`tests/controller.test.mjs`).
- **App termination.** Core 0.1.17 starts through launchd on macOS so quitting the app no longer stops agents; agents started earlier pick it up on their next start. The panel's own behaviour on quit is `close(cx)` with a 250 ms budget; an `exec` already started keeps running.
- **Saves.** Core 0.1.17 persists registry snapshots outside the state lock instead of freezing every terminal.

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
