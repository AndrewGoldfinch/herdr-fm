// Panel configuration: parsing and validation only. No Herdr imports, so Node can test it.

export const CONFIG_SCHEMA = "firstmate-herdr-panel.config.v2";
export const PAGE_SIZE = 50;
export const DEFAULTS = Object.freeze({ minIntervalMs: 30000, fallbackMs: 120000, staleAfterMs: 360000, forgeReads: false, machine: null });

const KEYS = new Set(["schema", "firstmateRoot", "firstmateHome", "minIntervalMs", "fallbackMs", "staleAfterMs", "forgeReads", "machine"]);

// herdr-core's machine name rule (`addr::check_name`): 1-32 of a-z 0-9 - _ . starting with a
// letter or digit, and not shaped like a terminal id (t7).
const MACHINE_NAME = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const TERMINAL_ID = /^t[1-9][0-9bcdfghjkmnpqrstvwxyz]*$/;

const fail = (code, message) => ({ ok: false, code, message });

// Absolute, nonempty, NUL-free; trailing slashes dropped so "<home>/state/" checks line up.
function normalizePath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\u0000")) return null;
  const trimmed = value.replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

const isWholeMs = (v) => Number.isInteger(v) && v > 0;

/**
 * @typedef {{firstmateRoot: string, firstmateHome: string, minIntervalMs: number,
 *   fallbackMs: number, staleAfterMs: number, forgeReads: boolean, machine: string | null}} PanelConfig
 * @typedef {{ok: true, config: PanelConfig} | {ok: false, code: string, message: string}} ConfigResult
 * @param {string | null | undefined} text
 * @returns {ConfigResult}
 */
export function parseConfig(text) {
  if (text == null || text === "") return fail("missing", "No .config.json in the mod folder.");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("invalid-json", ".config.json is not valid JSON.");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return fail("invalid", ".config.json must be a JSON object.");
  const unknown = Object.keys(raw).filter((k) => !KEYS.has(k));
  if (unknown.length) return fail("unknown-key", `Unknown setting: ${unknown.join(", ")}.`);
  if (raw.schema !== CONFIG_SCHEMA) return fail("unsupported-schema", `"schema" must be "${CONFIG_SCHEMA}".`);

  const firstmateRoot = normalizePath(raw.firstmateRoot);
  if (!firstmateRoot) return fail("invalid-path", '"firstmateRoot" must be an absolute path to a FirstMate checkout.');
  const firstmateHome = normalizePath(raw.firstmateHome);
  if (!firstmateHome || firstmateHome === "/") return fail("invalid-path", '"firstmateHome" must be an absolute path to a FirstMate home.');

  const minIntervalMs = raw.minIntervalMs ?? DEFAULTS.minIntervalMs;
  const fallbackMs = raw.fallbackMs ?? DEFAULTS.fallbackMs;
  const staleAfterMs = raw.staleAfterMs ?? DEFAULTS.staleAfterMs;
  if (!isWholeMs(minIntervalMs) || minIntervalMs < 10000 || minIntervalMs > 300000) {
    return fail("invalid-interval", '"minIntervalMs" must be a whole number from 10000 to 300000.');
  }
  if (!isWholeMs(fallbackMs) || fallbackMs < minIntervalMs || fallbackMs > 600000) {
    return fail("invalid-interval", '"fallbackMs" must be a whole number from minIntervalMs to 600000.');
  }
  if (!isWholeMs(staleAfterMs) || staleAfterMs < 3 * fallbackMs) {
    return fail("invalid-interval", '"staleAfterMs" must be a whole number of at least 3 × fallbackMs.');
  }
  const forgeReads = raw.forgeReads ?? DEFAULTS.forgeReads;
  if (typeof forgeReads !== "boolean") return fail("invalid-option", '"forgeReads" must be true or false.');
  // A Herdr machine (`hc machine ls`) the collector runs on; null runs it on this computer.
  const machine = raw.machine ?? DEFAULTS.machine;
  if (machine !== null && (typeof machine !== "string" || !MACHINE_NAME.test(machine) || TERMINAL_ID.test(machine))) {
    return fail("invalid-machine", '"machine" must be null or a Herdr machine name from `hc machine ls`.');
  }

  return { ok: true, config: { firstmateRoot, firstmateHome, minIntervalMs, fallbackMs, staleAfterMs, forgeReads, machine } };
}

/** @param {PanelConfig | null} a @param {PanelConfig | null} b */
export function sameConfig(a, b) {
  if (!a || !b) return a === b;
  for (const k of KEYS) if (k !== "schema" && a[k] !== b[k]) return false;
  return true;
}
