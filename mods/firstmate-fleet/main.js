// FirstMate fleet panel: renders FirstMate's Bearings model (fm-bearings.v1).
// Observational only. The single command it runs is FirstMate's Bearings collector
// (see host.js); it never sends, steers, answers, merges or stops anything.
//
// Styled after Herdr's own panels (app 0.1.16 defaults): the sidebar's chrome background and
// 13 px text, the Files/Changes header and input, sidebar-style rounded rows, and Agents'
// tinted status badges. `herdr-app check` passed on app 0.1.16; live checks in Task 3 are pending.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, readTextFile, watchFolder, appHome, theme } from "herdr";
// Functions newer apps add are reached through the namespace, so the mod still loads on
// apps that lack them (a named import of a missing export fails to link).
import * as herdrApi from "herdr";
import { createController } from "./controller.js";
import { createHost, configPathFor } from "./host.js";
import { buildView, TABS } from "./view-model.js";

const TICK_MS = 5000;

// App 0.1.16: true while `herdr-app check` loads the mod, where init() runs for real.
const isChecking = () => typeof herdrApi.checking === "function" && herdrApi.checking() === true;

function makeClock() {
  const perf = globalThis.performance;
  if (perf && typeof perf.now === "function") {
    return { nowMs: () => perf.now(), wallTimeMs: () => Date.now(), monotonic: true };
  }
  return { nowMs: () => Date.now(), wallTimeMs: () => Date.now(), monotonic: false };
}

// Herdr's own colours: Changes shows errors in ansi1; Agents marks attention with blocked.
function toneColor(t, tone) {
  if (tone === "error") return t.ansi1;
  if (tone === "warning") return t.blocked;
  if (tone === "muted") return t.dim;
  return t.muted;
}

const loud = (tone) => tone === "error" || tone === "warning";

export default class FirstmateFleet extends View {
  init(_props, cx) {
    this.ui = { section: "captain_call", query: "", page: 0, selectedKey: null, cursor: 0 };
    this.controller = createController({ host: createHost({ exec, readTextFile }, configPathFor(appHome())), clock: makeClock() });
    this.watchHome = null;
    this.watching = new Set();
    this.watchHandles = new Map();
    this.handle = cx.focus_handle();
    this.search = InputState.new({ placeholder: "Search id, title or repo" });
    this.search.on("change", (_e, cx) => {
      this.ui.query = this.search.value();
      this.ui.page = 0;
      this.ui.cursor = 0;
      cx.notify();
    });
    // A check must not run FirstMate's collector (and its SSH reads) or leave watches behind.
    this.checkOnly = isChecking();
    if (this.checkOnly) return;
    this.apply(this.controller.start(), cx);
    cx.timer.every(TICK_MS, (cx) => this.apply(this.controller.tick(), cx));
  }

  // App 0.1.16 watch handles can be cancelled; older apps return a plain promise.
  cancelWatches() {
    for (const w of this.watchHandles.values()) if (w && typeof w.cancel === "function") w.cancel();
    this.watchHandles.clear();
  }

  // Redraw only when the controller says something visible changed; await its work in a task.
  apply(action, cx) {
    if (action.changed) cx.notify();
    if (!action.pending) return;
    cx.notify();
    cx.spawn(async (cx) => {
      await action.pending;
      this.ensureWatches(cx);
      cx.notify();
    });
  }

  // One watchFolder loop per folder of the configured home; loops end when the home changes.
  // watchFolder works on this computer only: a home on another machine relies on the fallback timer.
  ensureWatches(cx) {
    const config = this.controller.getState().config;
    const home = config && !config.machine ? config.firstmateHome : null;
    if (home !== this.watchHome) {
      this.watchHome = home;
      this.watching = new Set();
      this.cancelWatches();
    }
    if (!home) return;
    for (const dir of [`${home}/data`, `${home}/state`]) {
      if (this.watching.has(dir)) continue;
      this.watching.add(dir);
      const watchSet = this.watching;
      cx.spawn(async () => {
        try {
          while (this.watchHome === home && this.watching === watchSet) {
            const watch = watchFolder(dir);
            this.watchHandles.set(dir, watch);
            const paths = await watch;
            if (this.watchHome !== home || this.watching !== watchSet) break;
            // App 0.1.16 may reclaim an idle watch, resolving it with []; changes since then
            // are unknown, so treat it like the watch root itself: reload (still rate-limited).
            this.controller.notifyChange(paths && paths.length ? paths : [dir], dir);
          }
        } catch {
          // Missing folder or watcher error: forget it so the next collection retries.
          // The fallback timer keeps collecting meanwhile.
          watchSet.delete(dir);
        }
      });
    }
  }

  async close(_cx) {
    this.watchHome = null;
    this.watching = new Set();
    this.cancelWatches();
    this.controller.dispose();
  }

