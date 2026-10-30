# Working in this repository

This repo holds a Herdr app mod (`mods/firstmate-fleet`) that renders FirstMate's Bearings model, plus its specification. Read [the spec](docs/2026-10-30-firstmate-herdr-technical-spec.md) before changing behaviour.

## Boundaries

- **Observational only.** The panel's one command is the Bearings collector built by `collectorArgv` in `host.js`. Do not add calls to `fm-send`, `fm-spawn`, `fm-teardown`, `fm-watch`, `fm-captain-hold`, `fm-bearings-board`, `fm-secondmate-reconcile`, `hc kill`, `--include-prs`, `--fields actions`, or any app command that closes panes or stops terminals.
- **No classification in the mod.** Bearings owns which rows are captain calls, gates, landed or underway. `decode.js` validates and reshapes; it must not filter, re-sort, merge or infer state. Do not read `.meta`, backlog Markdown, status logs or terminal output.
- **Task text is data.** Never build commands, URLs to open or markup from row content.
- **Unknown stays unknown.** `null`, `"unknown"` and `"not_checked"` are shown as such, never as false or zero. Never show an "all clear".
- **Never publish another home's data.** Keep the home label and status-path checks in `decode.js`, and the override scrub in `host.js`.

## Code layout

- Only `main.js` imports `herdr`, `gpui-kit` or `gpui-base`. Everything else is pure and tested under Node.
- Herdr runs mods on QuickJS. Keep to plain ES2020: no Node APIs, no `setTimeout`, no top-level `await`, no DOM.
- In `main.js`, never keep a `cx` for later; use the one each callback receives. Redraw only when something shown changed.

## Tests

- `npm test` must pass. Write the failing test first for new behaviour.
- `herdr-app check ~/.config/herdr-app/mods/firstmate-fleet` must pass on a real host before the mod is called done. The stubbed smoke test (`tests/main-smoke.test.mjs`) catches JavaScript errors, not GPUI API mistakes.
- Fixtures in `tests/fixtures` are source-derived until Task 0 replaces them with sanitized captured output. Never put credentials, private report text or real task names in fixtures.

## Out of bounds

- Do not modify the Pi Durable experiment (`AndrewGoldfinch/firstmate`, `experiment/pi-durable-supervision`) or its state.
- hc backend qualification lives in its own spec and belongs in a FirstMate checkout, not in this mod.
