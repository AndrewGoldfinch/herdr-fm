import { element } from "./element.mjs";
export const v_flex = () => element("v_flex");
export const h_flex = () => element("h_flex");
export const InputState = {
  new() {
    const handlers = {};
    return { handlers, text: "", on(name, fn) { handlers[name] = fn; }, value() { return this.text; }, focus() {}, set_value(v) { this.text = v; } };
  },
};
export const Input = { new: () => element("input") };
