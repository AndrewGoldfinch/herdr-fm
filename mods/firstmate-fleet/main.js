// FirstMate fleet panel: renders FirstMate's Bearings model (fm-bearings.v1).
// Observational only. The single command it runs is FirstMate's Bearings collector
// (see host.js); it never sends, steers, answers, merges or stops anything.
//
// UNVERIFIED: written against the Herdr app 0.1.10 and 0.1.11 mod guide and the shipped mods,
// without a Herdr binary. `herdr-app check` and the live checks in Task 3 are pending.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, readTextFile, watchFolder, appHome, theme } from "herdr";
import { createController } from "./controller.js";
import { createHost, configPathFor } from "./host.js";
import { buildView, TABS } from "./view-model.js";

const TICK_MS = 5000;

function makeClock() {
  const perf = globalThis.performance;
  if (perf && typeof perf.now === "function") {
    return { nowMs: () => perf.now(), wallTimeMs: () => Date.now(), monotonic: true };
  }
  return { nowMs: () => Date.now(), wallTimeMs: () => Date.now(), monotonic: false };
}

function toneColor(t, tone) {
  if (tone === "error") return t.blocked;
  if (tone === "warning") return t.done;
  if (tone === "muted") return t.dim;
  return t.muted;
}

export default class FirstmateFleet extends View {
  init(_props, cx) {
    this.ui = { section: "captain_call", query: "", page: 0, selectedKey: null, cursor: 0 };
    this.controller = createController({ host: createHost({ exec, readTextFile }, configPathFor(appHome())), clock: makeClock() });
    this.watchHome = null;
    this.watching = new Set();
    this.handle = cx.focus_handle();
    this.search = InputState.new({ placeholder: "Search id, title or repo" });
    this.search.on("change", (_e, cx) => {
      this.ui.query = this.search.value();
      this.ui.page = 0;
      this.ui.cursor = 0;
      cx.notify();
    });
    this.apply(this.controller.start(), cx);
    cx.timer.every(TICK_MS, (cx) => this.apply(this.controller.tick(), cx));
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
  ensureWatches(cx) {
    const home = this.controller.getState().config?.firstmateHome ?? null;
    if (home !== this.watchHome) {
      this.watchHome = home;
      this.watching = new Set();
    }
    if (!home) return;
    for (const dir of [`${home}/data`, `${home}/state`]) {
      if (this.watching.has(dir)) continue;
      this.watching.add(dir);
      const watchSet = this.watching;
      cx.spawn(async () => {
        try {
          while (this.watchHome === home && this.watching === watchSet) {
            const paths = await watchFolder(dir);
            if (this.watchHome !== home || this.watching !== watchSet) break;
            this.controller.notifyChange(paths, dir);
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
      .bg(t.surface)
      .text_size(12.5)
      .text_color(t.foreground)
      .on_key_down((e, cx) => this.onKey(e, v, cx))
      .child(this.header(t, v))
      .child(this.searchBar(t))
      .when(v.banners.length > 0, (el) => el.child(this.bannerList(t, v)))
      .child(this.tabBar(t, v))
      .child(v.details ? this.detailsPane(t, v) : this.body(t, v));
  }

  header(t, v) {
    const h = v.header;
    return h_flex()
      .flex_none()
      .px(12)
      .h(34)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().flex_none().font_semibold().child("FirstMate fleet"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(h.homeNote ? `${h.home ?? ""} · ${h.homeNote}` : h.home ?? ""))
      .child(div().flex_none().text_size(11).text_color(h.stale ? t.done : t.dim).child(h.refreshing ? "Refreshing…" : h.age ? `${h.age} ago` : ""))
      .child(
        div()
          .id("refresh")
          .flex_none()
          .px(8)
          .py(2)
          .rounded(5)
          .border_1()
          .border_color(t.border)
          .text_size(11.5)
          .text_color(h.refreshing ? t.dim : t.foreground)
          .cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.apply(this.controller.refresh(), cx))
          .child("Refresh"),
      );
  }

  searchBar(t) {
    return h_flex()
      .flex_none()
      .mx(10)
      .my(8)
      .h(30)
      .px(8)
      .items_center()
      .rounded(6)
      .border_1()
      .border_color(t.input ?? t.border)
      .bg(t.background)
      .child(Input.new(this.search).flex_1().h_full().text_size(12).text_color(t.foreground));
  }

  bannerList(t, v) {
    return v_flex()
      .flex_none()
      .mx(10)
      .mb(6)
      .gap(4)
      .children(
        v.banners.map((b, i) =>
          v_flex()
            .id(`banner-${i}`)
            .px(8)
            .py(5)
            .rounded(5)
            .border_1()
            .border_color(toneColor(t, b.tone))
            .gap(2)
            .child(div().text_color(toneColor(t, b.tone)).font_medium().child(b.text))
            .children(b.detail.slice(0, 8).map((line) => div().text_size(11).text_color(t.muted).child(line)))
            .when(b.detail.length > 8, (el) => el.child(div().text_size(11).text_color(t.dim).child(`and ${b.detail.length - 8} more`))),
        ),
      );
  }

  tabBar(t, v) {
    return h_flex()
      .flex_none()
      .flex_wrap()
      .px(8)
      .pb(6)
      .gap(4)
      .border_b(1)
      .border_color(t.border)
      .children(
        v.tabs.map((tab) => {
          const on = tab.section === v.section;
          return div()
            .id(`tab-${tab.section}`)
            .px(8)
            .py(3)
            .rounded(5)
            .text_size(11.5)
            .cursor_pointer()
            .when(on, (el) => el.bg(t.selected ?? t.hover).text_color(t.foreground).font_medium())
            .when(!on, (el) => el.text_color(t.muted))
            .hover((s) => s.bg(t.hover))
            .when(Boolean(tab.note), (el) => el.tooltip(tab.note))
            .on_click((_e, cx) => this.setSection(tab.section, cx))
            .child(tab.count === null ? tab.label : `${tab.label} ${tab.count}`);
        }),
      );
  }

  body(t, v) {
    const list = v_flex().flex_1().min_h(0).overflow_y_scrollbar().py(4);
    if (v.section === "secondmates") return list.children(v.secondmates.length ? v.secondmates.map((m) => this.secondmateRow(t, m)) : [div().px(12).py(8).text_color(t.dim).child("No registered secondmates reported.")]);
    if (v.empty) return list.child(div().px(12).py(8).text_color(t.dim).child(v.empty));
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(list.children(v.rows.map((r) => this.row(t, r))))
      .when(v.pager.pageCount > 1, (el) => el.child(this.pager(t, v)));
  }

  row(t, r) {
    return v_flex()
      .id(`row-${r.key}`)
      .mx(6)
      .px(8)
      .py(5)
      .rounded(5)
      .gap(1)
      .cursor_pointer()
      .when(r.cursor, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.ui.selectedKey = r.key;
        cx.notify();
      })
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().flex_1().min_w(0).truncate().child(r.title))
          .children(r.badges.map((b) => div().flex_none().px(5).rounded(4).border_1().border_color(toneColor(t, b.tone)).text_size(10.5).text_color(toneColor(t, b.tone)).child(b.text))),
      )
      .child(div().truncate().text_size(11).text_color(t.dim).child(r.meta ? `${r.id} · ${r.meta}` : r.id));
  }

  secondmateRow(t, m) {
    return v_flex()
      .mx(6)
      .px(8)
      .py(5)
      .gap(1)
      .child(h_flex().gap(6).child(div().flex_1().truncate().font_medium().child(m.id)).child(div().flex_none().text_size(11).text_color(m.freshness === "cached" ? t.done : t.dim).child(`${m.freshness} · ${m.age}`)))
      .child(div().truncate().text_size(11).text_color(t.muted).child(`${m.state} · ${m.provenance}${m.contradiction ? " · contradiction" : ""}`))
      .when(Boolean(m.doing), (el) => el.child(div().truncate().text_size(11).text_color(t.dim).child(m.doing)))
      .when(Boolean(m.reason), (el) => el.child(div().text_size(11).text_color(t.done).child(m.reason)));
  }

  pager(t, v) {
    const p = v.pager;
    const step = (label, id, to, enabled) =>
      div()
        .id(id)
        .px(8)
        .text_color(enabled ? t.foreground : t.dim)
        .when(enabled, (el) =>
          el.cursor_pointer().on_click((_e, cx) => {
            this.ui.page = to;
            this.ui.cursor = 0;
            cx.notify();
          }),
        )
        .child(label);
    return h_flex()
      .flex_none()
      .h(28)
      .px(8)
      .gap(6)
      .items_center()
      .border_t(1)
      .border_color(t.border)
      .text_size(11.5)
      .child(step("‹ Prev", "page-prev", p.page - 1, p.page > 0))
      .child(div().flex_1().text_color(t.dim).child(`Page ${p.page + 1} of ${p.pageCount} · ${p.totalMatches} rows`))
      .child(step("Next ›", "page-next", p.page + 1, p.page < p.pageCount - 1));
  }

  detailsPane(t, v) {
    const d = v.details;
    return v_flex()
      .flex_1()
      .min_h(0)
      .child(
        h_flex()
          .flex_none()
          .px(12)
          .py(6)
          .gap(8)
          .items_center()
          .child(
            div()
              .id("details-back")
              .flex_none()
              .cursor_pointer()
              .text_color(t.muted)
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => {
                this.ui.selectedKey = null;
                cx.notify();
              })
              .child("‹ Back"),
          )
          .child(div().flex_1().text_size(11).text_color(t.dim).child(`Snapshot ${d.generatedAt} · Esc to close`)),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .px(12)
          .pb(10)
          .gap(6)
          .child(div().font_semibold().child(d.title))
          .children(d.lines.map(([label, value]) => v_flex().child(div().text_size(10.5).text_color(t.dim).child(label)).child(div().text_size(12).child(value))))
          .children(d.notes.map((n) => div().text_size(11).text_color(t.muted).child(n))),
      );
  }
}
