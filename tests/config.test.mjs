import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfig, DEFAULTS, PAGE_SIZE } from "../mods/firstmate-fleet/config.js";
import { configText, HOME, ROOT } from "./helpers.mjs";

test("a minimal valid config gets the documented defaults", () => {
  const r = parseConfig(configText());
  assert.equal(r.ok, true);
  assert.deepEqual(r.config, {
    firstmateRoot: ROOT,
    firstmateHome: HOME,
    minIntervalMs: 30000,
    fallbackMs: 120000,
    staleAfterMs: 360000,
    forgeReads: false,
  });
  assert.deepEqual(DEFAULTS, { minIntervalMs: 30000, fallbackMs: 120000, staleAfterMs: 360000, forgeReads: false });
  assert.equal(PAGE_SIZE, 50);
});

test("missing file is setup, not an error about JSON", () => {
  assert.equal(parseConfig(null).code, "missing");
  assert.equal(parseConfig("").code, "missing");
});

test("invalid JSON and non-objects are rejected", () => {
  assert.equal(parseConfig("{").code, "invalid-json");
  assert.equal(parseConfig("[]").code, "invalid");
  assert.equal(parseConfig("42").code, "invalid");
});

test("the config schema must match exactly", () => {
  assert.equal(parseConfig(configText({ schema: "firstmate-herdr-panel.config.v1" })).code, "unsupported-schema");
});

test("paths must be absolute, nonempty and free of NUL bytes", () => {
  for (const bad of ["", "relative/path", "~/firstmate", "/home/a\u0000b", 7, null]) {
    const r = parseConfig(configText({ firstmateHome: bad }));
    assert.equal(r.ok, false, `home ${JSON.stringify(bad)} should be rejected`);
    assert.equal(r.code, "invalid-path");
  }
  assert.equal(parseConfig(configText({ firstmateRoot: "relative" })).code, "invalid-path");
  assert.equal(parseConfig(configText({ firstmateHome: "/" })).code, "invalid-path");
});

test("trailing slashes are removed so the home label and path checks agree", () => {
  const r = parseConfig(configText({ firstmateHome: `${HOME}//`, firstmateRoot: `${ROOT}/` }));
  assert.equal(r.config.firstmateHome, HOME);
  assert.equal(r.config.firstmateRoot, ROOT);
});

test("interval bounds are enforced", () => {
  const code = (o) => parseConfig(configText(o)).code;
  assert.equal(code({ minIntervalMs: 9999 }), "invalid-interval");
  assert.equal(code({ minIntervalMs: 300001 }), "invalid-interval");
  assert.equal(code({ minIntervalMs: 30000.5 }), "invalid-interval");
  assert.equal(code({ minIntervalMs: 60000, fallbackMs: 59999, staleAfterMs: 300000 }), "invalid-interval");
  assert.equal(code({ fallbackMs: 600001 }), "invalid-interval");
  assert.equal(code({ staleAfterMs: 359999 }), "invalid-interval");
  const ok = parseConfig(configText({ minIntervalMs: 10000, fallbackMs: 10000, staleAfterMs: 30000 }));
  assert.equal(ok.ok, true);
});

test("forgeReads must be boolean", () => {
  assert.equal(parseConfig(configText({ forgeReads: "yes" })).code, "invalid-option");
  assert.equal(parseConfig(configText({ forgeReads: true })).config.forgeReads, true);
});

test("unknown keys are rejected so a typo cannot silently fall back to a default", () => {
  const r = parseConfig(configText({ forgeRead: true }));
  assert.equal(r.code, "unknown-key");
  assert.match(r.message, /forgeRead/);
  assert.equal(parseConfig(configText({ pageSize: 50 })).code, "unknown-key");
});

test("the shipped config.example.json is a valid config with the documented defaults", async () => {
  const { readFileSync } = await import("node:fs");
  const text = readFileSync(new URL("../mods/firstmate-fleet/config.example.json", import.meta.url), "utf8");
  const r = parseConfig(text);
  assert.equal(r.ok, true);
  assert.deepEqual(
    { minIntervalMs: r.config.minIntervalMs, fallbackMs: r.config.fallbackMs, staleAfterMs: r.config.staleAfterMs, forgeReads: r.config.forgeReads },
    DEFAULTS,
  );
});
