/**
 * @file The saw blade of the loader (design §6 A1): the gear icon tinted steel, spinning, on the
 * head of the honey fill, so the bar reads as a log being cut. It is a projection of its own,
 * hosted by the track, because a JSX element carries only what `ui` writes on it; the `spinBlade`
 * system turns it every frame and moves it with the share the session holds.
 */
import type { Model } from "@moku-labs/game";
import { component, Order, system, Transform } from "@moku-labs/game";
import { projection, Sprite } from "../../kit";
import type { Session } from "../../state";
import { fillHead, track } from "./view";

/** The blade: its size, one turn in milliseconds, and the steel it is tinted with. */
const blade = { size: 130, turnMs: 1200, steel: 0xb8_c4_cc } as const;

/** Marks the blade, so `spinBlade` finds it. `turnMs` is how long one turn takes. */
export const Blade = component("Blade", { turnMs: blade.turnMs });

/**
 * The share of the loading the frame snapshot holds.
 *
 * @param snapshot - The frozen model snapshot of the frame.
 * @returns The share, 0..1.
 */
function loadingOf(snapshot: Model.Snapshot): number {
  return (snapshot.session as unknown as Session).loading;
}

/**
 * The angle of the blade at one moment of the game.
 *
 * @param elapsed - The game time, in milliseconds.
 * @param turnMs - How long one turn takes.
 * @returns The rotation in radians, 0..2π.
 * @example
 * ```ts
 * spinAngle(300, 1200); // Math.PI / 2
 * ```
 */
export function spinAngle(elapsed: number, turnMs: number): number {
  return ((elapsed % turnMs) / turnMs) * 2 * Math.PI;
}

/**
 * The blade: one entity in the track's own units, on the middle line of the track and above the
 * fill, which is the track's first child.
 */
export const splashBlade = projection({
  name: "splash.blade",
  layer: "ui",
  from: () => ({ turnMs: blade.turnMs }),
  view: item => [
    Blade({ turnMs: item.turnMs }),
    Sprite({
      texture: "ui.icon-gear",
      width: blade.size,
      height: blade.size,
      fit: "contain",
      tint: blade.steel
    }),
    Transform({ x: fillHead(0), y: track.height / 2 }),
    Order({ value: 2 })
  ]
});

/**
 * Turns the blade and keeps it on the head of the fill. The angle comes from the game time and
 * the place from the committed share, so a frame writes where the blade is, never how far it
 * moved.
 */
export const spinBlade = system({
  name: "spinBlade",
  phase: "animate",
  query: [Blade],
  run: (blades, { world, snapshot, time }) => {
    const x = fillHead(loadingOf(snapshot));

    for (const [entity, value] of blades) {
      world.set(entity, Transform, { x, rotation: spinAngle(time.elapsed, value.turnMs) });
    }
  }
});
