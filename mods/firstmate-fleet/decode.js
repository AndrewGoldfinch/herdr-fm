// Decodes FirstMate's Bearings model (fm-bearings.v1) into the panel model.
// It validates and reshapes; it never reclassifies. Section membership is Bearings'
// array membership, and row order is Bearings' order. No Herdr imports.

export const BEARINGS_SCHEMA = "fm-bearings.v1";
export const SECTIONS = Object.freeze(["captain_call", "underway", "landed", "charted_next", "unhealthy"]);

const REQUIRED_ARRAYS = ["in_flight", "secondmates", "secondmate_reconcile", "decisions_open", "landed", "gates", "reports", "recorded_prs", "omitted", "paths", "endpoints"];

// Disclosures for surfaces the panel deliberately does not request. Matched as exact
// pairs: `--all-reports` also reveals the real truncation "reports showing N of M".
const NOT_REQUESTED = [
  ["backlog item bodies", "--fields bodies"],
  ["watch/steer actions", "--fields actions"],
  ["full scout-report inventory", "--all-reports"],
  ["live PR discovery + checks", "--include-prs"],
];

const GENERATED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/** Bearings labels a home by the last two segments of its path. */
export function homeLabel(home) {
  return home.split("/").slice(-2).join("/");
}

const fail = (code, message) => ({ ok: false, code, message });
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clip = (s, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

// Bearings writes "-" (and sometimes "") where a value is absent.
function text(v) {
  if (typeof v !== "string" || v === "" || v === "-") return null;
  return v;
}

function parseGenerated(v) {
  if (typeof v !== "string") return null;
  const m = GENERATED.exec(v);
  if (!m) return null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return null;
  // Date.parse rolls some out-of-range values over; insist on a round trip.
  return new Date(ms).toISOString().slice(0, 19) === v.slice(0, 19) ? ms : null;
}

function rowBase(section, id, owner) {
  return {
    key: "",
    section,
    id,
    owner,
    title: id,
    repo: null,
    kind: null,
    state: null,
    detail: null,
    blockedBy: null,
    warning: false,
    filed: null,
    endpoint: null,
    paths: null,
    artifacts: [],
    ambiguous: false,
  };
}

const BUILDERS = {
  captain_call: (r) => ({ ...rowBase("captain_call", r.id, text(r.owner)), title: text(r.summary) ?? r.id, detail: text(r.verb) }),
  underway: (r) => ({
    ...rowBase("underway", r.id, null),
    title: text(r.name) ?? r.id,
    repo: text(r.repo),
    kind: text(r.kind),
    state: text(r.state),
    detail: text(r.doing),
  }),
  landed: (r) => {
    const row = { ...rowBase("landed", r.id, text(r.owner)), title: text(r.what) ?? r.id };
    const artifact = text(r.artifact);
    if (artifact) row.artifacts.push({ kind: "artifact", value: artifact });
    return row;
  },
  charted_next: (r) => ({
    ...rowBase("charted_next", r.id, text(r.owner)),
    title: text(r.title) ?? r.id,
    detail: text(r.reason),
    blockedBy: text(r.blocked_by),
    // Synthetic integrity rows, e.g. "(main-inventory)" and "(return-catchup)".
    warning: /^\(.+\)$/.test(r.id),
    filed: text(r.filed),
  }),
  unhealthy: (r) => ({ ...rowBase("unhealthy", r.id, null), endpoint: endpointOf(r) }),
};

const SOURCES = { captain_call: "decisions_open", underway: "in_flight", landed: "landed", charted_next: "gates", unhealthy: "unhealthy_endpoints" };

function endpointOf(r) {
  return {
    backend: text(r.backend),
    target: text(r.target),
    exists: typeof r.exists === "boolean" ? r.exists : null,
    agent: text(r.agent),
  };
}

function byId(list, issues, name) {
  const map = new Map();
  let bad = 0;
  for (const r of list) {
    if (!isObject(r) || typeof r.id !== "string" || r.id === "") {
      bad++;
      continue;
    }
    if (!map.has(r.id)) map.set(r.id, []);
    map.get(r.id).push(r);
  }
  if (bad) issues.push({ code: "malformed-row", message: `${name}: rows without a string id or not objects`, count: bad });
  return map;
}

/**
 * @param {string} text producer stdout
 * @param {string} expectedHome the configured, normalized FirstMate home
 * @param {number} receivedAtMs monotonic receipt time
 */
export function decodeBearings(text_, expectedHome, receivedAtMs) {
  if (typeof text_ !== "string") return fail("invalid-output", "The collector returned no output.");
  let doc;
  try {
    doc = JSON.parse(text_);
  } catch {
    return fail("invalid-json", "The collector's output is not JSON.");
  }
  if (!isObject(doc)) return fail("invalid-shape", "The collector's output is not a JSON object.");
  if (doc.schema !== BEARINGS_SCHEMA) {
    const seen = typeof doc.schema === "string" ? clip(doc.schema, 60) : "none";
    return fail("unsupported-schema", `Expected ${BEARINGS_SCHEMA}, got ${seen}.`);
  }
  const generatedMs = parseGenerated(doc.generated);
  if (generatedMs === null) return fail("invalid-generated", "The model's generated time is missing or invalid.");
  const label = homeLabel(expectedHome);
  if (doc.home !== label) {
    const seen = typeof doc.home === "string" ? clip(doc.home, 80) : "none";
    return fail("home-mismatch", `Expected home ${label}, got ${seen}.`);
  }
  for (const name of REQUIRED_ARRAYS) {
    if (!Array.isArray(doc[name])) return fail("missing-surface", `The model has no ${name} array.`);
  }
  if (!isObject(doc.contributions)) return fail("missing-surface", "The model has no contributions object.");
  if (doc.unhealthy_endpoints !== undefined && !Array.isArray(doc.unhealthy_endpoints)) {
    return fail("missing-surface", "The model's unhealthy_endpoints is not an array.");
  }

  const issues = [];

  // Home check: Bearings publishes only a label, so verify recorded status paths.
  const statePrefix = `${expectedHome}/state/`;
  const paths = byId(doc.paths, issues, "paths");
  let checked = 0;
  for (const [, list] of paths) {
    for (const p of list) {
      if (typeof p.status !== "string") continue;
      if (!p.status.startsWith(statePrefix)) {
        return fail("home-mismatch", `Status path ${clip(p.status, 160)} is not under ${statePrefix}.`);
      }
      checked++;
    }
  }

  const endpoints = byId(doc.endpoints, issues, "endpoints");
  const reports = byId(doc.reports, issues, "reports");
  const prs = byId(doc.recorded_prs, issues, "recorded_prs");

  const rows = {};
  for (const section of SECTIONS) {
    const source = SOURCES[section];
    const list = doc[source] ?? [];
    const out = [];
    let bad = 0;
    for (const r of list) {
      if (!isObject(r) || typeof r.id !== "string" || r.id === "") {
        bad++;
        continue;
      }
      out.push(BUILDERS[section](r));
    }
    if (bad) issues.push({ code: "malformed-row", message: `${source}: rows without a string id or not objects`, count: bad });

    for (const row of out) {
      if (section === "underway") {
        const ep = endpoints.get(row.id);
        if (ep) row.endpoint = endpointOf(ep[0]);
        const p = paths.get(row.id);
        if (p) row.paths = { worktree: text(p[0].worktree), home: text(p[0].home), status: text(p[0].status), report: text(p[0].report) };
      }
      for (const rep of reports.get(row.id) ?? []) if (text(rep.path)) row.artifacts.push({ kind: "report", value: rep.path });
      for (const pr of prs.get(row.id) ?? []) if (text(pr.url)) row.artifacts.push({ kind: "pr", value: pr.url });
    }

    // Keys are JSON tuples; duplicates stay separate, flagged, with an occurrence index.
    const seen = new Map();
    for (const row of out) {
      const base = [section, row.owner ?? "", row.id];
      const k = JSON.stringify(base);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const used = new Map();
    let dup = 0;
    for (const row of out) {
      const base = [section, row.owner ?? "", row.id];
      const k = JSON.stringify(base);
      if (seen.get(k) > 1) {
        const n = used.get(k) ?? 0;
        used.set(k, n + 1);
        row.ambiguous = true;
        row.key = JSON.stringify([...base, n]);
        dup++;
      } else {
        row.key = k;
      }
    }
    if (dup) issues.push({ code: "duplicate-key", message: `${section}: ${dup} rows share a key`, count: dup });
    rows[section] = out;
  }

  const secondmates = [];
  let badMates = 0;
  for (const m of doc.secondmates) {
    if (!isObject(m) || typeof m.id !== "string" || m.id === "") {
      badMates++;
      continue;
    }
    const age = m.age_seconds;
    secondmates.push({
      id: m.id,
      state: text(m.state),
      doing: text(m.doing),
      provenance: text(m.provenance),
      freshness: text(m.freshness),
      sourceAgeSeconds: typeof age === "number" && Number.isFinite(age) && age >= 0 ? age : null,
      contradiction: m.contradiction === true,
      reason: text(m.reason),
    });
  }
  if (badMates) issues.push({ code: "malformed-row", message: "secondmates: rows without a string id or not objects", count: badMates });

  const disclosures = [];
  const notRequested = [];
  let badOmitted = 0;
  for (const o of doc.omitted) {
    if (!isObject(o) || typeof o.surface !== "string" || (o.reveal != null && typeof o.reveal !== "string")) {
      badOmitted++;
      continue;
    }
    const d = { surface: o.surface, reveal: o.reveal ?? null };
    if (NOT_REQUESTED.some(([s, r]) => s === d.surface && r === d.reveal)) notRequested.push(d);
    else disclosures.push(d);
  }
  if (badOmitted) issues.push({ code: "malformed-disclosure", message: "omitted: entries that are not {surface, reveal}", count: badOmitted });

  return {
    ok: true,
    model: {
      homeLabel: label,
      homeCheck: checked > 0 ? "paths" : "label-only",
      generatedAt: doc.generated,
      generatedMs,
      receivedAtMs,
      prs: text(doc.prs),
      rows,
      secondmates,
      disclosures,
      notRequested,
      decodeIssues: issues,
    },
  };
}