  setSection(section, cx) {
    this.ui.section = section;
    this.ui.page = 0;
    this.ui.cursor = 0;
    this.ui.selectedKey = null;
    cx.notify();
  }

  onKey(e, v, cx) {
    const k = e.key;
    const m = e.modifiers ?? {};
    if (k === "escape" && this.ui.selectedKey) {
      this.ui.selectedKey = null;
    } else if (k === "down" && v.rows.length) {
      this.ui.cursor = Math.min(v.cursor + 1, v.rows.length - 1);
    } else if (k === "up" && v.rows.length) {
      this.ui.cursor = Math.max(v.cursor - 1, 0);
    } else if (k === "enter" && v.cursor >= 0) {
      this.ui.selectedKey = v.rows[v.cursor].key;
    } else if (k === "pagedown") {
      this.ui.page = Math.min(v.pager.page + 1, v.pager.pageCount - 1);
      this.ui.cursor = 0;
    } else if (k === "pageup") {
      this.ui.page = Math.max(v.pager.page - 1, 0);
      this.ui.cursor = 0;
    } else if ((k === "right" || k === "left") && m.alt) {
      const i = TABS.indexOf(v.section) + (k === "right" ? 1 : -1);
      return this.setSection(TABS[(i + TABS.length) % TABS.length], cx), cx.stop_propagation();
    } else {
      return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  render() {
    const t = theme();
    const v = buildView(this.controller.getState(), this.ui);
    this.ui.selectedKey = v.selectedKey;

    return v_flex()
      .id("root")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .text_color(t.foreground)
      .on_key_down((e, cx) => this.onKey(e, v, cx))
      .child(this.header(t, v))
      .child(this.searchBar(t))
      .when(v.banners.length > 0, (el) => el.child(this.bannerList(t, v)))
      .when(Boolean(this.checkOnly), (el) => el.child(div().px(16).py(6).text_size(11).text_color(t.dim).child("Loaded by herdr-app check: the collector is not started.")))
      .child(this.tabBar(t, v))
      .child(v.details ? this.detailsPane(t, v) : this.body(t, v));
  }

  // As the Files and Changes panels: 42 px, semibold title, dim detail; Agents' quiet header control.
  header(t, v) {
    const h = v.header;
    return h_flex()
      .flex_none()
      .h(42)
      .px(14)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().flex_none().font_semibold().child("FirstMate fleet"))
      .child(
        div()
          .id("home-label")
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(12)
          .text_color(t.dim)
          .when(Boolean(h.machineNote), (el) => el.tooltip(h.machineNote))
          .child([h.home, h.machine ? `on ${h.machine}` : null, h.homeNote].filter(Boolean).join(" · ")),
      )
      .child(div().flex_none().text_size(11).text_color(h.stale ? t.blocked : t.dim).child(h.refreshing ? "Refreshing…" : h.age ? `${h.age} ago` : ""))
      .child(
        div()
          .id("refresh")
          .flex_none()
          .text_size(11)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .tooltip("Collect now")
          .on_click((_e, cx) => this.apply(this.controller.refresh(), cx))
          .child("Refresh"),
      );
  }

  // As the Changes panel's input.
  searchBar(t) {
    return div()
      .flex_none()
      .px(8)
      .pt(8)
      .pb(4)
      .child(
        h_flex()
          .h(32)
          .px(10)
          .items_center()
          .rounded(8)
          .border_1()
          .border_color(t.border)
          .child(Input.new(this.search).flex_1().h_full().text_size(12).text_color(t.foreground)),
      );
  }

  // Errors and warnings get a tinted block; information is a plain dim note, as in Files.
  bannerList(t, v) {
    return v_flex()
      .flex_none()
      .px(8)
      .pt(4)
      .gap(4)
      .children(
        v.banners.map((b, i) => {
          const c = toneColor(t, b.tone);
          return v_flex()
            .id(`banner-${i}`)
            .px(10)
            .py(loud(b.tone) ? 7 : 4)
            .gap(2)
            .rounded(8)
            .when(loud(b.tone), (el) => el.bg(c + "1f"))
            .child(div().text_size(12).text_color(loud(b.tone) ? c : t.muted).when(loud(b.tone), (el) => el.font_medium()).child(b.text))
            .children(b.detail.slice(0, 8).map((line) => div().text_size(11).text_color(t.dim).child(line)))
            .when(b.detail.length > 8, (el) => el.child(div().text_size(11).text_color(t.dim).child(`and ${b.detail.length - 8} more`)));
        }),
      );
  }

  // Section chips: selected and hover colours as sidebar rows; counts dim, as Agents' headings.
  tabBar(t, v) {
    return h_flex()
      .flex_none()
      .flex_wrap()
      .px(8)
      .py(6)
      .gap(2)
      .border_b(1)
      .border_color(t.border)
      .children(
        v.tabs.map((tab) => {
          const on = tab.section === v.section;
          return h_flex()
            .id(`tab-${tab.section}`)
            .h(26)
            .px(8)
            .gap(5)
            .items_center()
            .rounded(6)
            .text_size(12)
            .cursor_pointer()
            .when(on, (el) => el.bg(t.selected).text_color(t.foreground).font_medium())
            .when(!on, (el) => el.text_color(t.muted))
            .hover((s) => s.bg(t.hover))
            .when(Boolean(tab.note), (el) => el.tooltip(tab.note))
            .on_click((_e, cx) => this.setSection(tab.section, cx))
            .child(tab.label)
            .when(tab.count !== null, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(tab.count))));
        }),
      );
  }

  body(t, v) {
    const list = v_flex().id("fleet-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).py(6).gap(1);
    const empty = (text) => div().px(8).py(6).text_size(12).text_color(t.dim).child(text);
    if (v.section === "secondmates") return list.children(v.secondmates.length ? v.secondmates.map((m) => this.secondmateRow(t, m)) : [empty("No registered secondmates reported.")]);
    if (v.empty) return list.child(empty(v.empty));
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(list.children(v.rows.map((r) => this.row(t, r))))
      .when(v.pager.pageCount > 1, (el) => el.child(this.pager(t, v)));
  }

  // Agents' tinted status badge for problems; Changes' bordered count badge for the rest.
  badge(t, b) {
    if (loud(b.tone)) {
      const c = toneColor(t, b.tone);
      return div().flex_none().h(18).px(6).flex().items_center().rounded(5).bg(c + "26").text_size(10.5).font_semibold().text_color(c).child(b.text);
    }
    return div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(toneColor(t, b.tone)).child(b.text);
  }

  row(t, r) {
    return v_flex()
      .id(`row-${r.key}`)
      .px(8)
      .py(6)
      .gap(2)
      .rounded(8)
      .cursor_pointer()
      .when(r.cursor, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.ui.selectedKey = r.key;
        cx.notify();
      })
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_1().min_w(0).truncate().child(r.title))
          .children(r.badges.map((b) => this.badge(t, b))),
      )
      .child(div().truncate().text_size(11).text_color(t.dim).child(r.meta ? `${r.id} · ${r.meta}` : r.id));
  }

  secondmateRow(t, m) {
    return v_flex()
      .px(8)
      .py(6)
      .gap(2)
      .rounded(8)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(div().flex_1().min_w(0).truncate().child(m.id))
          .child(div().flex_none().text_size(11).text_color(m.freshness === "cached" ? t.blocked : t.dim).child(`${m.freshness} · ${m.age}`)),
      )
      .child(div().truncate().text_size(11).text_color(t.dim).child(`${m.state} · ${m.provenance}${m.contradiction ? " · contradiction" : ""}`))
      .when(Boolean(m.doing), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(m.doing)))
      .when(Boolean(m.reason), (el) => el.child(div().text_size(11).text_color(t.blocked).child(m.reason)));
  }

  pager(t, v) {
    const p = v.pager;
    const step = (label, id, to, enabled) =>
      div()
        .id(id)
        .text_color(enabled ? t.muted : t.dim)
        .when(enabled, (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => {
              this.ui.page = to;
              this.ui.cursor = 0;
              cx.notify();
            }),
        )
        .child(label);
    return h_flex()
      .flex_none()
      .h(32)
      .px(16)
      .gap(8)
      .items_center()
      .border_t(1)
      .border_color(t.border)
      .text_size(11)
      .child(step("‹ Previous", "page-prev", p.page - 1, p.page > 0))
      .child(div().flex_1().text_color(t.dim).child(`Page ${p.page + 1} of ${p.pageCount} · ${p.totalMatches} rows`))
      .child(step("Next ›", "page-next", p.page + 1, p.page < p.pageCount - 1));
  }

  // A sub-bar with Files' back arrow; field labels as Agents' section headings.
  detailsPane(t, v) {
    const d = v.details;
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(
        h_flex()
          .flex_none()
          .h(32)
          .px(14)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(
            div()
              .id("details-back")
              .flex_none()
              .text_size(12)
              .text_color(t.muted)
              .cursor_pointer()
              .hover((s) => s.text_color(t.foreground))
              .tooltip("Back to the list (Esc)")
              .on_click((_e, cx) => {
                this.ui.selectedKey = null;
                cx.notify();
              })
              .child("← Back"),
          )
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`Snapshot ${d.generatedAt}`)),
      )
      .child(
        v_flex()
          .id("details-body")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .px(16)
          .py(12)
          .gap(10)
          .child(div().font_semibold().child(d.title))
          .children(d.lines.map(([label, value]) => v_flex().gap(2).child(div().text_size(11).font_medium().text_color(t.dim).child(label)).child(div().child(value))))
          .children(d.notes.map((n) => div().text_size(11).text_color(t.dim).child(n))),
      );
  }
}
