/**
 * @file renderer — the colour helpers the plugins above share: which fields of the built-in
 * visuals hold a `0xrrggbb` colour, and the per-channel mix a tween and a particle tint run
 * (F219). Pure; the mix allocates nothing, so a frame may call it per field.
 */
import type { AnyComponent } from "../world/ecs/types";
import { NineSlice, Shape, Sprite } from "./components";

/**
 * Mixes two `0xrrggbb` colours, linear per channel, each channel rounded to a whole number. A
 * colour mixed as one number borrows across channels: white to grey passes magenta.
 *
 * @param from - The colour at `t` 0.
 * @param to - The colour at `t` 1.
 * @param t - Where between them; read as is, so an overshooting ease is clamped per channel.
 * @returns The `0xrrggbb` colour at `t`, a whole number.
 * @example
 * ```ts
 * mixColor(0xff_ff_ff, 0xc7_c7_c7, 0.5); // 0xe3e3e3
 * ```
 */
export function mixColor(from: number, to: number, t: number): number {
  return (
    (mixChannel(from, to, t, 16) << 16) |
    (mixChannel(from, to, t, 8) << 8) |
    mixChannel(from, to, t, 0)
  );
}

/**
 * One channel of a per-channel mix, rounded and kept inside 0..255.
 *
 * @param from - The colour at `t` 0.
 * @param to - The colour at `t` 1.
 * @param t - Where between them.
 * @param shift - The bit offset of the channel: 16 red, 8 green, 0 blue.
 * @returns The channel, 0..255.
 * @example
 * ```ts
 * mixChannel(0xff_00_00, 0x00_00_00, 0.5, 16); // 128
 * ```
 */
function mixChannel(from: number, to: number, t: number, shift: number): number {
  const start = (from >> shift) & 0xff;
  const end = (to >> shift) & 0xff;
  const value = Math.round(start + (end - start) * t);

  return Math.min(Math.max(value, 0), 0xff);
}

/**
 * Tells whether a field of a component holds a `0xrrggbb` colour: the `tint` of a `Sprite` or a
 * `NineSlice`, the `fill` and the `stroke` of a `Shape`. A game's own component never does, so a
 * field of its own named `fill` stays a number.
 *
 * @param component - The component the field belongs to.
 * @param field - The field name.
 * @returns True for a colour field.
 * @example
 * ```ts
 * isColorField(Sprite, "tint"); // true
 * ```
 */
export function isColorField(component: AnyComponent, field: string): boolean {
  if (component === Sprite || component === NineSlice) return field === "tint";
  if (component === Shape) return field === "fill" || field === "stroke";

  return false;
}
