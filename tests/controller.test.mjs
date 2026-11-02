import { test } from "node:test";
import assert from "node:assert/strict";
import { createController, formatAge, DEBOUNCE_MS, BACKOFF_MS } from "../mods/firstmate-fleet/controller.js";
import { fixture, fixtureText, configText, HOME } from "./helpers.mjs";

const GENERATED_MS = Date.parse("2026-10-30T12:00:00Z");
const flush = () => new Promise((r) => setImmediate(r));

function setup({ config = {}, monotonic = true } = {}) {
  const clock = { t: 0, wall: GENERATED_MS, monotonic, nowMs() { return this.t; }, wallTimeMs() { return this.wall; } };
  const host = {
    configText: configText(config),
    calls: [],
    pending: [],
    async readConfig() { return this.configText; },
    collect(cfg) {
      this.calls.push(cfg);
      return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
    },
  };
  const c = createController({ host, clock });
  const advance = (ms) => { clock.t += ms; clock.wall += ms; };
  // Resolve the oldest outstanding collection and let the controller settle it.
  async function settle(result, action) {
    const p = host.pending.shift();
    assert.ok(p, "a collection should be outstanding");
    p.resolve(result);
    if (action?.pending) await action.pending;
    await flush();
  }
  return { c, clock, host, advance, settle };
}

const ok = (name = "normal") => ({ code: 0, stdout: fixtureText(name), stderr: "" });

async function started(env) {
  const a = env.c.tick();
  await flush();
  return a;
}

test("start reads config and launches one collection; success publishes the model", async () => {
  const env = setup();
  const a = await started(env);
  assert.equal(a.changed, true);
  assert.equal(env.host.calls.length, 1);
  assert.equal(env.host.calls[0].firstmateHome, HOME);
  assert.equal(env.c.getState().loading, true);
  await env.settle(ok(), a);
  const s = env.c.getState();
  assert.equal(s.loading, false);
  assert.equal(s.refreshing, false);
  assert.equal(s.error, null);
  assert.equal(s.model.rows.underway.length, 3);
  assert.equal(s.stale, false);
});

test("start() launches the initial collection", async () => {
  const env = setup();
  const a = env.c.start();
  await flush();
  assert.ok(a.pending);
  assert.equal(env.host.calls.length, 1);
  await env.settle(ok(), a);
  assert.ok(env.c.getState().model);
});

test("P09: ten simultaneous refreshes create one subprocess", async () => {
  const env = setup();
  const a = await started(env);
  const results = Array.from({ length: 10 }, () => env.c.refresh());
  await flush();
  assert.equal(env.host.calls.length, 1);
  assert.ok(results.every((r) => r.busy === true && r.pending === null));
  assert.equal(env.c.getState().refreshing, true);
  await env.settle(ok(), a);
  assert.equal(env.host.calls.length, 1);
});

test("P05: failure keeps the last model, backs off 30/60/120 s capped at fallback, and recovers", async () => {
  const env = setup({ config: { minIntervalMs: 10000, fallbackMs: 60000, staleAfterMs: 180000 } });
  await env.settle(ok(), await started(env));
  assert.deepEqual(BACKOFF_MS, [30000, 60000, 120000]);

  env.advance(60000);
  let a = await started(env);
  assert.equal(env.host.calls.length, 2, "fallback collection");
  await env.settle({ code: 1, stdout: "", stderr: "boom\n" }, a);
  let s = env.c.getState();
  assert.equal(s.error.category, "exit");
  assert.equal(s.model.rows.underway.length, 3, "last good model retained");
  assert.equal(s.failures, 1);

  const waits = [];
  for (let i = 0; i < 3; i++) {
    const from = env.clock.t;
    let waited = 0;
    for (;;) {
      env.advance(1000);
      waited += 1000;
      a = await started(env);
      if (a.pending) break;
      assert.ok(waited < 200000, "retry never came");
    }
    waits.push(env.clock.t - from);
    await env.settle({ code: 1, stdout: "", stderr: "" }, a);
  }
  assert.deepEqual(waits, [30000, 60000, 60000]);

  for (;;) {
    env.advance(1000);
    a = await started(env);
    if (a.pending) break;
  }
  await env.settle(ok(), a);
  s = env.c.getState();
  assert.equal(s.error, null);
  assert.equal(s.failures, 0);
});

test("no prior model means unavailable, not an empty fleet", async () => {
  const env = setup();
  await env.settle({ code: 2, stdout: "", stderr: "usage" }, await started(env));
  const s = env.c.getState();
  assert.equal(s.model, null);
  assert.equal(s.error.category, "exit");
  assert.equal(s.loading, false);
});

