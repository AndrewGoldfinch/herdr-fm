// A chainable stand-in for GPUI elements: any builder method returns the element,
// `.when` runs its callback, and handlers and children are recorded for inspection.
// Recorded data lives under "_" names so it never shadows a builder such as `.children()`.
export function element(kind = "div") {
  const node = { _kind: kind, _children: [], _handlers: {}, _calls: [], _id: null };
  const proxy = new Proxy(node, {
    get(target, prop) {
      if (typeof prop === "string" && prop.startsWith("_")) return target[prop];
      if (prop === "then" || typeof prop === "symbol") return undefined;
      return (...args) => {
        target._calls.push(prop);
        if (prop === "child") target._children.push(args[0]);
        else if (prop === "children") target._children.push(...args[0]);
        else if (prop === "when") return args[0] ? args[1](proxy) : proxy;
        else if (prop.startsWith("on_")) target._handlers[prop] = args[args.length - 1];
        else if (prop === "id") target._id = args[0];
        else if (prop === "hover") args[0](proxy);
        return proxy;
      };
    },
  });
  return proxy;
}

export function walk(node, visit) {
  if (!node || typeof node !== "object" || !Array.isArray(node._children)) return;
  visit(node);
  for (const c of node._children) walk(c, visit);
}

export function text(node) {
  const out = [];
  walk(node, (n) => {
    for (const c of n._children) if (typeof c === "string") out.push(c);
  });
  return out;
}
