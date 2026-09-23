/**
 * @file The look of a thing on the board under the pointer (design §4): an item or the sawmill
 * under an idle mouse lifts, a pressed one squashes, and both go back when the pointer lets go.
 * The input plugin writes the tags (`PointerOver`, `Pressed`, `Held`); a system reads them every
 * frame and plays a short anim tween when the look they ask for changes.
 *
 * The system is registered by a plugin, not listed in the board feature, because it plays
 * animations: a system's own context holds the world, the resources, the snapshot and the time,
 * never `anim`, so the plugin hands it `anim` when it starts. The glows of the cells are written at
 * once and need no tween, so they are an ordinary system of the feature (`glowCells`).
 *
 * The look never interrupts another motion of the view: while the view slides, rises a level,
 * flies home after a drop or plays a node's animation, the look waits until it is still. The view
 * in the hand is left to the input plugin, which owns its pose for the whole drag.
 */
import type { Anim, World } from "@moku-labs/game";
import {
  Animation,
  animPlugin,
  createPlugin,
  Exiting,
  Held,
  PointerOver,
  Pressed,
  system,
  worldPlugin
} from "@moku-labs/game";
import type { Look } from "./animations";
import { lookAnimations } from "./animations";
import { Generator, Item } from "./components";

/**
 * What the system remembers of one view: the look it last played, `"held"` while the view is in
 * the hand, and the handle of the tween it played.
 *
 * @example
 * ```ts
 * const shown: Shown = { look: "hover" };
 * ```
 */
type Shown = { look: Look | "held"; handle?: Anim.PlayHandle };

/**
 * The state of the plugin: what every view of the board shows, and the remover of the system.
 *
 * @example
 * ```ts
 * const state: LookState = { shown: new Map(), off: undefined };
 * ```
 */
type LookState = { shown: Map<World.Entity, Shown>; off: (() => void) | undefined };

/**
 * The look a view asks for now: `"held"` while it is carried, `undefined` while it leaves the
 * board, else pressed, hovered or at rest.
 *
 * @param world - The world of the frame.
 * @param entity - An item or a generator.
 * @returns The look it asks for.
 */
function wantedLook(world: World.EcsApi, entity: World.Entity): Shown["look"] | undefined {
  if (world.has(entity, Exiting)) return undefined;
  if (world.has(entity, Held)) return "held";
  if (world.has(entity, Pressed)) return "pressed";

  return world.has(entity, PointerOver) ? "hover" : "rest";
}

/**
 * Brings one view to the look it asks for. A carried view is remembered as held and its running
 * look is cancelled: an anim step does not read the mute of the input plugin, so a squash still
 * playing would write over the lifted pose. Once it is let go, the settle of the input plugin
 * brings it home, so it counts as at rest. A view that another motion moves keeps its look until
 * it is still.
 *
 * @param world - The world of the frame.
 * @param anim - The anim API that plays the looks.
 * @param shown - What every view shows.
 * @param entity - An item or a generator.
 */
function showLook(
  world: World.EcsApi,
  anim: Anim.AnimApi,
  shown: Map<World.Entity, Shown>,
  entity: World.Entity
): void {
  const wanted = wantedLook(world, entity);
  const before = shown.get(entity) ?? { look: "rest" };
  const last = before.look === "held" && wanted !== "held" ? { look: "rest" as const } : before;

  if (wanted === undefined || wanted === last.look) {
    if (last !== before) shown.set(entity, last);

    return;
  }

  if (wanted === "held") {
    last.handle?.cancel();
    shown.set(entity, { look: "held" });

    return;
  }

  // Another motion moves the view: the look waits for it to end.
  if (world.has(entity, Animation) && last.handle?.active() !== true) {
    shown.set(entity, last);

    return;
  }

  shown.set(entity, { look: wanted, handle: anim.play(lookAnimations[wanted], { thing: entity }) });
}

/**
 * Builds the system that shows the look of every item and generator. It runs in `input`, after
 * the input plugin wrote the tags of the frame, and forgets the views that left the board.
 *
 * @param shown - What every view shows, kept by the plugin.
 * @param anim - The anim API that plays the looks.
 * @returns The system.
 */
function lookSystem(shown: Map<World.Entity, Shown>, anim: Anim.AnimApi) {
  return system({
    name: "boardLook",
    phase: "input",
    query: [Item],
    run: (items, { world }) => {
      const seen = new Set<World.Entity>();

      for (const [entity] of items) seen.add(entity);
      for (const [entity] of world.query(Generator)) seen.add(entity);

      for (const entity of seen) showLook(world, anim, shown, entity);
      for (const entity of shown.keys()) if (!seen.has(entity)) shown.delete(entity);
    }
  });
}

/**
 * Shows the look of the board under the pointer. `onStart` registers the look system with the
 * anim API in hand; `onStop` removes it.
 */
export const boardLookPlugin = createPlugin("boardLook", {
  depends: [worldPlugin, animPlugin],
  createState: (): LookState => ({ shown: new Map(), off: undefined }),
  onStart: ctx => {
    const { ecs } = ctx.require(worldPlugin);

    ctx.state.off = ecs.system(lookSystem(ctx.state.shown, ctx.require(animPlugin)));
  },
  onStop: ({ state }) => {
    state.off?.();
    state.off = undefined;
    state.shown.clear();
  }
});
