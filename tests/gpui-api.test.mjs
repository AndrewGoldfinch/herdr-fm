import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkSource, stripStringsAndComments } from "./gpui-api-check.mjs";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const mainSrc = readFileSync(new URL("../mods/firstmate-fleet/main.js", import.meta.url), "utf8");

// Every Herdr app version the panel targets, with the revision its surface came from.
const TARGETS = [
  { version: "0.1.10", file: "gpui-surface.json", revision: "8180cbe6c947519e8015dd7c35801a93e08a7d66" },
  { version: "0.1.11", file: "gpui-surface-0.1.11.json", revision: "e12fd31866f33cb613922d0b33ea506e6f23ce3c" },
];
const surface = load(TARGETS[0].file);

for (const target of TARGETS) {
  const s = load(target.file);

  test(`app ${target.version}: the surface was extracted from its pinned revision`, () => {
    assert.equal(s.source.repo, "herdrdev/herdr-app");
    assert.equal(s.source.revision, target.revision);
    assert.ok(s.paramStyles.includes("text_size"));
    assert.ok(s.behaviors.includes("on_key_down"));
    assert.ok(s.jsMethods.includes("when"));
    assert.ok(s.source.shippedFiles > 20);
  });

  test(`app ${target.version}: main.js calls only methods, imports and theme colours that exist`, () => {
    const { problems, calls } = checkSource(mainSrc, s);
    assert.deepEqual(problems, []);
    assert.ok(calls.size > 30, `checked ${calls.size} GPUI method names`);
    // Guard against the check silently reading nothing.
    assert.ok(checkSource(mainSrc.replace("import { exec,", "import { execute,"), s).problems.includes("herdr has no export execute"));
  });
}

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
