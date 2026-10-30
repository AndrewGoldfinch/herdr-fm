// Herdr stub; each test installs behaviour on globalThis.__herdr.
const h = () => globalThis.__herdr;
export const exec = (...args) => h().exec(...args);
export const readTextFile = (...args) => h().readTextFile(...args);
export const watchFolder = (...args) => h().watchFolder(...args);
export const appHome = () => "/tmp/herdr-app";
export const theme = () => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `#${k}` : undefined) });
