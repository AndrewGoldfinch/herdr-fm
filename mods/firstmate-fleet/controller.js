// Refresh state machine. It owns no timers: the view drives tick() from cx.timer and
// notifyChange() from watchFolder loops, and awaits returned promises inside cx.spawn.
// No Herdr imports, so Node can test it with a fake host and clock.

import { parseConfig, sameConfig } from "./config.js";
import { decodeBearings } from "./decode.js";

export const DEBOUNCE_MS = 2000;
export const BACKOFF_MS = Object.freeze([30000, 60000, 120000]);
export const CONFIG_RETRY_MS = 5000;
export const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const FUTURE_SKEW_MS = 5000;
const DIAGNOSTICS = 50;
const DETAIL_CHARS = 300;

const NONE = Object.freeze({ changed: false, pending: null });

/** Age at 5-second resolution under a minute, then minutes, then hours. */
export function formatAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${Math.floor(s / 5) * 5}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function utf8Length(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// Strip escape sequences and control characters, keep it short.
function sanitize(text) {
  if (typeof text !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  return clean.length > DETAIL_CHARS ? `${clean.slice(0, DETAIL_CHARS)}…` : clean;
}

const firstLine = (text) => sanitize(text).split("\n")[0] ?? "";

// Hidden files are ignored, except the ones fm-afk-return.sh reads to decide away mode.
const AWAY_FILES = new Set([".afk", ".afk-contract", ".afk-return-catchup"]);
const CACHE_DIR = "secondmate-summary-cache";

/**
 * Whether one watched path can change the fleet. `kind` is "state" or "data" when the path
 * came from that watch, else null. Herdr canonicalizes a watched root, so a home reached
 * through a symlink reports paths outside the configured prefix; those are judged by their
 * own segments, which can only over-count (an extra collection, still rate-limited).
 */
function changes(path, home, kind) {
  if (path.startsWith(`${home}/`)) {
    const segs = path.slice(home.length + 1).split("/");
    if (segs[0] === "state" && segs[1] === CACHE_DIR) return false;
    if (segs.length === 2 && segs[0] === "state" && AWAY_FILES.has(segs[1])) return true;
    return !segs.some((seg) => seg.startsWith("."));
  }
  if (kind === null) return false;
  const segs = path.split("/");
  const name = segs[segs.length - 1];
  if (segs.includes(CACHE_DIR)) return false;
  if (name.startsWith(".")) return kind === "state" && AWAY_FILES.has(name);
  return true;
}

/**
 * @param {{host: {collect: Function, readConfig: Function},
 *          clock: {nowMs: () => number, wallTimeMs: () => number, monotonic?: boolean},
 *          parse?: Function, decode?: Function, onChange?: Function}} deps
 */
export function createController({ host, clock, parse = parseConfig, decode = decodeBearings, onChange = () => {} }) {
  const monotonic = clock.monotonic !== false;
  let lastSeen = -Infinity;
  let clockAnomaly = false;

  // Elapsed time never runs backwards; without a monotonic clock a backward jump is flagged.
  function now() {
    let t = clock.nowMs();
    if (t < lastSeen) {
      if (!monotonic) clockAnomaly = true;
      t = lastSeen;
    }
    lastSeen = t;
    return t;
  }

  const s = {
    epoch: 0,
    request: 0,
    config: null,
    configError: null,
    model: null,
    freshness: null,
    inFlight: null,
    needsCollect: true,
    lastStartMs: -Infinity,
    lastConfigTryMs: -Infinity,
    failures: 0,
    nextAttemptMs: 0,
    pendingChangeMs: null,
    dirty: false,
    error: null,
    away: false,
    awayMessage: null,
    disposed: false,
    diagnostics: [],
    shownKey: "",
  };

  function clearData() {
    s.model = null;
    s.freshness = null;
    s.error = null;
    s.away = false;
    s.awayMessage = null;
    s.failures = 0;
    s.nextAttemptMs = 0;
    s.pendingChangeMs = null;
    s.dirty = false;
  }

  /** Apply a config now. Each collection still re-reads the file, which wins. */
  function configure(config) {
    if (s.disposed || sameConfig(config, s.config)) return;
    s.epoch++;
    s.config = config;
    s.configError = null;
    clearData();
    s.needsCollect = true;
  }

  function fail(category, message, detail) {
    s.failures++;
    s.error = { category, message, detail: sanitize(detail ?? ""), atMs: now() };
    const delay = BACKOFF_MS[Math.min(s.failures - 1, BACKOFF_MS.length - 1)];
    s.nextAttemptMs = now() + Math.min(delay, s.config ? s.config.fallbackMs : delay);
  }

  function due(t) {
    if (s.disposed || s.inFlight) return null;
    if (!s.config) {
      if (s.needsCollect) return "start";
      return t - s.lastConfigTryMs >= CONFIG_RETRY_MS ? "config" : null;
    }
    if (s.needsCollect) return "start";
    if (t < s.nextAttemptMs) return null;
    if (s.failures > 0) return "retry";
    if (s.pendingChangeMs !== null && t - s.pendingChangeMs >= DEBOUNCE_MS && t - s.lastStartMs >= s.config.minIntervalMs) return "change";
    if (t - s.lastStartMs >= s.config.fallbackMs) return "fallback";
    return null;
  }

  function record(diag) {
    s.diagnostics.push(diag);
    if (s.diagnostics.length > DIAGNOSTICS) s.diagnostics.splice(0, s.diagnostics.length - DIAGNOSTICS);
  }

  function attempt(trigger) {
    const startedMs = now();
    const request = ++s.request;
    s.inFlight = { request, trigger, startedMs };
    s.needsCollect = false;
    s.pendingChangeMs = null;
    onChange();
    const diag = { request, trigger, startedMs, elapsedMs: null, exitCode: null, bytes: null, rows: null, disclosures: null, category: null };

    return (async () => {
      try {
        let text;
        try {
          text = await host.readConfig();
        } catch {
          text = null;
        }
        if (s.disposed) {
          diag.category = "disposed";
          return;
        }
        s.lastConfigTryMs = now();
        const parsed = parse(text);
        if (!parsed.ok) {
          if (s.config !== null) s.epoch++;
          s.config = null;
          s.configError = { code: parsed.code, message: parsed.message };
          clearData();
          diag.category = `config:${parsed.code}`;
          return;
        }
        if (!sameConfig(parsed.config, s.config)) {
          configure(parsed.config);
          s.needsCollect = false;
        }
        s.configError = null;

        const epoch = s.epoch;
        const config = s.config;
        s.lastStartMs = now();
        let result;
        try {
          result = await host.collect(config);
        } catch (err) {
          if (s.disposed || epoch !== s.epoch) {
            diag.category = "superseded";
            return;
          }
          fail("spawn", `Could not run the collector: ${sanitize(String(err?.message ?? err))}`);
          diag.category = "spawn";
          return;
        }
        if (s.disposed || epoch !== s.epoch) {
          diag.category = "superseded";
          return;
        }

        const code = typeof result?.code === "number" ? result.code : null;
        const stdout = typeof result?.stdout === "string" ? result.stdout : "";
        const stderr = typeof result?.stderr === "string" ? result.stderr : "";
        diag.exitCode = code;

        if (code !== 0) {
          if (code === 3 && /(^|\n)fm-afk-return:/.test(stderr)) {
            s.away = true;
            s.awayMessage = firstLine(stderr).replace(/^fm-afk-return:\s*/, "");
            s.error = null;
            s.failures = 0;
            s.nextAttemptMs = 0;
            diag.category = "away";
            return;
          }
          fail("exit", `The collector exited with code ${code ?? "unknown"}.`, stderr);
          diag.category = "exit";
          return;
        }

        const tooBig = stdout.length > MAX_OUTPUT_BYTES || (stdout.length * 3 > MAX_OUTPUT_BYTES && utf8Length(stdout) > MAX_OUTPUT_BYTES);
        if (tooBig) {
          diag.bytes = stdout.length;
          fail("oversized", "The collector's output exceeds 8 MiB.");
          diag.category = "oversized";
          return;
        }
        diag.bytes = utf8Length(stdout);

        const receivedMs = now();
        const decoded = decode(stdout, config.firstmateHome, receivedMs);
        if (!decoded.ok) {
          fail(decoded.code, decoded.message);
          diag.category = decoded.code;
          return;
        }

        const producerAge = clock.wallTimeMs() - decoded.model.generatedMs;
        const uncertain = producerAge < -FUTURE_SKEW_MS;
        clockAnomaly = false;
        s.model = decoded.model;
        s.freshness = { receivedMs, producerAgeAtReceiptMs: Math.max(0, producerAge), uncertain };
        s.error = null;
        s.away = false;
        s.awayMessage = null;
        s.failures = 0;
        s.nextAttemptMs = 0;
        diag.rows = Object.values(decoded.model.rows).reduce((n, list) => n + list.length, 0);
        diag.disclosures = decoded.model.disclosures.length;
        diag.category = "ok";
      } finally {
        diag.elapsedMs = now() - startedMs;
        record(diag);
        if (s.inFlight && s.inFlight.request === request) s.inFlight = null;
        if (s.dirty) {
          s.dirty = false;
          s.pendingChangeMs = now() - DEBOUNCE_MS;
        }
        onChange();
      }
    })();
  }

  function getState() {
    const t = now();
    const f = s.freshness;
    const receiptAgeMs = s.model && f ? t - f.receivedMs : null;
    const producerAgeMs = s.model && f ? f.producerAgeAtReceiptMs + receiptAgeMs : null;
    const uncertain = Boolean(s.model && f && (f.uncertain || clockAnomaly));
    const staleAfter = s.config ? s.config.staleAfterMs : Infinity;
    const stale = Boolean(s.model && (uncertain || receiptAgeMs >= staleAfter || producerAgeMs >= staleAfter));
    return {
      config: s.config,
      configError: s.configError,
      model: s.model,
      loading: s.inFlight !== null && s.model === null,
      refreshing: s.inFlight !== null,
      error: s.error,
      incompatible: s.error?.category === "unsupported-schema",
      away: s.away,
      awayMessage: s.awayMessage,
      stale,
      uncertain,
      receiptAgeMs,
      producerAgeMs,
      failures: s.failures,
      nextAttemptMs: s.nextAttemptMs,
      epoch: s.epoch,
      diagnostics: s.diagnostics.slice(),
    };
  }

  function shownKey() {
    const st = getState();
    return `${formatAge(st.receiptAgeMs)}|${formatAge(st.producerAgeMs)}|${st.stale}|${st.uncertain}`;
  }

  function tick() {
    if (s.disposed) return NONE;
    const trigger = due(now());
    const pending = trigger ? attempt(trigger) : null;
    const key = shownKey();
    const changed = pending !== null || key !== s.shownKey;
    s.shownKey = key;
    return { changed, pending };
  }

  return {
    configure,
    start: tick,
    tick,

    /** Manual refresh: bypasses backoff and minIntervalMs when idle; never queues. */
    refresh() {
      if (s.disposed) return NONE;
      if (s.inFlight) return { changed: false, pending: null, busy: true };
      return { changed: true, pending: attempt("manual") };
    },

    /**
     * Paths from watchFolder, and the folder that watch was asked for (`<home>/state` or
     * `<home>/data`). Returns whether any of them can change the fleet.
     */
    notifyChange(paths, root) {
      if (s.disposed || !s.config) return false;
      const home = s.config.firstmateHome;
      const kind = root === `${home}/state` ? "state" : root === `${home}/data` ? "data" : null;
      if (root !== undefined && kind === null) return false;
      const relevant = (paths ?? []).some((p) => typeof p === "string" && changes(p, home, kind));
      if (!relevant) return false;
      if (s.inFlight) s.dirty = true;
      else if (s.pendingChangeMs === null) s.pendingChangeMs = now();
      return true;
    },

    dispose() {
      s.disposed = true;
      s.epoch++;
    },

    getState,
  };
}
