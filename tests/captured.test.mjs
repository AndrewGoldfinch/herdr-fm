// Real fm-bearings.v1 output captured by scripts/capture-fixtures.sh from FirstMate's own
// collector (revision in tests/fixtures/captured/manifest.json). These tests pin the
// decoder to what the producer actually emits, not to a reading of its source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeBearings } from "../mods/firstmate-fleet/decode.js";
import { buildView } from "../mods/firstmate-fleet/view-model.js";

const HOME = "/home/captain/firstmate";
const read = (name) => readFileSync(new URL(`./fixtures/captured/${name}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const decode = (name) => decodeBearings(read(`${name}.json`), HOME, 0);
const ids = (rows) => rows.map((r) => r.id);

test("captured from the pinned FirstMate revision with forge reads off and no network attempts", () => {
  assert.equal(manifest.firstmate_revision, "355a30710d6e545fe57f720896ed440ee5d99a9a");
  assert.equal(manifest.forge_reads, false);
  for (const run of manifest.runs) assert.equal(run.network_attempts, 0, run.scenario);
});

for (const name of ["empty", "normal", "holds"]) {
  test(`${name}: the real producer's output decodes with no issues`, () => {
    const r = decode(name);
    assert.equal(r.ok, true, r.message);
    assert.deepEqual(r.model.decodeIssues, []);
    assert.equal(r.model.homeLabel, "captain/firstmate");
  });
}

test("the four always-present 'not requested' pairs match the real producer exactly", () => {
  for (const name of ["empty", "normal", "holds"]) {
    const { model } = decode(name);
    assert.deepEqual(model.notRequested.map((d) => [d.surface, d.reveal]), [
      ["backlog item bodies", "--fields bodies"],
      ["watch/steer actions", "--fields actions"],
      ["full scout-report inventory", "--all-reports"],
      ["live PR discovery + checks", "--include-prs"],
    ]);
  }
});

test("empty: no rows, label-only home check, nothing limited", () => {
  const { model } = decode("empty");
  for (const list of Object.values(model.rows)) assert.deepEqual(list, []);
  assert.equal(model.homeCheck, "label-only");
  assert.deepEqual(model.disclosures, []);
});

test("normal: sections, a dead endpoint as unknown state plus an endpoint warning, artifacts by id", () => {
  const { model } = decode("normal");
  assert.equal(model.homeCheck, "paths");
  assert.deepEqual(ids(model.rows.underway), ["dead-task", "fix-login", "scout-cache"]);
  assert.deepEqual(ids(model.rows.landed), ["bump-deps"]);
  assert.deepEqual(ids(model.rows.charted_next), ["add-metrics"]);
  assert.deepEqual(ids(model.rows.unhealthy), ["dead-task"]);
  const dead = model.rows.unhealthy[0];
  assert.deepEqual(dead.endpoint, { backend: "tmux", target: "firstmate:fm-dead-task", exists: false, agent: "not_checked" });
  const [deadRow, login, scout] = model.rows.underway;
  assert.equal(deadRow.state, "unknown");
  assert.equal(login.endpoint.exists, true);
  assert.deepEqual(login.artifacts, [{ kind: "pr", value: "https://github.com/acme/demo/pull/42" }]);
  assert.deepEqual(scout.artifacts, [{ kind: "report", value: `${HOME}/data/scout-cache/report.md` }]);
  assert.equal(model.rows.charted_next[0].blockedBy, "fix-login");
  assert.equal(model.rows.charted_next[0].filed, null);
});

test("holds (P03 against the real producer): only the live hold is a captain call", () => {
  const { model } = decode("holds");
  assert.deepEqual(ids(model.rows.captain_call), ["pick-db"]);
  assert.equal(model.rows.captain_call[0].detail, "captain-hold");
  assert.deepEqual(ids(model.rows.charted_next), ["schema-change", "vendor-contract", "pricing"]);
  assert.deepEqual(model.rows.charted_next.map((g) => g.detail), [
    "blocked-by ask-api: needs schema",
    "until 2026-11-15: waiting on vendor",
    "held 59d: pricing call",
  ]);
  assert.deepEqual(ids(model.rows.underway), ["ask-api"], "a needs-decision status line without a hold stays Underway");
  assert.deepEqual(model.disclosures.map((d) => d.surface), ["captain holds bucketed blocked, dated, or aged: 3"]);
});

test("P16 against the real producer: an active away window exits 3 with the guard's message", () => {
  const away = manifest.runs.find((r) => r.scenario === "away");
  assert.equal(away.exit, 3);
  assert.match(away.stderr_first_line, /^fm-afk-return: away mode is still active/);
});

test("the view model renders captured output without an 'all clear'", () => {
  const base = { config: { staleAfterMs: 360000 }, configError: null, loading: false, refreshing: false, error: null, incompatible: false, away: false, awayMessage: null, stale: false, uncertain: false, receiptAgeMs: 0, producerAgeMs: 0 };
  for (const name of ["empty", "normal", "holds"]) {
    const v = buildView({ ...base, model: decode(name).model }, { section: "captain_call", query: "", page: 0, selectedKey: null, cursor: 0 });
    assert.equal(JSON.stringify(v).toLowerCase().includes("all clear"), false, name);
  }
});
