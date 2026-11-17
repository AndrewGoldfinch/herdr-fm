// FirstMate fleet panel: renders FirstMate's Bearings model (fm-bearings.v1).
// Observational only. The single command it runs is FirstMate's Bearings collector
// (see host.js); it never sends, steers, answers, merges or stops anything.
//
// Styled after Herdr's sidebar (app 0.1.16 defaults): chrome background, section tabs as
// sidebar-row chips with dim counts, one-line 30 px rows as in Agents, and Agents' tinted
// badge only for things that need attention. `herdr-app check` passed on app 0.1.16.

import { View, div, svg } from "gpui-kit";
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
    this.searching = false;
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
      .when(this.searching, (el) => el.child(this.searchBar(t)))
      .when(v.banners.length > 0, (el) => el.child(this.bannerList(t, v)))
      .when(Boolean(this.checkOnly), (el) => el.child(div().px(16).pb(6).text_size(11).text_color(t.dim).child("Loaded by herdr-app check: the collector is not started.")))
      .when(Boolean(v.header.home), (el) => el.child(this.tabBar(t, v)))
      .child(v.details ? this.detailsPane(t, v) : this.list(t, v));
  }

  // As the sidebar's "Agents" heading: small dim title, quiet icon controls on the right.
  header(t, v) {
    const h = v.header;
    const place = [h.home, h.machine ? `on ${h.machine}` : null, h.homeNote].filter(Boolean).join(" · ");
    return h_flex()
      .flex_none()
      .px(16)
      .h(41)
      .pt(14)
      .pb(5)
      .gap(6)
      .items_center()
      .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child("FirstMate"))
      .child(
        div()
          .id("home-label")
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(11.5)
          .text_color(t.muted)
          .when(Boolean(h.machineNote), (el) => el.tooltip(h.machineNote))
          .child(place),
      )
      .child(
        div()
          .id("refresh")
          .flex_none()
          .text_size(11)
          .text_color(h.stale ? t.blocked : t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .tooltip("Refresh now")
          .on_click((_e, cx) => this.apply(this.controller.refresh(), cx))
          .child(h.refreshing ? svg("mods/workspace-chrome/spinner.svg").size(12) : h.age ? `${h.age} ago` : "Refresh"),
      )
      .child(
        div()
          .id("search-toggle")
          .flex_none()
          .text_color(this.searching ? t.foreground : t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .tooltip("Search id, title or repo")
          .on_click((_e, cx) => {
            this.searching = !this.searching;
            if (!this.searching && this.ui.query) {
              this.search.set_value("");
              this.ui.query = "";
            }
            cx.notify();
          })
          .child(svg("mods/workspace-chrome/search.svg").size(14)),
      );
  }

  searchBar(t) {
    return div()
      .flex_none()
      .px(8)
      .pb(4)
      .child(
        h_flex()
          .h(28)
          .px(8)
          .items_center()
          .rounded(8)
          .border_1()
          .border_color(t.border)
          .child(Input.new(this.search).flex_1().h_full().text_size(12).text_color(t.foreground)),
      );
  }

  // Errors and warnings in a tinted block; information as plain dim text.
  bannerList(t, v) {
    return v_flex()
      .flex_none()
      .px(8)
      .pb(4)
      .gap(4)
      .children(
        v.banners.map((b, i) => {
          const c = toneColor(t, b.tone);
          return v_flex()
            .id(`banner-${i}`)
            .px(8)
            .py(loud(b.tone) ? 6 : 2)
            .gap(2)
            .rounded(8)
            .when(loud(b.tone), (el) => el.bg(c + "1f"))
            .child(div().text_size(12).text_color(loud(b.tone) ? c : t.dim).child(b.text))
            .children(b.detail.slice(0, 8).map((line) => div().text_size(11).text_color(t.dim).child(line)))
            .when(b.detail.length > 8, (el) => el.child(div().text_size(11).text_color(t.dim).child(`and ${b.detail.length - 8} more`)));
        }),
      );
  }

  // Section tabs: sidebar-row chips (selected and hover colours), labels at full strength,
  // counts dim beside them as in Agents' headings.
  tabBar(t, v) {
    return h_flex()
      .flex_none()
      .flex_wrap()
      .px(8)
      .pb(6)
      .gap(2)
      .border_b(1)
      .border_color(t.border)
      .children(
        v.tabs.map((tab) => {
          const on = tab.section === v.section;
          const attention = tab.section === "captain_call" && tab.count > 0;
          return h_flex()
            .id(`tab-${tab.section}`)
            .h(26)
            .px(8)
            .gap(5)
            .items_center()
            .rounded(8)
            .text_size(12.5)
            .cursor_pointer()
            .text_color(attention ? t.blocked : on ? t.foreground : t.muted)
            .when(on, (el) => el.bg(t.selected).font_medium())
            .hover((s) => s.bg(t.hover).text_color(t.foreground))
            .when(Boolean(tab.note), (el) => el.tooltip(tab.note))
            .on_click((_e, cx) => this.setSection(tab.section, cx))
            .child(tab.label)
            .when(tab.count !== null, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(tab.count))));
        }),
      );
  }

  // The current section's rows, one line each, as the sidebar's Agents rows.
  list(t, v) {
    const list = v_flex().id("fleet-list").flex_1().min_h(0).px(8).py(6).overflow_y_scrollbar();
    const note = (text) => div().px(8).h(28).flex().items_center().text_size(12).text_color(t.dim).truncate().child(text);
    if (v.section === "secondmates") return list.children(v.secondmates.length ? v.secondmates.map((m) => this.secondmateRow(t, m)) : [note("No registered secondmates reported.")]);
    if (v.empty) return list.child(note(v.empty));
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(list.children(v.rows.map((r) => this.row(t, r, v.section))))
      .when(v.pager.pageCount > 1, (el) => el.child(div().px(8).border_t(1).border_color(t.border).child(this.pager(t, v, v.section))));
  }

  // Agents' tinted badge for attention; otherwise a dim word, like Agents' durations.
  badge(t, b) {
    if (loud(b.tone)) {
      const c = toneColor(t, b.tone);
      return div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(c + "26").text_size(10.5).font_semibold().text_color(c).child(b.text);
    }
    return div().flex_none().text_size(11).text_color(t.dim).child(b.text);
  }

  // One line, as an Agents row: name, then dim context, then status on the right.
  row(t, r, section) {
    const cursor = r.cursor && section === this.ui.section;
    return h_flex()
      .id(`row-${r.key}`)
      .px(8)
      .h(30)
      .flex_none()
      .gap(9)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .when(cursor, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .tooltip(r.meta ? `${r.id} · ${r.meta}` : r.id)
      .on_click((_e, cx) => {
        this.ui.section = section;
        this.ui.selectedKey = r.key;
        cx.notify();
      })
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(5)
          .items_center()
          // As Agents: the name is capped only when context follows it.
          .child(div().min_w(0).truncate().when(Boolean(r.meta), (el) => el.max_w(220)).when(!r.meta, (el) => el.flex_1()).child(r.title))
          .when(Boolean(r.meta), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${r.meta}`))),
      )
      .children(r.badges.map((b) => this.badge(t, b)));
  }

  secondmateRow(t, m) {
    return h_flex()
      .px(8)
      .h(30)
      .flex_none()
      .gap(9)
      .items_center()
      .rounded(8)
      .hover((s) => s.bg(t.hover))
      .tooltip(`${m.state} · ${m.provenance}${m.contradiction ? " · contradiction" : ""}${m.doing ? ` · ${m.doing}` : ""}`)
      .child(
        h_flex()
          .flex_1()
          .min_w(0)
          .gap(5)
          .items_center()
          .child(div().min_w(0).max_w(220).truncate().child(m.id))
          .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`· ${m.state}`)),
      )
      .when(Boolean(m.reason), (el) => el.child(this.badge(t, { tone: "warning", text: m.reason })))
      .child(div().flex_none().text_size(11).text_color(m.freshness === "cached" ? t.blocked : t.dim).child(`${m.freshness} · ${m.age}`));
  }

  pager(t, v, section) {
    const p = v.pager;
    const step = (label, id, to, enabled) =>
      div()
        .id(`${id}-${section}`)
        .text_color(enabled ? t.muted : t.dim)
        .when(enabled, (el) =>
          el
            .cursor_pointer()
            .hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => {
              this.ui.section = section;
              this.ui.page = to;
              this.ui.cursor = 0;
              cx.notify();
            }),
        )
        .child(label);
    return h_flex()
      .flex_none()
      .h(26)
      .px(8)
      .gap(8)
      .items_center()
      .text_size(11)
      .child(div().flex_1().text_color(t.dim).child(`${p.totalMatches} rows · page ${p.page + 1} of ${p.pageCount}`))
      .child(step("‹", "page-prev", p.page - 1, p.page > 0))
      .child(step("›", "page-next", p.page + 1, p.page < p.pageCount - 1));
  }

  // Details replace the list, with Files' back control.
  detailsPane(t, v) {
    const d = v.details;
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(
        h_flex()
          .flex_none()
          .h(30)
          .px(16)
          .gap(6)
          .items_center()
          .child(
            h_flex()
              .id("details-back")
              .flex_none()
              .gap(4)
              .items_center()
              .text_size(11)
              .text_color(t.dim)
              .cursor_pointer()
              .hover((s) => s.text_color(t.foreground))
              .tooltip("Back to the list (Esc)")
              .on_click((_e, cx) => {
                this.ui.selectedKey = null;
                cx.notify();
              })
              .child(svg("mods/workspace-chrome/chevron-left.svg").size(11))
              .child("Back"),
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
          .pb(12)
          .gap(10)
          .child(div().font_medium().child(d.title))
          .children(d.lines.map(([label, value]) => v_flex().gap(2).child(div().text_size(11).font_medium().text_color(t.dim).child(label)).child(div().text_size(12.5).child(value))))
          .children(d.notes.map((n) => div().text_size(11).text_color(t.dim).child(n))),
      );
  }
}
