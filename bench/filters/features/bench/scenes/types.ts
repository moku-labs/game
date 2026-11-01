/**
 * @file What a scene of the bench is, and the stage it mounts on.
 */
import type { World } from "../../../../../src/index.ts";

/** What a mounted scene does later: `tick` once a frame, `leave` when the next scene comes. */
export type Mounted = {
  /** Called every frame with the milliseconds since the scene mounted. */
  tick?: (elapsedMs: number) => void;
  /** Hands back what the scene changed outside its views. */
  leave?: () => void;
};

/** The stage of a scene: the screen, the views and what else a scene may touch. */
export type Stage = {
  /** The width of the screen in reference units. */
  readonly width: number;
  /** The height of the screen in reference units. */
  readonly height: number;
  /** The count the address named for the scene, `#glow&n=24`, when it did. */
  readonly n: number | undefined;
  /** Spawns a view on the scene's layer, on top of what is there. */
  spawn(...components: readonly World.AnyComponentValue[]): World.Entity;
  /** Spawns a child of a view. */
  child(parent: World.Entity, ...components: readonly World.AnyComponentValue[]): World.Entity;
  /** Writes fields of a component. */
  set<Value extends object>(
    entity: World.Entity,
    component: World.ComponentHandle<Value>,
    patch: Partial<Value>
  ): void;
  /** Takes a view off the screen. */
  despawn(entity: World.Entity): void;
  /** The clock of the game, epoch milliseconds. */
  now(): number;
  /** Draws at a resolution from the next frame on; `undefined` hands it back. A debug page only. */
  setResolution(resolution: number | undefined): number;
  /** Marks this frame in the arm's row and in the perf log. */
  mark(label: string): void;
};

/** One scene of the table. */
export type BenchScene = {
  /** Its name in the `#token` and in a row of numbers. */
  readonly name: string;
  /** One line: what it stands for. */
  readonly stands: string;
  /** Puts the views on the stage. */
  mount(stage: Stage): Mounted | undefined;
};