test("change trigger waits for the debounce and the minimum interval", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  assert.equal(env.c.notifyChange([`${HOME}/data/backlog.md`]), true);
  env.advance(DEBOUNCE_MS - 1);
  assert.equal((await started(env)).pending, null, "inside debounce");
  env.advance(1);
  assert.equal((await started(env)).pending, null, "inside minIntervalMs");
  env.advance(30000 - DEBOUNCE_MS);
  const a = await started(env);
  assert.ok(a.pending, "change collection after the minimum interval");
  assert.equal(env.host.calls.length, 2);
  await env.settle(ok(), a);
});

test("P09: a burst of changes during a collection yields exactly one follow-up", async () => {
  const env = setup();
  const first = await started(env);
  for (let i = 0; i < 25; i++) env.c.notifyChange([`${HOME}/state/t${i}.status`]);
  await env.settle(ok(), first);
  env.advance(29999);
  assert.equal((await started(env)).pending, null);
  env.advance(1);
  const follow = await started(env);
  assert.ok(follow.pending);
  await env.settle(ok(), follow);
  env.advance(60000);
  assert.equal((await started(env)).pending, null, "no second follow-up");
  assert.equal(env.host.calls.length, 2);
});

test("P18: the collector's own cache writes and hidden files never trigger a collection", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  assert.equal(env.c.notifyChange([`${HOME}/state/secondmate-summary-cache/mate-b.json`]), false);
  assert.equal(env.c.notifyChange([`${HOME}/state/secondmate-summary-cache/.summary.AbC123`]), false);
  assert.equal(env.c.notifyChange([`${HOME}/state/.home-summary-refresh.lock`]), false);
  assert.equal(env.c.notifyChange([`/elsewhere/state/x.status`]), false);
  assert.equal(env.c.notifyChange([`${HOME}/state/fix-login.meta`]), true);
});

test("the away guard's hidden files still count as changes", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  for (const name of [".afk", ".afk-contract", ".afk-return-catchup"]) {
    assert.equal(env.c.notifyChange([`${HOME}/state/${name}`]), true, name);
  }
  assert.equal(env.c.notifyChange([`${HOME}/state/.afk-scratch/x`]), false, "only the guard's own files");
  assert.equal(env.c.notifyChange([`${HOME}/data/.afk`]), false, "only under state/");
});

test("watch paths under a canonicalized (symlink-resolved) home still count", async () => {
  // Herdr canonicalizes the watched root, so a home reached through a symlink reports
  // paths under its real location, not under the configured path.
  const env = setup();
  await env.settle(ok(), await started(env));
  const real = "/srv/real-firstmate";
  assert.equal(env.c.notifyChange([`${real}/state/fix-login.meta`], `${HOME}/state`), true);
  assert.equal(env.c.notifyChange([`${real}/data/backlog.md`], `${HOME}/data`), true);
  assert.equal(env.c.notifyChange([`${real}/state/.afk`], `${HOME}/state`), true, "away files count under state/");
  assert.equal(env.c.notifyChange([`${real}/data/.afk`], `${HOME}/data`), false, "but not under data/");
  assert.equal(env.c.notifyChange([`${real}/state/.home-summary-refresh.lock`], `${HOME}/state`), false);
  assert.equal(env.c.notifyChange([`${real}/state/secondmate-summary-cache/mate-b.json`], `${HOME}/state`), false);
  assert.equal(env.c.notifyChange([`${real}/state/secondmate-summary-cache/.summary.x`], `${HOME}/state`), false);
});

test("a batch naming the watch root itself means refresh everything", async () => {
  // App 0.1.12 bounds pending paths; an overflowing batch is reported as the root.
  const env = setup();
  await env.settle(ok(), await started(env));
  assert.equal(env.c.notifyChange([`${HOME}/state`], `${HOME}/state`), true);
  assert.equal(env.c.notifyChange([`/srv/real-firstmate/data`], `${HOME}/data`), true);
});

test("paths from a watch that is not this home's are ignored", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  assert.equal(env.c.notifyChange([`/home/other/state/x.meta`], `/home/other/state`), false);
  assert.equal(env.c.notifyChange([`${HOME}/state/x.meta`], `${HOME}/config`), false, "only state/ and data/ are watched");
  assert.equal(env.c.notifyChange([`/elsewhere/state/x.status`]), false, "no root and outside the home: unknown origin");
});

test("P18: thirty minutes of cache churn costs only fallback collections", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  for (let s = 0; s < 1800; s++) {
    env.advance(1000);
    env.c.notifyChange([`${HOME}/state/secondmate-summary-cache/mate-b.json`]);
    const a = env.c.tick();
    if (a.pending) {
      await flush();
      await env.settle(ok(), a);
    }
  }
  assert.equal(env.host.calls.length, 1 + 15);
});

