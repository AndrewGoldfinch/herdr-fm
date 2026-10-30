// Static check of a mod's source against the extracted Herdr/gpui-kit surface
// (tests/fixtures/gpui-surface.json). It proves names and argument presence only:
// not argument types, not which element a method applies to, not layout.

// Blank out comments and string contents; keep code inside template ${...}.
export function stripStringsAndComments(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
      continue;
    }
    if (c === "`") {
      i++;
      out += '""';
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          let expr = "";
          i += 2;
          while (i < src.length) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}" && --depth === 0) break;
            expr += src[i++];
          }
          i++;
          out += ` ${stripStringsAndComments(expr)} `;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const BUILTIN_SOURCES = [Array.prototype, String.prototype, Set.prototype, Map.prototype, Promise.prototype, Object.prototype, Function.prototype, Math, JSON, Date, Number, Object, Promise];
const BUILTINS = new Set(BUILTIN_SOURCES.flatMap((o) => Object.getOwnPropertyNames(o)));
BUILTINS.add("now");

// Not GPUI: the callback context, the controller, and InputState instances.
const CX = ["notify", "spawn", "every", "after", "focus_handle", "stop_propagation"];
const CONTROLLER = ["start", "tick", "refresh", "notifyChange", "dispose", "getState", "configure"];

function ownMethods(src) {
  const own = new Set();
  for (const m of src.matchAll(/^ {2}(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\([^)]*\)\s*\{/gm)) own.add(m[1]);
  return own;
}

function importsFrom(src, module) {
  const names = [];
  for (const m of src.matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"${module}"`, "g"))) {
    for (const n of m[1].split(",")) if (n.trim()) names.push(n.trim().split(/\s+as\s+/)[0]);
  }
  return names;
}

/**
 * @returns {{calls: Map<string, {args: boolean, noArgs: boolean}>, problems: string[]}}
 */
export function checkSource(src, surface) {
  const problems = [];
  const code = stripStringsAndComments(src);
  const skip = new Set([...BUILTINS, ...CX, ...CONTROLLER, ...ownMethods(code)]);
  const param = new Set(surface.paramStyles);
  const flexible = new Set([...surface.behaviors, ...surface.jsMethods]);
  const nullary = new Set(surface.styledNullary);
  const shipped = surface.shipped;

  const calls = new Map();
  for (const m of code.matchAll(/\.([a-z_][a-z0-9_]*)\(\s*(\))?/g)) {
    const name = m[1];
    if (skip.has(name)) continue;
    const e = calls.get(name) ?? { args: false, noArgs: false };
    if (m[2]) e.noArgs = true;
    else e.args = true;
    calls.set(name, e);
  }

  for (const [name, use] of calls) {
    const known = param.has(name) || flexible.has(name) || nullary.has(name) || Object.hasOwn(shipped, name);
    if (!known) {
      problems.push(`.${name}() is not in the gpui-kit/Herdr surface`);
      continue;
    }
    if (use.noArgs && param.has(name) && !shipped[name]?.noArgs) problems.push(`.${name}() needs an argument`);
    const takesNone = !param.has(name) && !flexible.has(name) && !shipped[name]?.args;
    if (use.args && takesNone) problems.push(`.${name}(…) takes no arguments`);
  }

  // Imports are read from the raw source: stripping blanks the module names.
  const herdrImports = importsFrom(src, "herdr");
  if (/from\s+"herdr"/.test(src) && herdrImports.length === 0) problems.push("could not read the herdr import list");
  for (const name of herdrImports) {
    if (!surface.herdrExports.includes(name)) problems.push(`herdr has no export ${name}`);
  }
  for (const module of ["gpui-kit", "gpui-base"]) {
    for (const name of importsFrom(src, module)) {
      if (!surface.imports[module].includes(name)) problems.push(`no shipped mod imports ${name} from ${module}`);
    }
  }
  for (const m of code.matchAll(/\bt\.([a-z_0-9]+)\b/g)) {
    if (!surface.themeColors.includes(m[1])) problems.push(`theme() has no colour ${m[1]}`);
  }
  return { calls, problems: [...new Set(problems)] };
}
