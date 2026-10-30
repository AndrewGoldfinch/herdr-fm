import { test } from "node:test";
import assert from "node:assert/strict";
import { buildView, TABS, LABELS, endpointText } from "../mods/firstmate-fleet/view-model.js";
import { decodeBearings } from "../mods/firstmate-fleet/decode.js";
import { fixtureText, HOME, RECEIVED } from "./helpers.mjs";

const model = (name) => decodeBearings(fixtureText(name), HOME, RECEIVED).model;
const UI = { section: "captain_call", query: "", page: 0, selectedKey: null, cursor: 0 };

function state(over = {}) {
  return {
    config: { firstmateHome: HOME, staleAfterMs: 360000 },
    configError: null,
    model: model("normal"),
    loading: false,
    refreshing: false,
    error: null,
    incompatible: false,
    away: false,
    awayMessage: null,
    stale: false,
    uncertain: false,
    receiptAgeMs: 12000,
    producerAgeMs: 12000,
    ...over,
  };
}

const texts = (v) => v.banners.map((b) => b.text);
const everyString = (v) => JSON.stringify(v);

test("tabs use FirstMate's section names, never Herdr's agent-status words", () => {
  assert.deepEqual(TABS.map((t) => LABELS[t]), ["Captain's Call", "Underway", "Recently Landed", "Charted Next", "Secondmates", "Endpoint warnings"]);
  const all = everyString(buildView(state(), UI));
  for (const word of ["Needs you", "\"Done\"", "\"Working\"", "\"Idle\""]) assert.equal(all.includes(word), false, word);
});

test("section counts, with captain calls counted as captain holds and warnings apart from queued work", () => {
  const v = buildView(state({ model: model("holds") }), UI);
  const t = Object.fromEntries(v.tabs.map((x) => [x.section, x]));
  assert.equal(t.captain_call.count, 2);
  assert.equal(t.captain_call.note, "2 captain holds");
  assert.equal(t.charted_next.count, 3);
  assert.equal(t.charted_next.note, "2 warnings need repair");
  assert.equal(t.underway.count, 1);
});

test("warning gates are badged 'needs repair'", () => {
  const v = buildView(state({ model: model("holds") }), { ...UI, section: "charted_next" });
  assert.deepEqual(v.rows[0].badges, [{ text: "needs repair", tone: "warning" }]);
  assert.deepEqual(v.rows[2].badges, []);
  assert.equal(v.rows[2].meta, "blocked by ask-api · blocked by ask-api: needs schema");
});

test("loading, unavailable, setup, away and incompatible states without a model", () => {
  assert.deepEqual(texts(buildView(state({ model: null, loading: true, refreshing: true }), UI)), ["Loading fleet…"]);
  assert.deepEqual(texts(buildView(state({ model: null, error: { category: "exit", message: "The collector exited with code 1.", detail: "boom" } }), UI)), ["FirstMate fleet unavailable."]);
  assert.deepEqual(texts(buildView(state({ model: null, configError: { code: "missing", message: "No .config.json in the mod folder." } }), UI)), ["Configure a FirstMate checkout and home."]);
  assert.deepEqual(texts(buildView(state({ model: null, away: true, awayMessage: "away mode is still active" }), UI)), ["FirstMate is in away mode; run the return in FirstMate."]);
  assert.deepEqual(texts(buildView(state({ model: null, incompatible: true, error: { category: "unsupported-schema", message: "Expected fm-bearings.v1, got fm-fleet-snapshot.v1." } }), UI)), ["This FirstMate Bearings version is not supported."]);
});

test("with a retained model: failure, away, stale, skew and limited data are all visible", () => {
  const v = buildView(state({ error: { category: "exit", message: "x", detail: "" }, stale: true, uncertain: true, model: model("partial"), receiptAgeMs: 400000, producerAgeMs: 400000 }), UI);
  assert.deepEqual(texts(v), [
    "Refresh failed. Showing the last successful snapshot.",
    "Clock skew: snapshot freshness is uncertain.",
    "Snapshot is stale. Collected 6m ago; generated 6m ago.",
    "Some fleet information is limited.",
  ]);
  const limited = v.banners[3].detail;
  assert.ok(limited.includes("reports showing 20 of 30 (--all-reports)"));
  assert.ok(limited.includes("in_flight: rows without a string id or not objects: 2"));
  const away = buildView(state({ away: true }), UI);
  assert.equal(texts(away)[0], "FirstMate is in away mode; run the return in FirstMate. Showing the last snapshot.");
});

