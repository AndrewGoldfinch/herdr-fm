// The panel's only command: FirstMate's Bearings collector, as an argv array.
// Herdr functions are injected so this module stays testable under Node.

export const COLLECTOR = "bin/fm-bearings-snapshot.sh";

// Inherited variables that redirect the collectors' reads, cache writes or clock.
// Derived from the collectors at FirstMate 355a307; Task 0 re-derives it per checkout.
export const SCRUB = Object.freeze([
  "FM_ROOT_OVERRIDE",
  "FM_STATE_OVERRIDE",
  "FM_DATA_OVERRIDE",
  "FM_CONFIG_OVERRIDE",
  "FM_PROJECTS_OVERRIDE",
  "FM_SNAPSHOT_CACHE_DIR",
  "FM_SNAPSHOT_NOW",
  "FM_SNAPSHOT_NOW_EPOCH",
  "FM_BEARINGS_NOW",
  "FM_CREW_STATE_META_OVERRIDE",
  "FM_CREW_STATE_STATUS_OVERRIDE",
]);

/** @param {import("./config.js").PanelConfig} config */
export function collectorArgv(config) {
  const args = [];
  for (const name of SCRUB) args.push("-u", name);
  args.push(`FM_HOME=${config.firstmateHome}`);
  if (!config.forgeReads) args.push("FM_CREW_STATE_NO_FORGE=1");
  args.push("bash", `${config.firstmateRoot}/${COLLECTOR}`, "--json", "--fields", "paths,endpoints");
  return { command: "env", args, options: { cwd: config.firstmateRoot } };
}

/** The literal "mods/firstmate-fleet/" lets `mod.clone` rewrite the path for a clone. */
export function configPathFor(appHome) {
  return `${appHome}/mods/firstmate-fleet/.config.json`;
}

/**
 * @param {{exec: Function, readTextFile: Function}} herdr
 * @param {string} configPath
 */
export function createHost(herdr, configPath) {
  return {
    collect(config) {
      const { command, args, options } = collectorArgv(config);
      return herdr.exec(command, args, options);
    },
    readConfig() {
      return herdr.readTextFile(configPath);
    },
  };
}
