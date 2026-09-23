/**
 * @file The game systems of the board, ordinary systems on the tags the input plugin writes — the
 * engine owns the pointer and the drag, the game owns what they mean. While an item is in the
 * hand, every item it may be merged with is tagged; and the glow over every cell follows the
 * thing on it: cream along the rim under an idle mouse, gold and pulsing on a legal target.
 */
import type { Model, World } from "@moku-labs/game";
import { Exiting, Held, PointerOver, Shape, system } from "@moku-labs/game";
import { rules } from "../rules";
import type { Player } from "../state";
import { tables } from "../tables";
import { Generator, Glow, Highlighted, Item } from "./components";

/**
 * Reads the player tree out of the frame snapshot. The world hands a system plain JSON, because
 * the world knows no game; the game knows its own shape.
 *
 * @param snapshot - The frozen model snapshot of the frame.
 * @returns The player tree.
 */
function playerOf(snapshot: Model.Snapshot): Player {
  return snapshot.player as unknown as Player;
}

/**
 * Tags every item the carried one may be merged with, and untags the rest.
 */
export const highlightLegal = system({
  name: "highlightLegal",
  phase: "input",
  // `Item` first, so the row reads `[entity, item]` and the `Held` tag stays the trailing hole.
  query: [Item, Held],
  run: (held, { world, snapshot }) => {
    for (const [entity] of world.query(Highlighted)) world.untag(entity, Highlighted);

    const state = playerOf(snapshot).merge;

    for (const [, carried] of held) {
      for (const [entity, candidate] of world.query(Item)) {
        if (rules.isLegalMerge(state, carried.cell, candidate.cell, tables)) {
          world.tag(entity, Highlighted);
        }
      }
    }
  }
});

/**
 * What the glow of a cell shows: nothing, the rim under an idle mouse, or a legal target.
 *
 * @example
 * ```ts
 * const state: GlowState = "target";
 * ```
 */
type GlowState = "none" | "hover" | "target";

/** The fields of a `Shape` the glow writes. */
type GlowLook = Partial<(typeof Shape)["defaults"]>;

/** The glow under an idle mouse: a cream rim with a breath of cream inside (design §4). */
const hoverGlow: GlowLook = {
  fill: 0xff_f4_c9,
  fillAlpha: 0.15,
  stroke: 0xff_f4_c9,
  strokeWidth: 10,
  alpha: 0.9
};

/** The glow of a legal target: the cell turns gold (design §4); its alpha pulses. */
const targetGlow: GlowLook = {
  fill: 0xff_d2_4d,
  fillAlpha: 0.45,
  stroke: 0xf2_b4_3d,
  strokeWidth: 10
};

/** One pulse of a legal target: how long it takes and how far the gold dims at its low point. */
const pulse = { ms: 900, low: 0.45 } as const;

/**
 * How opaque the gold of a legal target is at one moment of the game: a slow breath between the
 * low point and full.
 *
 * @param elapsed - The game time, in milliseconds.
 * @returns The alpha of the glow.
 * @example
 * ```ts
 * pulseAlpha(0); // 1
 * ```
 */
function pulseAlpha(elapsed: number): number {
  const wave = 0.5 + 0.5 * Math.cos((2 * Math.PI * elapsed) / pulse.ms);

  return pulse.low + (1 - pulse.low) * wave;
}

/**
 * Whether anything is carried: while it is, only legal targets glow.
 *
 * @param world - The world of the frame.
 * @returns True while a view carries `Held`.
 */
function carrying(world: World.EcsApi): boolean {
  return world.query(Held)[Symbol.iterator]().next().done !== true;
}

/**
 * The glow one thing on the board asks of its cell.
 *
 * @param world - The world of the frame.
 * @param entity - The item or the generator.
 * @param held - Whether anything is carried.
 * @returns The state of the glow of its cell.
 */
function glowStateOf(world: World.EcsApi, entity: World.Entity, held: boolean): GlowState {
  if (world.has(entity, Exiting)) return "none";
  if (held) return world.has(entity, Highlighted) ? "target" : "none";

  return world.has(entity, PointerOver) ? "hover" : "none";
}

/**
 * The glow every cell asks for, from the items and the generators that stand on the cells. A
 * cell nothing asks for is left out.
 *
 * @param world - The world of the frame.
 * @returns The state of the glow of each cell that glows, by address.
 */
function glowsOf(world: World.EcsApi): Map<string, GlowState> {
  const held = carrying(world);
  const states = new Map<string, GlowState>();

  for (const [entity, item] of world.query(Item)) {
    const state = glowStateOf(world, entity, held);

    if (state !== "none") states.set(item.cell, state);
  }

  for (const [entity, generator] of world.query(Generator)) {
    const state = glowStateOf(world, entity, held);

    if (state !== "none") states.set(generator.cell, state);
  }

  return states;
}

/**
 * The fields a glow is written with in one state.
 *
 * @param state - The state of the glow.
 * @param elapsed - The game time, which sets the pulse of a target.
 * @returns The fields of its `Shape`.
 */
function glowLook(state: GlowState, elapsed: number): GlowLook {
  if (state === "hover") return hoverGlow;
  if (state === "target") return { ...targetGlow, alpha: pulseAlpha(elapsed) };

  return { alpha: 0 };
}

/**
 * Whether a glow already shows a look, so an unchanged glow is not written every frame.
 *
 * @param shape - The shape the glow has.
 * @param look - The look it should have.
 * @returns True when every field of the look is already there.
 */
function shows(shape: Readonly<(typeof Shape)["defaults"]>, look: GlowLook): boolean {
  return Object.entries(look).every(
    ([field, value]) => shape[field as keyof typeof shape] === value
  );
}

/**
 * Lights the glow over every cell from the thing on it (design §4, §6 F7). It runs in `animate`,
 * after the tags of `input` and `highlightLegal` of the frame are applied, and writes a glow only
 * when its look changed; a legal target changes every frame, because it pulses.
 */
export const glowCells = system({
  name: "glowCells",
  phase: "animate",
  query: [Glow, Shape],
  run: (glows, { world, time }) => {
    const states = glowsOf(world);

    for (const [entity, glow, shape] of glows) {
      const look = glowLook(states.get(glow.cell) ?? "none", time.elapsed);

      if (!shows(shape, look)) world.set(entity, Shape, look);
    }
  }
});
