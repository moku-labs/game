// Spike P4. The dev JSX runtime. Bun's dev transform may import `jsxDEV` from here instead of `jsx`.
import { FRAGMENT, build, type DescriptionNode, type Key } from "./node";
export type { JSX } from "./jsx-runtime";

(globalThis.__p4Runtimes ??= []).push("p4:jsx-dev-runtime");

export const Fragment = FRAGMENT;

export function jsxDEV(
  type: unknown,
  props: Record<string, unknown>,
  key?: Key,
  _isStatic?: boolean,
  _source?: unknown,
  _self?: unknown
): DescriptionNode {
  return build(type, props, key);
}
