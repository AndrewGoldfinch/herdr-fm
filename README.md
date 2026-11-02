# FirstMate fleet panel for Herdr

A Herdr app mod that shows FirstMate's Bearings picture (Captain's Call, Underway, Recently Landed, Charted Next, secondmates and endpoint warnings) as a native panel docked on the right of the window. It is read-only: it never sends, steers, answers, merges or stops anything.

**Status:** prototype. The pure modules are covered by `node --test`. The mod has **not** yet been loaded by a real Herdr app (`herdr-app check` and the live checks in [Task 3](docs/2026-10-30-firstmate-herdr-technical-spec.md#task-3--integrate-the-native-fleet-view) are pending). The decoder is tested against real output from FirstMate's collector on synthetic homes (`tests/fixtures/captured/`, made with `bash scripts/capture-fixtures.sh <firstmate-checkout>`), but not yet against a live home. See [docs/qualification.md](docs/qualification.md).

## Requirements

- Herdr app 0.1.10 with herdr-core 0.1.15, app 0.1.11 with core 0.1.16, or app 0.1.12 with core 0.1.17, on the same Linux host as FirstMate. All three pairs are qualification targets; prefer the newest pair that passes, since later releases fix mod-related window freezes, terminal freezes on core–holder disconnects and during saves, and 25-second prompt reads.
- A FirstMate checkout that ships `bin/fm-bearings-snapshot.sh` with `--json` and `--fields` (upstream `355a307` or later), plus `env`, Bash and jq.

## Install

```sh
mkdir -p ~/.config/herdr-app/mods/firstmate-fleet
rsync -a --exclude .config.json mods/firstmate-fleet/ ~/.config/herdr-app/mods/firstmate-fleet/
cd ~/.config/herdr-app/mods/firstmate-fleet
[ -e .config.json ] || cp config.example.json .config.json
"${EDITOR:-vi}" .config.json        # set firstmateRoot and firstmateHome
herdr-app check ~/.config/herdr-app/mods/firstmate-fleet
```

The first time Herdr sees the folder it docks the panel on the right at 420 px; after that your layout owns where it sits. The settings file is hidden (`.config.json`) so saving it does not hot-reload the mod and reinstalling does not overwrite it. The panel re-reads it before each collection.

| Setting | Default | Meaning |
| --- | --- | --- |
| `firstmateRoot` | (required) | Absolute path of the FirstMate checkout whose collector runs |
| `firstmateHome` | (required) | Absolute path of the FirstMate home to show |
| `minIntervalMs` | 30000 | Earliest a file change can trigger another collection |
| `fallbackMs` | 120000 | Collect at least this often when nothing changes |
| `staleAfterMs` | 360000 | Mark the snapshot stale after this long; at least 3 × `fallbackMs` |
| `forgeReads` | false | Let FirstMate check GitHub for PR state of passed runs |

## What it runs, and what that touches

The panel runs exactly one command, built in [`host.js`](mods/firstmate-fleet/host.js):

```sh
env -u FM_ROOT_OVERRIDE -u FM_STATE_OVERRIDE … FM_HOME=<home> [FM_CREW_STATE_NO_FORGE=1] \
  bash <root>/bin/fm-bearings-snapshot.sh --json --fields paths,endpoints
```

It runs once at start, after changes under `<home>/data` and `<home>/state` (2 s debounce, no sooner than `minIntervalMs`), every `fallbackMs` otherwise, and when you press Refresh. Hidden panels keep collecting.

The mod itself makes no network calls. **FirstMate's collector does:**

- an **SSH session to every registered remote secondmate home** on every collection, to fetch its summary (worst case at defaults: 120 per remote home per hour);
- a **GitHub PR read** for passed runs without a local merge receipt, only when `forgeReads` is true;
- a read of each task's terminal through its backend (for example `hc read`).

FirstMate may refresh cached summaries under `<home>/state/secondmate-summary-cache`. The panel writes nothing outside its own folder and keeps diagnostics in memory.

## Uninstall

Remove `~/.config/herdr-app/mods/firstmate-fleet`. FirstMate tasks and state are untouched. What Herdr does with a layout block that still names the removed mod is a pending Task 0 check; until then, if a blank block remains, use `layout.reset` on a shipped layout.

## Development

```sh
npm test            # node --test tests/*.test.mjs
```

| Path | Role |
| --- | --- |
| `mods/firstmate-fleet/main.js` | The Herdr `View`: timer, watch loops, `close()`, GPUI elements. The only file that imports `herdr` or `gpui-*` |
| `mods/firstmate-fleet/controller.js` | Refresh state machine (no timers of its own) |
| `mods/firstmate-fleet/decode.js` | `fm-bearings.v1` → panel model; validates, never reclassifies |
| `mods/firstmate-fleet/project.js` | Search, pages, counts, selection |
| `mods/firstmate-fleet/view-model.js` | Banners, tabs, rows and details as plain data |
| `mods/firstmate-fleet/host.js` | The collector argv and the injected Herdr calls |
| `mods/firstmate-fleet/config.js` | `.config.json` validation |
| `tests/` | Unit tests, a stubbed smoke test of `main.js`, and fixtures |

Design: [technical specification](docs/2026-10-30-firstmate-herdr-technical-spec.md). The separate [hc backend qualification](docs/2026-10-30-firstmate-hc-qualification-spec.md) is not a dependency of this mod.
