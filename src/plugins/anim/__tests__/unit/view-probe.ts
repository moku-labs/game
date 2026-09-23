/**
 * @file anim plugin — a view handle over the real tween driver, for the unit tests of motion
 * hooks. Not a test file: the unit project only collects `*.test.ts`. The handle hands a hook's
 * tween to the driver unchanged, the way `world` does, and reads the rest pose from a table the
 * test may change, the way a new item moves the rest pose of a view.
 */
import { Shape, Transform } from "../../../renderer/components";
import type {
  ComponentType,
  Entity,
  Motion,
  MotionHandle,
  TrackOptions,
  ViewHandle
} from "../../../world/types";
import { asComponent } from "../../components";
import { advanceTracks, beginFrame } from "../../tween/advance";
import { createDriver } from "../../tween/driver";
import type { Config } from "../../types";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

/** The rest pose of the probe: a card hung at (540, 300). */
export const REST = { x: 540, y: 300, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };

/** The mock anim world, one entity at rest, the view handle over both and its rest table. */
export type ViewProbe = {
  mock: MockAnim;
  entity: Entity;
  view: ViewHandle<unknown>;
  /** The rest pose per component name. A test replaces an entry to move the rest pose. */
  rests: Record<string, object>;
};

/**
 * Nothing is muted.
 *
 * @returns An empty field set.
 */
function open(): ReadonlySet<string> {
  return new Set();
}

/**
 * Keeps the numeric fields of a rest pose: what `toRest` tweens.
 *
 * @param rest - The rest pose of one component.
 * @returns The numeric fields.
 */
function numericOf(rest: object): Record<string, number> {
  const fields: Record<string, number> = {};

  for (const [field, value] of Object.entries(rest)) {
    if (typeof value === "number") fields[field] = value;
  }

  return fields;
}

/**
 * Creates the probe: an entity with a Transform and a Shape at rest, and a view handle whose
 * `tween` and `toRest` start real tracks.
 *
 * @param options - Config overrides of the anim plugin.
 * @returns The probe.
 */
export function createViewProbe(options: Partial<Config> = {}): ViewProbe {
  const mock = createMockAnim(options);
  const entity = spawnTestEntity(mock, [Transform(REST), Shape({ alpha: 1 })]);
  const driver = createDriver(mock.actx);
  const rests: Record<string, object> = { Transform: REST, Shape: { ...Shape.defaults } };
  const view = {
    entity,
    key: "card",
    get: (component: ComponentType<object>) => mock.world.ecs.get(entity, component),
    rest: (component: ComponentType<object>) => rests[component.componentName],
    set: (component: ComponentType<object>, patch: object): void => {
      mock.world.ecs.set(entity, component, patch);
    },
    tween: (
      component: ComponentType<object>,
      to: Record<string, number>,
      trackOptions: TrackOptions
    ): MotionHandle => driver.track(entity, asComponent(component), to, trackOptions, open),
    toRest: (component: ComponentType<object>, trackOptions: TrackOptions): MotionHandle =>
      driver.track(
        entity,
        asComponent(component),
        numericOf(rests[component.componentName] ?? {}),
        trackOptions,
        open
      ),
    all: (handles: readonly Motion[]): MotionHandle => {
      const real = handles.filter((entry): entry is MotionHandle => entry !== undefined);

      return {
        finish: (): void => {
          for (const entry of real) entry.finish();
        },
        cancel: (): void => {
          for (const entry of real) entry.cancel();
        },
        active: (): boolean => real.some(entry => entry.active())
      };
    },
    peer: () => undefined
  } as unknown as ViewHandle<unknown>;

  return { mock, entity, view, rests };
}

/**
 * Runs one frame step of the track table.
 *
 * @param probe - The probe.
 * @param deltaMs - Milliseconds of the frame.
 */
export function stepProbe(probe: ViewProbe, deltaMs: number): void {
  beginFrame(probe.mock.actx);
  advanceTracks(probe.mock.actx, deltaMs);
}

/**
 * Reads the pose of the probe: the four Transform numbers and the Shape alpha.
 *
 * @param probe - The probe.
 * @returns The pose.
 */
export function poseOf(probe: ViewProbe): Record<string, number | undefined> {
  const transform = probe.mock.world.ecs.get(probe.entity, Transform);

  return {
    x: transform?.x,
    y: transform?.y,
    rotation: transform?.rotation,
    scale: transform?.scale,
    alpha: probe.mock.world.ecs.get(probe.entity, Shape)?.alpha
  };
}
