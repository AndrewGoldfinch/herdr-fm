import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBearings } from "../mods/firstmate-fleet/decode.js";
import { projectSection, sectionCounts, findRow } from "../mods/firstmate-fleet/project.js";
import { fixture, fixtureText, HOME, RECEIVED } from "./helpers.mjs";

const model = (name) => decodeBearings(fixtureText(name), HOME, RECEIVED).model;

function bigModel(n) {
  const doc = fixture("empty");
  doc.in_flight = Array.from({ length: n }, (_, i) => ({ id: `task-${String(i).padStart(3, "0")}`, kind: "ship", state: "working", repo: i % 2 ? "acme/odd" : "acme/even", name: `Task number ${i}`, doing: "" }));
  doc.gates = Array.from({ length: n }, (_, i) => ({ id: `gate-${i}`, title: `Gate ${i}`, blocked_by: "-", reason: "-", owner: "(main)", filed: null }));
  return decodeBearings(JSON.stringify(doc), HOME, RECEIVED).model;
}

test("pages hold 50 rows, page is zero-based and clamped", () => {
  const m = bigModel(120);
  const p0 = projectSection(m, "", "underway", 0);
  assert.equal(p0.pageSize, 50);
  assert.equal(p0.rows.length, 50);
  assert.equal(p0.totalMatches, 120);
  assert.equal(p0.pageCount, 3);
  assert.equal(p0.rows[0].id, "task-000");
  const last = projectSection(m, "", "underway", 99);
  assert.equal(last.page, 2);
  assert.equal(last.rows.length, 20);
  assert.equal(projectSection(m, "", "underway", -4).page, 0);
  assert.equal(projectSection(m, "", "underway", 1.7).page, 1);
});

test("an empty section is one empty page", () => {
  const p = projectSection(model("empty"), "", "captain_call", 3);
  assert.deepEqual([p.page, p.pageCount, p.totalMatches, p.rows.length], [0, 1, 0, 0]);
});

test("search is literal and case-insensitive over id, title and repo", () => {
  const m = model("normal");
  assert.deepEqual(projectSection(m, "LOGIN", "underway", 0).rows.map((r) => r.id), ["fix-login"]);
  assert.deepEqual(projectSection(m, "acme/docs", "underway", 0).rows.map((r) => r.id), ["mate-a/docs-sweep"]);
  assert.deepEqual(projectSection(m, "scout-cache", "underway", 0).rows.map((r) => r.id), ["scout-cache"]);
  assert.equal(projectSection(m, "running tests", "underway", 0).totalMatches, 0, "detail text is not searched");
});

test("search treats regex syntax literally", () => {
  const m = model("hostile");
  assert.equal(projectSection(m, ".*", "underway", 0).totalMatches, 1);
  assert.equal(projectSection(m, "[a-z]+", "underway", 0).rows[0].id, "regex-1");
  // An unbalanced "(" would throw as a regex; literally it matches "$(rm" and "(no regex)".
  assert.equal(projectSection(m, "(", "underway", 0).totalMatches, 2);
});

test("P14: 500 rows per section project quickly and deterministically", () => {
  const m = bigModel(500);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) projectSection(m, "odd", "underway", i % 5);
  const per = (performance.now() - t0) / 20;
  assert.ok(per < 100, `projection took ${per.toFixed(2)} ms`);
  const a = projectSection(m, "odd", "underway", 2);
  const b = projectSection(m, "odd", "underway", 2);
  assert.deepEqual(a.rows.map((r) => r.key), b.rows.map((r) => r.key));
  assert.equal(a.totalMatches, 250);
});

test("P14: decoding 500 rows per section stays under 100 ms", () => {
  const doc = fixture("empty");
  doc.in_flight = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, kind: "ship", state: "working", repo: "r", name: `n${i}`, doing: "d" }));
  doc.landed = Array.from({ length: 500 }, (_, i) => ({ id: `l${i}`, what: `w${i}`, artifact: "-", owner: "(main)" }));
  doc.gates = Array.from({ length: 500 }, (_, i) => ({ id: `g${i}`, title: `g${i}`, blocked_by: "-", reason: "-", owner: "(main)", filed: null }));
  doc.decisions_open = Array.from({ length: 500 }, (_, i) => ({ id: `d${i}`, key: `d${i}`, verb: "captain-hold", summary: `s${i}`, owner: "(main)" }));
  const text = JSON.stringify(doc);
  const runs = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    decodeBearings(text, HOME, RECEIVED);
    runs.push(performance.now() - t0);
  }
  runs.sort((x, y) => x - y);
  assert.ok(runs[8] < 100, `p90 decode ${runs[8].toFixed(2)} ms`);
});

test("counts separate warning gates from queued work", () => {
  const c = sectionCounts(model("holds"));
  assert.deepEqual(c, { captain_call: 2, underway: 1, landed: 0, charted_next: 3, charted_warnings: 2, unhealthy: 0 });
});

test("selection follows the key and clears when the row is gone", () => {
  const m = model("normal");
  const key = m.rows.underway[0].key;
  assert.equal(findRow(m, key).id, "fix-login");
  assert.equal(findRow(m, JSON.stringify(["underway", "", "gone"])), null);
  assert.equal(findRow(null, key), null);
  assert.equal(findRow(m, null), null);
});