test("thirty minutes of real changes stays within the minimum interval bound", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  for (let s = 0; s < 1800; s++) {
    env.advance(1000);
    env.c.notifyChange([`${HOME}/state/fix-login.status`]);
    const a = env.c.tick();
    if (a.pending) {
      await flush();
      await env.settle(ok(), a);
    }
  }
  assert.ok(env.host.calls.length <= 1 + 1800 / 30, `${env.host.calls.length} collections`);
  assert.ok(env.host.calls.length >= 50);
});

test("changes do not bypass backoff; an idle manual refresh does", async () => {
  const env = setup();
  await env.settle({ code: 1, stdout: "", stderr: "" }, await started(env));
  env.c.notifyChange([`${HOME}/data/backlog.md`]);
  env.advance(DEBOUNCE_MS + 5000);
  assert.equal((await started(env)).pending, null, "inside 30 s backoff");
  const m = env.c.refresh();
  await flush();
  assert.ok(m.pending, "manual bypasses backoff");
  assert.equal(env.host.calls.length, 2);
  await env.settle(ok(), m);
  const m2 = env.c.refresh();
  await flush();
  assert.ok(m2.pending, "manual bypasses minIntervalMs");
  await env.settle(ok(), m2);
});

test("P16: exit 3 from the away guard is away mode, not a failure", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  env.advance(120000);
  const a = await started(env);
  await env.settle({ code: 3, stdout: "", stderr: "fm-afk-return: away mode is still active; run bin/fm-afk-return.sh before ordinary captain work\n" }, a);
  let s = env.c.getState();
  assert.equal(s.away, true);
  assert.equal(s.error, null);
  assert.equal(s.failures, 0);
  assert.match(s.awayMessage, /away mode is still active/);
  assert.equal(s.model.rows.underway.length, 3, "last model kept as historical");

  env.advance(120000);
  const b = await started(env);
  await env.settle(ok(), b);
  s = env.c.getState();
  assert.equal(s.away, false);
});

test("exit 3 without the away guard's message is an ordinary failure", async () => {
  const env = setup();
  await env.settle({ code: 3, stdout: "", stderr: "something else\n" }, await started(env));
  const s = env.c.getState();
  assert.equal(s.away, false);
  assert.equal(s.error.category, "exit");
});

test("review focus 2: an old request returning after the home changes is discarded", async () => {
  const env = setup();
  const first = await started(env);
  const other = "/home/captain/other";
  env.host.configText = configText({ firstmateHome: other, firstmateRoot: other });
  env.c.configure({ ...env.host.calls[0], firstmateHome: other, firstmateRoot: other });
  assert.equal(env.c.getState().model, null);
  assert.equal((await started(env)).pending, null, "lock is held until the old request settles");
  assert.equal(env.host.calls.length, 1);

  await env.settle(ok(), first);
  assert.equal(env.c.getState().model, null, "home1 data is never published under home2");
  assert.equal(env.c.getState().diagnostics.at(-1).category, "superseded");

  const next = await started(env);
  assert.ok(next.pending);
  assert.equal(env.host.calls[1].firstmateHome, other);
});

test("a changed config file clears the model before sampling the new home", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  const other = "/home/captain/other";
  env.host.configText = configText({ firstmateHome: other });
  env.advance(120000);
  const a = await started(env);
  assert.equal(env.c.getState().model, null);
  assert.equal(env.host.calls[1].firstmateHome, other);
  const doc = fixture("empty");
  doc.home = "captain/other";
  await env.settle({ code: 0, stdout: JSON.stringify(doc), stderr: "" }, a);
  assert.equal(env.c.getState().model.homeLabel, "captain/other");
});

test("dispose suppresses publication and further scheduling", async () => {
  const env = setup();
  const a = await started(env);
  env.c.dispose();
  await env.settle(ok(), a);
  assert.equal(env.c.getState().model, null);
  env.advance(600000);
  assert.equal(env.c.tick().pending, null);
  assert.equal(env.c.refresh().pending, null);
  assert.equal(env.host.calls.length, 1);
});

test("invalid config launches no command and is re-read every 5 seconds", async () => {
  const env = setup();
  env.host.configText = "{ not json";
  await started(env);
  await flush();
  let s = env.c.getState();
  assert.equal(s.configError.code, "invalid-json");
  assert.equal(env.host.calls.length, 0);
  env.advance(4999);
  assert.equal((await started(env)).pending, null);
  env.host.configText = configText();
  env.advance(1);
  const a = await started(env);
  assert.ok(a.pending);
  await flush();
  assert.equal(env.host.calls.length, 1);
  await env.settle(ok(), a);
  s = env.c.getState();
  assert.equal(s.configError, null);
  assert.ok(s.model);
});

