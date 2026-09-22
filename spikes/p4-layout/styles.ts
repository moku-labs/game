// Spike P4. Typed style objects: the flexbox vocabulary, flat tokens, `is` and `when` variants.

export type Length = number | `${number}%` | "auto";

export type Flex = {
  direction?: "row" | "column";
  wrap?: boolean;
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  align?: "start" | "center" | "end" | "stretch";
  gap?: number;
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number;
  width?: Length;
  height?: Length;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  grow?: number;
  shrink?: number;
  position?: "absolute" | "relative";
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  aspect?: number;
  overflow?: "visible" | "hidden";
};

export type Visual = { fill?: number; stroke?: number; radius?: number; alpha?: number; fontSize?: number };

export type FlatStyle = Flex & Visual;

export type StateName = "pressed" | "disabled" | "active" | "selected";
export type ViewportFlag = "landscape" | "portrait";

export type Style = FlatStyle & {
  is?: Partial<Record<StateName, FlatStyle>>;
  when?: Partial<Record<ViewportFlag, FlatStyle>>;
};

export type Viewport = { width: number; height: number; landscape: boolean };

/** One flat token object. Two-layer tokens are out of the spike (risk R2). */
export const tokens = {
  space: { 1: 8, 2: 16, 3: 24, 4: 32, 6: 48 },
  color: { panel: 0x2a2f45, accent: 0x5468d4, accentDark: 0x3a4a9c, text: 0xf0f0f0, muted: 0x8a90a8, danger: 0xd45454, row: 0x1e2236, rowAlt: 0x232840 },
  radius: { s: 6, m: 12, l: 20 },
  font: { s: 20, m: 28, l: 40 }
} as const;

const KEYS_STATE: readonly StateName[] = ["pressed", "disabled", "active", "selected"];

/** Resolves a style for one state and one viewport: base, then `when` branches, then `is` branches. */
export function resolve(style: Style, state: Partial<Record<StateName, boolean>>, viewport: Viewport): FlatStyle {
  const { is, when, ...base } = style;
  let flat: FlatStyle = { ...base };
  const flag: ViewportFlag = viewport.landscape ? "landscape" : "portrait";
  if (when?.[flag]) flat = { ...flat, ...when[flag] };
  for (const name of KEYS_STATE) {
    if (state[name] && is?.[name]) flat = { ...flat, ...is[name] };
  }
  return flat;
}

/** Which `when` branch would apply. Used by measure.ts for `variantMisses`. */
export function activeBranch(style: Style, viewport: Viewport): FlatStyle | undefined {
  return style.when?.[viewport.landscape ? "landscape" : "portrait"];
}
