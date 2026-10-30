import { readFileSync } from "node:fs";

export const HOME = "/home/captain/firstmate";
export const ROOT = "/home/captain/firstmate";
export const RECEIVED = 1_000_000;

export function fixtureText(name) {
  return readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");
}

export function fixture(name) {
  return JSON.parse(fixtureText(name));
}

export function configText(overrides = {}) {
  return JSON.stringify({
    schema: "firstmate-herdr-panel.config.v2",
    firstmateRoot: ROOT,
    firstmateHome: HOME,
    ...overrides,
  });
}
