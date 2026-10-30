import { test } from "node:test";
import assert from "node:assert/strict";
import { collectorArgv, createHost, configPathFor, SCRUB, COLLECTOR } from "../mods/firstmate-fleet/host.js";
import { parseConfig } from "../mods/firstmate-fleet/config.js";
import { configText, HOME, ROOT } from "./helpers.mjs";

const cfg = (o) => parseConfig(configText(o)).config;

test("the scrub list covers every path and clock override the reviewed collectors read", () => {
  assert.deepEqual([...SCRUB].sort(), [
    "FM_BEARINGS_NOW",
    "FM_CONFIG_OVERRIDE",
    "FM_CREW_STATE_META_OVERRIDE",
    "FM_CREW_STATE_STATUS_OVERRIDE",
    "FM_DATA_OVERRIDE",
    "FM_PROJECTS_OVERRIDE",
    "FM_ROOT_OVERRIDE",
    "FM_SNAPSHOT_CACHE_DIR",
    "FM_SNAPSHOT_NOW",
    "FM_SNAPSHOT_NOW_EPOCH",
    "FM_STATE_OVERRIDE",
  ]);
});

test("P19: argv unsets every override, pins FM_HOME and runs only the Bearings collector", () => {
  const { command, args, options } = collectorArgv(cfg());
  assert.equal(command, "env");
  assert.deepEqual(options, { cwd: ROOT });
  const scrub = SCRUB.flatMap((n) => ["-u", n]);
  assert.deepEqual(args, [
    ...scrub,
    `FM_HOME=${HOME}`,
    "FM_CREW_STATE_NO_FORGE=1",
    "bash",
    `${ROOT}/${COLLECTOR}`,
    "--json",
    "--fields",
    "paths,endpoints",
  ]);
  assert.equal(COLLECTOR, "bin/fm-bearings-snapshot.sh");
});

test("forge reads are opt-in", () => {
  const { args } = collectorArgv(cfg({ forgeReads: true }));
  assert.equal(args.includes("FM_CREW_STATE_NO_FORGE=1"), false);
  assert.ok(args.includes(`FM_HOME=${HOME}`));
});

test("argv never carries --include-prs, a shell or a -c script", () => {
  for (const forgeReads of [true, false]) {
    const { args } = collectorArgv(cfg({ forgeReads }));
    for (const bad of ["--include-prs", "-c", "sh", "--fields actions"]) assert.equal(args.includes(bad), false, bad);
  }
});

test("P11: shell-looking paths stay inside single argv elements", () => {
  const home = "/home/x/$(reboot); rm -rf ~ `id`";
  const { args } = collectorArgv(cfg({ firstmateHome: home }));
  assert.equal(args.length, SCRUB.length * 2 + 7);
  assert.ok(args.includes(`FM_HOME=${home}`));
});

test("createHost passes the exact argv to exec and reads the hidden config file", async () => {
  const seen = [];
  const host = createHost(
    {
      exec: async (command, args, options) => {
        seen.push({ command, args, options });
        return { code: 0, stdout: "{}", stderr: "" };
      },
      readTextFile: async (path) => {
        seen.push({ path });
        return "text";
      },
    },
    "/cfg/.config.json",
  );
  assert.deepEqual(await host.collect(cfg()), { code: 0, stdout: "{}", stderr: "" });
  assert.deepEqual(seen[0], collectorArgv(cfg()));
  assert.equal(await host.readConfig(), "text");
  assert.deepEqual(seen[1], { path: "/cfg/.config.json" });
});

test("the config path is the mod folder's hidden .config.json", () => {
  assert.equal(configPathFor("/home/captain/.config/herdr-app"), "/home/captain/.config/herdr-app/mods/firstmate-fleet/.config.json");
});
