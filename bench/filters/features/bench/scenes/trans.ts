/**
 * @file The `trans-*` arms: a REAL scene switch of the engine every turn, the scene being left declaring the arm's
 * transition. Two scenes of the graph (`bench` and `bench-b`), each with one room shaped like a room of `fade`: 40
 * shadowed items, a countdown, an emitter, its own fill. The arm answers the gate of the graph's rest node; the engine
 * builds the other scene aside, takes the picture of the last frame, swaps and plays it over the new scene. The room
 * changes in the swap (the hook of `scenes:changed`), as the views of a real scene do.
 */
import type { Scenes, World } from "../../../../../src/index.ts";
import { fadeRoot } from "./cases";
import type { BenchScene, Stage } from "./types";

/** The kinds of transition, one arm each. */
export const TRANSITION_KINDS = ["fade", "slide", "wipe", "iris", "dissolve"] as const;

/** One kind of transition. */
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

/** The milliseconds the transition takes. */
export const TRANSITION_MS = 400;

/** One turn of an arm: one switch. */
export const TURN_MS = 1000;

/** How far into a turn the switch is asked for: the first turn does not run into the frames the summary drops. */
export const SWITCH_AT_MS = 300;

/** The colour of the room of each scene. */
const ROOM_FILL: Readonly<Record<string, number>> = { bench: 0x1b_2a_6b, "bench-b": 0x8a_2b_5e };

/** The colour of a room of a scene the table does not name. */
const ROOM_FILL_DEFAULT = 0x1b_2a_6b;

/** The transition the next switch plays: the arm on screen writes it, the `leave` of both scenes reads it. */
const playing: { kind: TransitionKind } = { kind: "fade" };

/**
 * What the scenes of the graph show over themselves when they are left: the arm's transition and nothing else, so what
 * is measured is the transition and no veil or loader beside it.
 *
 * @returns The `leave` of a scene.
 */
export function transitionLeave(): Scenes.SceneLeave<never> {
  return { cover: false, loader: false, transition: { kind: playing.kind, ms: TRANSITION_MS } };
}

/**
 * A stage that writes down every view a room spawns, so the room can be taken off the screen whole.
 *
 * @param stage - The stage.
 * @param parts - Takes every entity spawned.
 * @returns The stage.
 */
function tracked(stage: Stage, parts: World.Entity[]): Stage {
  return {
    ...stage,
    spawn: (...components) => {
      const entity = stage.spawn(...components);

      parts.push(entity);

      return entity;
    },
    child: (parent, ...components) => {
      const entity = stage.child(parent, ...components);

      parts.push(entity);

      return entity;
    }
  };
}

/**
 * One arm: the room of the scene on screen, a switch asked for every turn, and the frames of the switch marked.
 *
 * @param kind - The transition the scenes leave with.
 * @returns The scene of the table.
 */
function transScene(kind: TransitionKind): BenchScene {
  return {
    name: `trans-${kind}`,
    stands: `a real scene switch every second, the scene left with a ${kind} of ${TRANSITION_MS} ms: marks switch, swap, end`,
    mount: stage => {
      let parts: World.Entity[] = [];
      let asked = -1;
      let pending = false;
      let endsAt: number | undefined;

      /** Puts the room of a scene on the screen. */
      const raise = (scene: string | undefined): void => {
        parts = [];
        fadeRoot(tracked(stage, parts), ROOM_FILL[scene ?? ""] ?? ROOM_FILL_DEFAULT, 1);
      };

      playing.kind = kind;
      raise(stage.scene());

      return {
        tick: elapsedMs => {
          const turn = Math.floor(elapsedMs / TURN_MS);

          if (turn > asked && elapsedMs % TURN_MS >= SWITCH_AT_MS) {
            asked = turn;
            pending = true;
          }

          // The gate is shut while the engine builds the scene before: ask again the next frame.
          if (pending && stage.switchScene()) {
            pending = false;
            stage.mark("switch");
          }

          if (endsAt !== undefined && stage.now() >= endsAt) {
            endsAt = undefined;
            stage.mark("end");
          }
        },
        swapped: scene => {
          for (const part of parts) stage.despawn(part);

          raise(scene);
          endsAt = stage.now() + TRANSITION_MS;
          stage.mark("swap");
        }
      };
    }
  };
}

/** The arms `trans-fade`, `trans-slide`, `trans-wipe`, `trans-iris` and `trans-dissolve`. */
export const TRANS_SCENES: readonly BenchScene[] = TRANSITION_KINDS.map(kind => transScene(kind));
