#!/usr/bin/env node
// Reads a herdr-app checkout and writes the mod API surface that tests/gpui-api.test.mjs
// checks main.js against. It only reads files; it runs nothing from the checkout.
//
//   node scripts/extract-gpui-surface.mjs <herdr-app checkout> [revision] > tests/fixtures/gpui-surface.json
//
// Sources, and why each counts as evidence that a name exists:
//   paramStyles   shell/src/style.rs PARAM_STYLES: styles bound by hand, all take an argument
//   behaviors     shell/src/engine/quickjs/mod.rs: element behaviours (on_click, tooltip, id, ...)
//   jsMethods     the same file's prelude: `methods.<name> =` (child, children, when, hover, ...)
//   styledNullary gpui-pre/src/styled.rs: `fn <name>(mut self) -> Self`, reflected as no-argument styles
//   shipped       every `.name(` in defaults/mods and defaults/frame, which herdr-app's own
//                 render tests load (src/mods/render_tests.rs), with whether it was called with arguments
//   herdrExports  defaults/herdr.d.ts `export function`
//   imports       names the shipped mods import from gpui-kit and gpui-base
//   themeColors   the colour names defaults/AGENTS.md lists for theme()
//
// Macro-generated no-argument styles (border_1, size_full, cursor_pointer, ...) are only
// reflected at run time, so for those the shipped mods are the evidence.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2];
if (!root) {
  console.error("usage: extract-gpui-surface.mjs <herdr-app checkout> [revision]");
  process.exit(2);
}
const revision = process.argv[3] ?? null;
const read = (p) => readFileSync(join(root, p), "utf8");
const sorted = (set) => [...set].sort();

function block(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) throw new Error(`marker not found: ${start}`);
  const j = text.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`end not found after: ${start}`);
  return text.slice(i + start.length, j);
}

const STYLE = "vendor/gpui-kit/crates/shell/src/style.rs";
const ENGINE = "vendor/gpui-kit/crates/shell/src/engine/quickjs/mod.rs";
const STYLED = "vendor/gpui-pre/src/styled.rs";
const HERDR_DTS = "defaults/herdr.d.ts";
const AGENTS = "defaults/AGENTS.md";

const paramStyles = new Set();
for (const m of block(read(STYLE), "const PARAM_STYLES: &[(&str, &str)] = &[", "\n];").matchAll(/\(\s*"([a-z_0-9]+)",/g)) paramStyles.add(m[1]);

const engine = read(ENGINE);
const behaviors = new Set();
const behaviorList = block(engine, 'let behaviors = rquickjs::Array::new(ctx.clone())?;', ".into_iter()");
for (const m of behaviorList.matchAll(/"([a-z_0-9]+)"/g)) behaviors.add(m[1]);
const jsMethods = new Set();
for (const m of engine.matchAll(/methods\.([a-z_0-9]+)\s*=/g)) jsMethods.add(m[1]);

const styledNullary = new Set();
for (const m of read(STYLED).matchAll(/fn ([a-z_0-9]+)\(mut self\) -> Self/g)) styledNullary.add(m[1]);

const herdrExports = new Set();
for (const m of read(HERDR_DTS).matchAll(/export function ([A-Za-z_][A-Za-z0-9_]*)/g)) herdrExports.add(m[1]);

// "theme() (every color by name: background (the terminals', cards), canvas (...), ..., ansi0..15;"
const themeText = block(read(AGENTS).replace(/\s+/g, " "), "`theme()` (every color by name:", ";").replace(/\([^)]*\)/g, "");
const themeColors = new Set();
for (const raw of themeText.split(/,|\band\b/)) {
  const name = raw.trim();
  const range = /^ansi(\d+)\.\.(\d+)$/.exec(name);
  if (range) for (let i = Number(range[1]); i <= Number(range[2]); i++) themeColors.add(`ansi${i}`);
  else if (/^[a-z_]+$/.test(name)) themeColors.add(name);
}

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

const shipped = {};
const imports = { "gpui-kit": new Set(), "gpui-base": new Set() };
const files = [...jsFiles("defaults/mods"), ...jsFiles("defaults/frame")].sort();
for (const file of files) {
  const src = read(file);
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"(gpui-kit|gpui-base)"/g)) {
    for (const n of m[1].split(",")) if (n.trim()) imports[m[2]].add(n.trim().split(/\s+as\s+/)[0]);
  }
  for (const m of src.matchAll(/\.([a-z_][a-z0-9_]*)\(\s*(\))?/g)) {
    const e = (shipped[m[1]] ??= { args: false, noArgs: false });
    if (m[2]) e.noArgs = true;
    else e.args = true;
  }
}

const out = {
  source: {
    repo: "herdrdev/herdr-app",
    revision,
    files: [STYLE, ENGINE, STYLED, HERDR_DTS, AGENTS, "defaults/mods/**/*.js", "defaults/frame/**/*.js"],
    shippedFiles: files.length,
  },
  paramStyles: sorted(paramStyles),
  behaviors: sorted(behaviors),
  jsMethods: sorted(jsMethods),
  styledNullary: sorted(styledNullary),
  herdrExports: sorted(herdrExports),
  imports: { "gpui-kit": sorted(imports["gpui-kit"]), "gpui-base": sorted(imports["gpui-base"]) },
  themeColors: sorted(themeColors),
  shipped: Object.fromEntries(Object.keys(shipped).sort().map((k) => [k, shipped[k]])),
};
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
console.error(`${relative(process.cwd(), root) || root}: ${out.paramStyles.length} param styles, ${out.behaviors.length} behaviours, ${out.jsMethods.length} prelude methods, ${out.styledNullary.length} styled fns, ${Object.keys(out.shipped).length} shipped names from ${files.length} files`);
