// Pure presentation model: controller state + UI state -> what the panel shows.
// main.js only turns this into GPUI elements. No Herdr imports.

import { projectSection, sectionCounts, findRow } from "./project.js";
import { formatAge } from "./controller.js";

export const TABS = Object.freeze(["captain_call", "underway", "landed", "charted_next", "secondmates", "unhealthy"]);

export const LABELS = Object.freeze({
  captain_call: "Captain's Call",
  underway: "Underway",
  landed: "Recently Landed",
  charted_next: "Charted Next",
  secondmates: "Secondmates",
  unhealthy: "Endpoint warnings",
});

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function limitedLines(model) {
  if (!model) return [];
  const lines = model.disclosures.map((d) => (d.reveal ? `${d.surface} (${d.reveal})` : d.surface));
  for (const i of model.decodeIssues) lines.push(`${i.message}: ${i.count}`);
  return lines;
}

function banners(st) {
  const out = [];
  const m = st.model;
  if (st.configError) {
    out.push({ tone: "error", text: "Configure a FirstMate checkout and home.", detail: [st.configError.message, "Edit mods/firstmate-fleet/.config.json (see config.example.json)."] });
    return out;
  }
  if (!m) {
    if (st.away) out.push({ tone: "warning", text: "FirstMate is in away mode; run the return in FirstMate.", detail: st.awayMessage ? [st.awayMessage] : [] });
    else if (st.error && st.incompatible) out.push({ tone: "error", text: "This FirstMate Bearings version is not supported.", detail: [st.error.message] });
    else if (st.error) out.push({ tone: "error", text: "FirstMate fleet unavailable.", detail: [st.error.message, st.error.detail].filter(Boolean) });
    else out.push({ tone: "info", text: "Loading fleet…", detail: [] });
    return out;
  }
  if (st.away) {
    out.push({ tone: "warning", text: "FirstMate is in away mode; run the return in FirstMate. Showing the last snapshot.", detail: st.awayMessage ? [st.awayMessage] : [] });
  } else if (st.error && st.incompatible) {
    out.push({ tone: "error", text: "This FirstMate Bearings version is not supported. Showing the last successful snapshot.", detail: [st.error.message] });
  } else if (st.error) {
    out.push({ tone: "warning", text: "Refresh failed. Showing the last successful snapshot.", detail: [st.error.message, st.error.detail].filter(Boolean) });
  }
  if (st.uncertain) out.push({ tone: "warning", text: "Clock skew: snapshot freshness is uncertain.", detail: [] });
  if (st.stale) out.push({ tone: "warning", text: `Snapshot is stale. Collected ${formatAge(st.receiptAgeMs)} ago; generated ${formatAge(st.producerAgeMs)} ago.`, detail: [] });
  const limited = limitedLines(m);
  if (limited.length) out.push({ tone: "info", text: "Some fleet information is limited.", detail: limited });
  return out;
}

function tabs(model) {
  const c = sectionCounts(model);
  const n = (k) => (model ? c[k] : null);
  return TABS.map((section) => {
    // A count is the length of the list the tab opens; splits go in the note.
    let count = section === "secondmates" ? (model ? model.secondmates.length : null) : n(section);
    let note = null;
    if (section === "captain_call" && model) note = plural(c.captain_call, "captain hold");
    if (section === "charted_next" && model) {
      count = c.charted_next + c.charted_warnings;
      if (c.charted_warnings) note = `${c.charted_next} queued · ${c.charted_warnings} ${c.charted_warnings === 1 ? "needs" : "need"} repair`;
    }
    return { section, label: LABELS[section], count, note };
  });
}

function rowBadges(row) {
  const b = [];
  if (row.warning) b.push({ text: "needs repair", tone: "warning" });
  if (row.ambiguous) b.push({ text: "ambiguous id", tone: "warning" });
  if (row.section === "underway" && row.state) b.push({ text: row.state, tone: row.state === "unknown" ? "muted" : "plain" });
  if (row.section === "unhealthy" && row.endpoint) b.push({ text: row.endpoint.exists === false ? "endpoint absent" : `agent ${row.endpoint.agent ?? "unknown"}`, tone: "warning" });
  return b;
}

function rowMeta(row) {
  const parts = [];
  if (row.owner && row.owner !== "(main)") parts.push(row.owner);
  if (row.repo) parts.push(row.repo);
  // Say whom a gate waits for: Bearings' reason when it gives one, else its blocker.
  if (row.detail) parts.push(row.detail);
  else if (row.section === "charted_next" && row.blockedBy) parts.push(`waits for ${row.blockedBy}`);
  return parts.join(" · ");
}

const yesNo = (v) => (v === null ? "unknown" : v ? "yes" : "no");