test("decode failures are failures with their own category; unsupported schema is incompatible", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  env.advance(120000);
  const a = await started(env);
  await env.settle(ok("old-schema"), a);
  const s = env.c.getState();
  assert.equal(s.error.category, "unsupported-schema");
  assert.equal(s.incompatible, true);
  assert.ok(s.model, "previous valid model retained with an incompatibility banner");
});

test("oversized output and exec rejection are failures", async () => {
  const env = setup();
  const big = "x".repeat(8 * 1024 * 1024 + 1);
  await env.settle({ code: 0, stdout: big, stderr: "" }, await started(env));
  assert.equal(env.c.getState().error.category, "oversized");
  const m = env.c.refresh();
  await flush();
  env.host.pending.shift().reject(new Error("no such folder"));
  await m.pending;
  await flush();
  assert.equal(env.c.getState().error.category, "spawn");
  assert.match(env.c.getState().error.message, /no such folder/);
});

test("P13: stale at staleAfterMs; an old model is stale on arrival", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  env.advance(359999);
  assert.equal(env.c.getState().stale, false);
  env.advance(1);
  assert.equal(env.c.getState().stale, true);

  const env2 = setup();
  env2.clock.wall = GENERATED_MS + 360000;
  await env2.settle(ok(), await started(env2));
  const s = env2.c.getState();
  assert.equal(s.stale, true);
  assert.equal(s.producerAgeMs, 360000);
  assert.equal(s.receiptAgeMs, 0);
});

test("P13: a producer timestamp more than 5 s ahead is uncertain and stale; small skew clamps", async () => {
  const env = setup();
  env.clock.wall = GENERATED_MS - 5001;
  await env.settle(ok(), await started(env));
  let s = env.c.getState();
  assert.equal(s.uncertain, true);
  assert.equal(s.stale, true);

  const env2 = setup();
  env2.clock.wall = GENERATED_MS - 4000;
  await env2.settle(ok(), await started(env2));
  s = env2.c.getState();
  assert.equal(s.uncertain, false);
  assert.equal(s.producerAgeMs, 0);
  assert.equal(s.stale, false);
});

test("P13: a backward jump on a non-monotonic clock clamps elapsed time and marks uncertainty", async () => {
  const env = setup({ monotonic: false });
  env.clock.t = 100000;
  await env.settle(ok(), await started(env));
  env.clock.t = 50000;
  const s = env.c.getState();
  assert.equal(s.receiptAgeMs, 0);
  assert.equal(s.uncertain, true);
  assert.equal(s.stale, true);
});

test("diagnostics keep 50 entries and no stdout", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  for (let i = 0; i < 60; i++) {
    const m = env.c.refresh();
    await flush();
    await env.settle(ok(), m);
  }
  const d = env.c.getState().diagnostics;
  assert.equal(d.length, 50);
  const last = d.at(-1);
  assert.equal(last.trigger, "manual");
  assert.equal(last.exitCode, 0);
  assert.ok(last.bytes > 0);
  assert.equal(last.rows, 7, "1 call + 3 underway + 2 landed + 1 gate");
  assert.equal(JSON.stringify(d).includes("Fix login"), false, "no producer content retained");
});

test("error detail is sanitized and bounded", async () => {
  const env = setup();
  const stderr = `\u001b[31mred\u001b[0m ${"y".repeat(1000)}\n`;
  await env.settle({ code: 1, stdout: "", stderr }, await started(env));
  const e = env.c.getState().error;
  assert.equal(e.detail.includes("\u001b"), false);
  assert.ok(e.detail.length <= 301);
});

test("tick reports a change only when the shown age bucket moves", async () => {
  const env = setup();
  await env.settle(ok(), await started(env));
  env.c.tick();
  env.advance(1000);
  assert.equal(env.c.tick().changed, false);
  env.advance(4000);
  assert.equal(env.c.tick().changed, true);
});

test("formatAge uses 5-second steps under a minute, then minutes, then hours", () => {
  assert.equal(formatAge(null), "—");
  assert.equal(formatAge(0), "0s");
  assert.equal(formatAge(4999), "0s");
  assert.equal(formatAge(5000), "5s");
  assert.equal(formatAge(59999), "55s");
  assert.equal(formatAge(60000), "1m");
  assert.equal(formatAge(3599999), "59m");
  assert.equal(formatAge(3600000), "1h 0m");
  assert.equal(formatAge(5400000), "1h 30m");
});