test("home verified by label only is disclosed", () => {
  assert.ok(texts(buildView(state({ model: model("empty") }), UI)).includes("Home verified by label only."));
  assert.equal(texts(buildView(state(), UI)).includes("Home verified by label only."), false);
});

test("P01: an empty model says so with a disclosure count, never 'all clear'", () => {
  const v = buildView(state({ model: model("empty") }), UI);
  assert.equal(v.empty, "No tasks reported for this home. 0 disclosures.");
  assert.equal(everyString(v).toLowerCase().includes("all clear"), false);
});

test("an empty Captain's Call names captain holds and counts disclosures", () => {
  const v = buildView(state({ model: model("cached-secondmate") }), UI);
  assert.equal(v.empty, "No live captain holds reported. 1 disclosure.");
  const u = buildView(state({ model: model("cached-secondmate") }), { ...UI, section: "landed" });
  assert.equal(u.empty, "Nothing in Recently Landed.");
});

test("artifact and endpoint text in details, with the identity caveat", () => {
  const m = model("normal");
  const key = m.rows.underway[0].key;
  const v = buildView(state({ model: m }), { ...UI, section: "underway", selectedKey: key });
  assert.equal(v.selectedKey, key);
  const lines = Object.fromEntries(v.details.lines);
  assert.equal(lines.PR, "https://github.com/acme/webapp/pull/42");
  assert.equal(lines.Endpoint, "hc default:t7 · exists: yes · agent: not_checked");
  assert.equal(lines["Report path"], "/home/captain/firstmate/data/fix-login/report.md");
  assert.ok(v.details.notes[0].startsWith("Identity is by id only"));
  assert.ok(v.details.notes.includes("A recorded path is not proof the file exists."));
  assert.equal(v.rows[0].selected, true);
  assert.equal(endpointText({ backend: "tmux", target: null, exists: null, agent: "not_checked" }), "tmux (no target) · exists: unknown · agent: not_checked");
  assert.equal(endpointText(null), "none reported");
});

test("a selected key that disappears clears the details", () => {
  const v = buildView(state(), { ...UI, selectedKey: JSON.stringify(["underway", "", "gone"]) });
  assert.equal(v.details, null);
  assert.equal(v.selectedKey, null);
});

test("secondmates show provenance, cached freshness and advanced age; unknown stays unknown", () => {
  const v = buildView(state({ model: model("cached-secondmate"), receiptAgeMs: 60000 }), { ...UI, section: "secondmates" });
  assert.deepEqual(v.secondmates.map((m) => [m.id, m.freshness, m.provenance, m.age]), [
    ["mate-b", "cached", "remote-ledger-cache", "31m"],
    ["mate-c", "unknown", "unreadable", "unknown"],
  ]);
  assert.equal(v.rows.length, 0);
});

test("underway rows show raw state; unknown is muted, not hidden", () => {
  const v = buildView(state(), { ...UI, section: "underway" });
  assert.deepEqual(v.rows.map((r) => r.badges.map((b) => b.text)), [["working"], ["unknown"], ["working"]]);
  assert.equal(v.rows[1].badges[0].tone, "muted");
  assert.equal(v.rows[2].meta, "acme/docs · editing");
});

test("cursor clamps to the page and search reports no matches plainly", () => {
  const v = buildView(state(), { ...UI, section: "underway", cursor: 99 });
  assert.equal(v.cursor, 2);
  const none = buildView(state(), { ...UI, section: "underway", query: "zzz" });
  assert.equal(none.cursor, -1);
  assert.equal(none.empty, "No Underway rows match “zzz”.");
});

test("header carries home, age and refresh state", () => {
  const v = buildView(state({ refreshing: true }), UI);
  assert.deepEqual(v.header, { home: "captain/firstmate", homeCheck: "paths", age: "10s", refreshing: true, stale: false, prs: "not requested (pass --include-prs for live GitHub discovery)" });
  assert.equal(v.notRequested, 4);
});