export function endpointText(ep) {
  if (!ep) return "none reported";
  return `${ep.backend ?? "unknown backend"} ${ep.target ?? "(no target)"} · exists: ${yesNo(ep.exists)} · agent: ${ep.agent ?? "unknown"}`;
}

const DETAIL_LABEL = { captain_call: "Verb", underway: "Doing", landed: "Detail", charted_next: "Reason", unhealthy: "Detail" };

function details(row, model) {
  if (!row) return null;
  const lines = [
    ["Id", row.id],
    ["Section", LABELS[row.section]],
    ["Title", row.title],
  ];
  if (row.owner) lines.push(["Owner", row.owner]);
  if (row.repo) lines.push(["Repo", row.repo]);
  if (row.kind) lines.push(["Kind", row.kind]);
  if (row.state) lines.push(["State", row.state]);
  if (row.detail) lines.push([DETAIL_LABEL[row.section], row.detail]);
  if (row.blockedBy) lines.push(["Blocked by", row.blockedBy]);
  if (row.filed) lines.push(["Filed", row.filed]);
  if (row.section === "underway" || row.section === "unhealthy") lines.push(["Endpoint", endpointText(row.endpoint)]);
  if (row.paths) {
    for (const [k, label] of [["worktree", "Worktree"], ["status", "Status log"], ["report", "Report path"], ["home", "Home"]]) {
      if (row.paths[k]) lines.push([label, row.paths[k]]);
    }
  }
  for (const a of row.artifacts) lines.push([a.kind === "pr" ? "PR" : a.kind === "report" ? "Report" : "Artifact", a.value]);
  const notes = ["Identity is by id only: a task replaced under the same id looks the same here."];
  if (row.ambiguous) notes.push("Bearings reported more than one row with this id; they are shown separately, not merged.");
  if (row.paths?.report) notes.push("A recorded path is not proof the file exists.");
  if (row.warning) notes.push("FirstMate integrity notice: action-free, not queued work.");
  return { title: row.title, lines, notes, generatedAt: model.generatedAt };
}

function emptyText(model, section, page, query) {
  if (!model || section === "secondmates" || page.totalMatches > 0) return null;
  const tail = ` ${plural(model.disclosures.length + model.decodeIssues.length, "disclosure")}.`;
  if (query.trim()) return `No ${LABELS[section]} rows match “${query.trim()}”.`;
  const allEmpty = Object.values(model.rows).every((list) => list.length === 0);
  if (allEmpty) return `No tasks reported for this home.${tail}`;
  if (section === "captain_call") return `No live captain holds reported.${tail}`;
  return `Nothing in ${LABELS[section]}.`;
}

function secondmateRows(st) {
  if (!st.model) return [];
  return st.model.secondmates.map((m) => ({
    id: m.id,
    state: m.state ?? "unknown",
    doing: m.doing,
    provenance: m.provenance ?? "unknown",
    freshness: m.freshness ?? "unknown",
    age: m.sourceAgeSeconds === null ? "unknown" : formatAge(m.sourceAgeSeconds * 1000 + (st.receiptAgeMs ?? 0)),
    contradiction: m.contradiction,
    reason: m.reason,
  }));
}

/**
 * @param {ReturnType<import("./controller.js").createController>["getState"] extends () => infer S ? S : never} st
 * @param {{section: string, query: string, page: number, selectedKey: string | null, cursor: number}} ui
 */
export function buildView(st, ui) {
  const model = st.model;
  const section = TABS.includes(ui.section) ? ui.section : "captain_call";
  const query = ui.query ?? "";
  const page = projectSection(model, query, section === "secondmates" ? "__none__" : section, ui.page);
  const selected = findRow(model, ui.selectedKey);
  const cursor = page.rows.length ? Math.min(Math.max(ui.cursor ?? 0, 0), page.rows.length - 1) : -1;
  return {
    header: {
      home: model ? model.homeLabel : null,
      homeCheck: model ? model.homeCheck : null,
      // Quiet by default: label-only verification is a header note, not a banner.
      homeNote: model && model.homeCheck === "label-only" ? "label only" : null,
      age: model ? formatAge(st.receiptAgeMs) : null,
      refreshing: st.refreshing,
      stale: st.stale,
      prs: model ? model.prs : null,
    },
    banners: banners(st),
    tabs: tabs(model),
    section,
    rows: page.rows.map((r, i) => ({ key: r.key, id: r.id, title: r.title, meta: rowMeta(r), badges: rowBadges(r), selected: selected?.key === r.key, cursor: i === cursor })),
    pager: { page: page.page, pageCount: page.pageCount, totalMatches: page.totalMatches },
    cursor,
    empty: emptyText(model, section, page, query),
    secondmates: section === "secondmates" ? secondmateRows(st) : [],
    notRequested: model ? model.notRequested.length : 0,
    details: details(selected, model),
    selectedKey: selected ? selected.key : null,
  };
}
