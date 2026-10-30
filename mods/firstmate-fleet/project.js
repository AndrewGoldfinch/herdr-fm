// Pure search, pagination and counts over a decoded panel model. No Herdr imports.

import { PAGE_SIZE } from "./config.js";

const matches = (row, needle) =>
  row.id.toLowerCase().includes(needle) ||
  row.title.toLowerCase().includes(needle) ||
  (row.repo !== null && row.repo.toLowerCase().includes(needle));

/**
 * Literal, case-insensitive search over id, title and repo; never a regex.
 * @returns {{rows: object[], totalMatches: number, page: number, pageCount: number, pageSize: number, disclosures: object[]}}
 */
export function projectSection(model, query, section, page) {
  const all = model?.rows?.[section] ?? [];
  const needle = (query ?? "").trim().toLowerCase();
  const found = needle ? all.filter((r) => matches(r, needle)) : all;
  const pageCount = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  const want = Number.isFinite(page) ? Math.floor(page) : 0;
  const at = Math.min(Math.max(want, 0), pageCount - 1);
  return {
    rows: found.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE),
    totalMatches: found.length,
    page: at,
    pageCount,
    pageSize: PAGE_SIZE,
    disclosures: model?.disclosures ?? [],
  };
}

/** Warning gates such as "(main-inventory)" are not queued work. */
export function sectionCounts(model) {
  const rows = model?.rows ?? {};
  const gates = rows.charted_next ?? [];
  return {
    captain_call: (rows.captain_call ?? []).length,
    underway: (rows.underway ?? []).length,
    landed: (rows.landed ?? []).length,
    charted_next: gates.filter((g) => !g.warning).length,
    charted_warnings: gates.filter((g) => g.warning).length,
    unhealthy: (rows.unhealthy ?? []).length,
  };
}

/** Selection follows the row key; a key no longer present selects nothing. */
export function findRow(model, key) {
  if (!model || !key) return null;
  for (const list of Object.values(model.rows)) {
    for (const row of list) if (row.key === key) return row;
  }
  return null;
}
