// Herdr stub; each test installs behaviour on globalThis.__herdr.
const h = () => globalThis.__herdr;
export const exec = (...args) => h().exec(...args);
export const readTextFile = (...args) => h().readTextFile(...args);
export const watchFolder = (...args) => h().watchFolder(...args);
// App 0.1.16 adds checking(); an older app behaves as if it returned false.
export const checking = (...args) => (h().checking ? h().checking(...args) : false);
export const appHome = () => "/tmp/herdr-app";
export const theme = () => new Proxy({}, { get: (_t, k) => (typeof k === "string" ? `#${k}` : undefined) });
