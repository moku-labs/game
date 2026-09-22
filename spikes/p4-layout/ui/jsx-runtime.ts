// Spike P4. The production JSX runtime that `jsxImportSource: "p4-ui"` resolves to.
import { FRAGMENT, build, type DescriptionNode, type IntrinsicProps, type Key } from "./node";

declare global {
  // eslint-disable-next-line no-var
  var __p4Runtimes: string[] | undefined;
}
(globalThis.__p4Runtimes ??= []).push("p4:jsx-runtime");

export const Fragment = FRAGMENT;

export function jsx(type: unknown, props: Record<string, unknown>, key?: Key): DescriptionNode {
  return build(type, props, key);
}
export const jsxs = jsx;

export namespace JSX {
  export type Element = DescriptionNode;
  export type IntrinsicElements = IntrinsicProps;
  export interface ElementChildrenAttribute {
    children: unknown;
  }
  export type ElementType = keyof IntrinsicProps | ((props: never) => DescriptionNode) | typeof FRAGMENT;
}
