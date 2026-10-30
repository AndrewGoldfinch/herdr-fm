import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSource, stripStringsAndComments } from "./gpui-api-check.mjs";

const surface = JSON.parse(readFileSync(new URL("./fixtures/gpui-surface.json", import.meta.url), "utf8"));
const mainSrc = readFileSync(new URL("../mods/firstmate-fleet/main.js", import.meta.url), "utf8");

test("the surface was extracted from the pinned Herdr app revision", () => {
  assert.equal(surface.source.repo, "herdrdev/herdr-app");
  assert.equal(surface.source.revision, "8180cbe6c947519e8015dd7c35801a93e08a7d66");
  assert.ok(surface.paramStyles.includes("text_size"));
  assert.ok(surface.behaviors.includes("on_key_down"));
  assert.ok(surface.jsMethods.includes("when"));
  assert.ok(surface.source.shippedFiles > 20);
});

test("main.js calls only methods, imports and theme colours that exist", () => {
  const { problems, calls } = checkSource(mainSrc, surface);
  assert.deepEqual(problems, []);
  assert.ok(calls.size > 30, `checked ${calls.size} GPUI method names`);
  // Guard against the check silently reading nothing.
  assert.ok(checkSource(mainSrc.replace('import { exec,', 'import { execute,'), surface).problems.includes("herdr has no export execute"));
});

test("only main.js imports herdr or gpui modules", () => {
  for (const file of ["config.js", "decode.js", "project.js", "controller.js", "host.js", "view-model.js"]) {
    const src = readFileSync(new URL(`../mods/firstmate-fleet/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /from\s+"(herdr|gpui-kit|gpui-base)"/, file);
  }
});

test("the checker catches unknown methods, wrong argument use, bad imports and colours", () => {
  const bad = `
    import { View, div, panel } from "gpui-kit";
    import { exec, runShell } from "herdr";
    export default class X extends View {
      render() {
        const t = theme();
        return div().text_colour(t.foreground).px().border_1(2).bg(t.red).child("x.fake_method() in a string");
      }
    }`;
  const { problems } = checkSource(bad, surface);
  assert.deepEqual(problems.sort(), [
    ".border_1(…) takes no arguments",
    ".px() needs an argument",
    ".text_colour() is not in the gpui-kit/Herdr surface",
    "herdr has no export runShell",
    "no shipped mod imports panel from gpui-kit",
    "theme() has no colour red",
  ]);
});

test("strings and comments are ignored; template expressions are kept", () => {
  const code = stripStringsAndComments('a("x.y()"); // .z()\n b(`${c.d()} .e()`); /* .f() */');
  assert.match(code, /c\.d\(\)/);
  assert.doesNotMatch(code, /\.y\(|\.z\(|\.e\(|\.f\(/);
});
