# FirstMate fleet panel for Herdr

A Herdr app mod that shows FirstMate's Bearings picture (Captain's Call, Underway, Recently Landed, Charted Next, secondmates and endpoint warnings) as a native panel docked on the right of the window. It is read-only: it never sends, steers, answers, merges or stops anything.

**Status:** prototype. The pure modules are covered by `node --test`. `herdr-app check` has passed once, on the Windows build of app 0.1.16 with no `.config.json`; the check on the other pairs, on a Linux host and with a config, and the live checks in [Task 3](docs/2026-10-30-firstmate-herdr-technical-spec.md#task-3--integrate-the-native-fleet-view) are pending. The decoder is tested against real output from FirstMate's collector on synthetic homes (`tests/fixtures/captured/`, made with `bash scripts/capture-fixtures.sh <firstmate-checkout>`), but not yet against a live home. See [docs/qualification.md](docs/qualification.md).

## Requirements

- Herdr app 0.1.10 with herdr-core 0.1.15, app 0.1.11 with core 0.1.16, app 0.1.12 with core 0.1.17, or app 0.1.16 with core 0.1.21, on the same Linux host as FirstMate, or a Windows app with FirstMate in WSL through the `machine` setting (untested; see [below](#windows-app-with-firstmate-in-wsl)). All four pairs are qualification targets; prefer the newest pair that passes, since later releases fix mod-related window freezes, terminal freezes on core–holder disconnects and during saves, and 25-second prompt reads.
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

On app 0.1.16 and later the check should not start a collection (the panel returns early while `checking()` is true; P28 has not confirmed it live yet). On earlier apps it runs FirstMate's collector once, SSH reads included, so run the check before writing `.config.json` if that matters.

The check writes `gpui-kit.d.ts` and `jsconfig.json` (editor type files) into the folder it checks. Both are git-ignored if you check `mods/firstmate-fleet` in this repo.

The first time Herdr sees the folder it docks the panel on the right at 420 px; after that your layout owns where it sits. The settings file is hidden (`.config.json`) so saving it does not hot-reload the mod and reinstalling does not overwrite it. The panel re-reads it before each collection.

| Setting | Default | Meaning |
| --- | --- | --- |
| `firstmateRoot` | (required) | Absolute path of the FirstMate checkout whose collector runs |
| `firstmateHome` | (required) | Absolute path of the FirstMate home to show |
| `minIntervalMs` | 30000 | Earliest a file change can trigger another collection |
| `fallbackMs` | 120000 | Collect at least this often when nothing changes |
| `staleAfterMs` | 360000 | Mark the snapshot stale after this long; at least 3 × `fallbackMs` |
| `forgeReads` | false | Let FirstMate check GitHub for PR state of passed runs |
| `machine` | null | Herdr machine (`hc machine ls`) that runs the collector; null runs it on this computer. The two paths are paths on that machine |

### Windows app with FirstMate in WSL

The panel can't run the collector on Windows itself: it needs `env`, Bash and jq. It can run it in WSL, with WSL added to Herdr as a machine. This needs herdr-core 0.1.20 or later on Windows (`hc --version`) and has not been tested end to end yet (P29 in the spec).

1. In PowerShell 7 (`pwsh`; Windows PowerShell 5.1 mangles the quotes), add your distro as a machine. `wsl -l -q` lists distro names.

   ```powershell
   hc machine add --via 'wsl.exe -d Ubuntu -e sh -c' --name wsl
   ```

   If WSL has no herdr-core or an old one, `hc` offers to copy it there.
2. Check that the collector's tools are on the path there. This should print three paths and no `missing:` line:

   ```powershell
   hc exec --on wsl sh -c 'for t in env bash jq; do command -v "$t" || echo "missing: $t"; done'
   ```

   One name per `command -v`: WSL's `sh` is usually dash, which answers only the first of several.

   This runs with the same environment the collector gets, which isn't your login shell's. Tools that only `~/.bashrc` or `~/.profile` put on the path won't be found; the same goes for anything FirstMate's backends call, such as `tmux` or `hc`.

3. In `%USERPROFILE%\.config\herdr-app\mods\firstmate-fleet\.config.json`, use WSL paths and name the machine:

   ```json
   {
     "schema": "firstmate-herdr-panel.config.v2",
     "firstmateRoot": "/home/you/firstmate",
     "firstmateHome": "/home/you/firstmate",
     "machine": "wsl"
   }
   ```

Herdr can only watch folders on the computer it runs on, so the panel doesn't refresh when files change in WSL. It collects every `fallbackMs` (2 minutes by default) and when you press Refresh. Hover over the home name in the header to see this. For faster updates, lower `fallbackMs` as far as `minIntervalMs` (at least 10 seconds), keeping `staleAfterMs` at 3 × `fallbackMs` or more. Each collection still has to finish within Herdr's 30-second limit, including starting WSL if the distro is stopped.

## What it runs, and what that touches

The panel runs exactly one command, built in [`host.js`](mods/firstmate-fleet/host.js):

```sh
env -u FM_ROOT_OVERRIDE -u FM_STATE_OVERRIDE … FM_HOME=<home> [FM_CREW_STATE_NO_FORGE=1] \
  bash <root>/bin/fm-bearings-snapshot.sh --json --fields paths,endpoints
```

It runs once at start, after changes under `<home>/data` and `<home>/state` (2 s debounce, no sooner than `minIntervalMs`), every `fallbackMs` otherwise, and when you press Refresh. Hidden panels keep collecting. With `machine` set, the same command runs on that machine and there are no change-driven runs.

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
