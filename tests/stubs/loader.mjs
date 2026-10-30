// Resolves Herdr's bare module names to Node stubs for the smoke test.
const STUBS = { "gpui-kit": "./gpui-kit.mjs", "gpui-base": "./gpui-base.mjs", herdr: "./herdr.mjs" };

export async function resolve(specifier, context, next) {
  if (specifier in STUBS) return { url: new URL(STUBS[specifier], import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
