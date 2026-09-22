// Spike P4. The description node: what JSX produces. Plain data, no class, no closure, no Pixi.
import type { Style } from "../styles";

export type Key = string;

/** One node of the description tree. `children` is already flattened. */
export type DescriptionNode = {
  type: string;
  key: Key | undefined;
  props: Record<string, unknown>;
  children: DescriptionNode[];
};

export type StateFlags = { active?: boolean; disabled?: boolean; selected?: boolean };
export type LocalPatch = Record<string, unknown>;

export type BoxProps = { key?: Key; style: Style; nineSlice?: string; local?: LocalPatch; children?: unknown };
export type TextProps = { key?: Key; style: Style; state?: StateFlags; content: string; bitmap?: boolean };
export type ImageProps = { key?: Key; style: Style; texture: string };
export type ButtonProps = {
  key?: Key;
  style: Style;
  state?: StateFlags;
  intent?: string;
  payload?: Record<string, unknown>;
  local?: LocalPatch;
  children?: unknown;
};
export type ListProps = { key?: Key; style: Style; children?: unknown };

export type IntrinsicProps = {
  box: BoxProps;
  text: TextProps;
  image: ImageProps;
  button: ButtonProps;
  list: ListProps;
};

export const FRAGMENT = "fragment";

type Child = DescriptionNode | string | number | boolean | null | undefined | Child[];

/** Flattens nested arrays, drops booleans and null, and lifts fragments into their parent. */
export function flatten(children: unknown): DescriptionNode[] {
  const out: DescriptionNode[] = [];
  const visit = (child: Child): void => {
    if (child === null || child === undefined || typeof child === "boolean") return;
    if (Array.isArray(child)) {
      for (const item of child) visit(item);
      return;
    }
    if (typeof child === "string" || typeof child === "number") {
      out.push({ type: "text", key: undefined, props: { content: String(child), style: {} }, children: [] });
      return;
    }
    if (child.type === FRAGMENT) {
      for (const item of child.children) out.push(item);
      return;
    }
    out.push(child);
  };
  visit(children as Child);
  return out;
}

/** Builds one node. A function type is a component and is called at once: the tree holds intrinsics only. */
export function build(type: unknown, props: Record<string, unknown>, key: Key | undefined): DescriptionNode {
  if (typeof type === "function") {
    const result = (type as (p: Record<string, unknown>) => DescriptionNode)(props);
    return key === undefined ? result : { ...result, key };
  }
  const { children, ...rest } = props;
  return { type: String(type), key, props: rest, children: flatten(children) };
}
