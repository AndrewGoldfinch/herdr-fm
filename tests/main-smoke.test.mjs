// Loads main.js against stubbed gpui-kit, gpui-base and herdr modules and drives it
// through its states. This catches JavaScript errors on every render path. It does not
// prove the GPUI calls exist; that is `herdr-app check` on a real host (Task 3).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { walk, text } from "./stubs/element.mjs";
import { fixtureText, configText, HOME } from "./helpers.mjs";

let Panel;
before(async () => {
  register("./stubs/loader.mjs", import.meta.url);
  ({ default: Panel } = await import("../mods/firstmate-fleet/main.js"));
});

const flush = () => new Promise((r) => setImmediate(r));

function harness({ config = configText(), result = { code: 0, stdout: fixtureText("normal"), stderr: "" } } = {}) {
  const calls = { exec: [], read: [], watch: [] };
  globalThis.__herdr = {
    exec: async (...args) => {
      calls.exec.push(args);
      return typeof result === "function" ? result() : result;
    },
    readTextFile: async (path) => {
      calls.read.push(path);
      return config;
    },
    watchFolder: (dir) => {
      calls.watch.push(dir);
      return new Promise(() => {});
    },
  };
  const tasks = [];
  const timers = [];
  let notified = 0;
  const cx = {
    notify: () => notified++,
    spawn: (fn) => tasks.push(fn(cx)),
    timer: { every: (ms, fn) => timers.push({ ms, fn }) },
    focus_handle: () => ({}),
    stop_propagation: () => {},
  };
  const panel = new Panel();
  panel.init({}, cx);
  return { panel, cx, calls, timers, tasks, notified: () => notified };
}

async function settled(h) {
  for (let i = 0; i < 5; i++) await flush();
}

const find = (root, id) => {
  let hit = null;
  walk(root, (n) => {
    if (n._id === id) hit = n;
  });
  return hit;
};

test("init reads the hidden config, runs the collector once and sets a 5-second timer", async () => {
  const h = harness();
  await settled(h);
  assert.deepEqual(h.calls.read, ["/tmp/herdr-app/mods/firstmate-fleet/.config.json"]);
  assert.equal(h.calls.exec.length, 1);
  assert.equal(h.calls.exec[0][0], "env");
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 5000);
  assert.deepEqual(h.calls.watch.sort(), [`${HOME}/data`, `${HOME}/state`]);
});

test("renders every tab and the details pane without throwing", async () => {
  const h = harness();
  await settled(h);
  let root = h.panel.render();
  const all = text(root).join("\n");
  assert.match(all, /Captain's Call 1/);
  assert.match(all, /Choose session store/);
  for (const section of ["underway", "landed", "charted_next", "secondmates", "unhealthy", "captain_call"]) {
    find(root, `tab-${section}`)._handlers.on_click({}, h.cx);
    root = h.panel.render();
  }
  find(root, "tab-underway")._handlers.on_click({}, h.cx);
  root = h.panel.render();
  const firstRow = [];
  walk(root, (n) => {
    if (typeof n._id === "string" && n._id.startsWith("row-")) firstRow.push(n);
  });
  assert.equal(firstRow.length, 3);
  firstRow[0]._handlers.on_click({}, h.cx);
  root = h.panel.render();
  const details = text(root).join("\n");
  assert.match(details, /https:\/\/github\.com\/acme\/webapp\/pull\/42/);
  assert.match(details, /Identity is by id only/);
  find(root, "details-back")._handlers.on_click({}, h.cx);
  root = h.panel.render();
  assert.equal(find(root, "details-back"), null);
});

test("keyboard: down, enter and escape move, open and close details", async () => {
  const h = harness();
  await settled(h);
  let root = h.panel.render();
  find(root, "tab-underway")._handlers.on_click({}, h.cx);
  root = h.panel.render();
  const key = (k, modifiers = {}) => {
    root._handlers.on_key_down({ key: k, modifiers }, h.cx);
    root = h.panel.render();
  };
  key("down");
  key("enter");
  assert.match(text(root).join("\n"), /scout-cache/);
  assert.ok(find(root, "details-back"));
  key("escape");
  assert.equal(find(root, "details-back"), null);
  key("right", { alt: true });
  assert.equal(h.panel.ui.section, "landed");
});

test("setup, failure and away states render their banners", async () => {
  const setup = harness({ config: null });
  await settled(setup);
  assert.match(text(setup.panel.render()).join("\n"), /Configure a FirstMate checkout and home\./);
  assert.equal(setup.calls.exec.length, 0, "no command without a valid config");

  const failed = harness({ result: { code: 1, stdout: "", stderr: "boom" } });
  await settled(failed);
  assert.match(text(failed.panel.render()).join("\n"), /FirstMate fleet unavailable\./);

  const away = harness({ result: { code: 3, stdout: "", stderr: "fm-afk-return: away mode is still active\n" } });
  await settled(away);
  assert.match(text(away.panel.render()).join("\n"), /away mode/);
});

test("refresh while busy does not start a second collection", async () => {
  let release;
  const h = harness({ result: () => new Promise((r) => (release = r)) });
  await settled(h);
  const root = h.panel.render();
  assert.match(text(root).join("\n"), /Refreshing…/);
  find(root, "refresh")._handlers.on_click({}, h.cx);
  find(root, "refresh")._handlers.on_click({}, h.cx);
  await settled(h);
  assert.equal(h.calls.exec.length, 1);
  release({ code: 0, stdout: fixtureText("normal"), stderr: "" });
  await settled(h);
  assert.doesNotMatch(text(h.panel.render()).join("\n"), /Refreshing…/);
});

test("close disposes: later ticks start nothing", async () => {
  const h = harness();
  await settled(h);
  await h.panel.close(h.cx);
  for (let i = 0; i < 3; i++) h.timers[0].fn(h.cx);
  await settled(h);
  assert.equal(h.calls.exec.length, 1);
});

test("hostile task text is rendered as plain strings", async () => {
  const h = harness({ result: { code: 0, stdout: fixtureText("hostile"), stderr: "" } });
  await settled(h);
  let root = h.panel.render();
  find(root, "tab-underway")._handlers.on_click({}, h.cx);
  root = h.panel.render();
  assert.ok(text(root).includes("$(rm -rf ~) `reboot` '; kill -9 1; '"));
  assert.equal(h.calls.exec.length, 1);
});
