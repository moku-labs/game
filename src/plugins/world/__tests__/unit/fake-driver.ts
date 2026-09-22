/**
 * @file world plugin — the fake tween driver the projection unit tests install through
 * `setDriver`. Not a test file: the unit project only collects `*.test.ts`. It keeps the contract
 * of the driver seam that V3 `anim` fills: start values are read when the delay ends, every
 * `step` adds the frame delta, the last step writes the exact target, muted fields are never
 * written, and a track whose entity died ends silently.
 */
import type { AnyComponent, EcsApi, Entity } from "../../ecs/types";
import type { Ease, MotionHandle, TrackOptions, TweenDriver } from "../../projection/types";

/** One running track of the fake driver. */
type FakeTrack = {
  entity: Entity;
  component: AnyComponent;
  to: Record<string, number>;
  ms: number;
  ease: Ease;
  delayMs: number;
  elapsed: number;
  from: Record<string, number> | undefined;
  muted: () => ReadonlySet<string>;
  ended: boolean;
};

/** What a test can ask the fake driver about after a hook ran. */
export type StartedTrack = {
  entity: Entity;
  component: string;
  to: Record<string, number>;
  options: TrackOptions;
};

/** The driver plus the two handles a test drives it with. */
export type FakeDriver = TweenDriver & {
  /** Advances every running track by one frame delta. */
  step(deltaMs: number): void;
  /** How many tracks still run. */
  active(): number;
  /** Every `track()` call in call order, for the seam assertions. */
  started: StartedTrack[];
};

/**
 * Eases a normalised time, the named curves of `Ease` plus a function ease.
 *
 * @param ease - The easing to apply.
 * @param t - Normalised time between 0 and 1.
 * @returns The eased fraction.
 */
function applyEase(ease: Ease, t: number): number {
  if (typeof ease === "function") return ease(t);
  if (ease === "in") return t * t;
  if (ease === "out") return 1 - (1 - t) * (1 - t);
  if (ease === "inOut") return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  if (ease === "inCubic") return t ** 3;
  if (ease === "outCubic") return 1 - (1 - t) ** 3;
  if (ease === "inOutCubic") return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  if (ease === "inBack") return 2.701_58 * t ** 3 - 1.701_58 * t * t;
  if (ease === "outBack") return 1 + 2.701_58 * (t - 1) ** 3 + 1.701_58 * (t - 1) ** 2;

  return t;
}

/**
 * Creates the fake driver over the real ecs of the mock world.
 *
 * @param ecs - The ecs API the tracks read and write through.
 * @returns The driver, a `step` and the list of started tracks.
 */
export function createFakeDriver(ecs: EcsApi): FakeDriver {
  const tracks: FakeTrack[] = [];
  const started: StartedTrack[] = [];

  const end = (track: FakeTrack): void => {
    const at = tracks.indexOf(track);

    track.ended = true;
    if (at !== -1) tracks.splice(at, 1);
  };

  const write = (track: FakeTrack, t: number): void => {
    const current = ecs.get(track.entity, track.component);

    if (current === undefined) {
      end(track);

      return;
    }

    track.from ??= Object.fromEntries(
      Object.entries(track.to).map(([field, target]) => {
        const value = current[field];

        return [field, typeof value === "number" ? value : target];
      })
    );

    const muted = track.muted();
    const patch: Record<string, number> = {};

    for (const [field, target] of Object.entries(track.to)) {
      if (muted.has(field)) continue;

      const start = track.from[field] ?? target;

      patch[field] = t >= 1 ? target : start + (target - start) * t;
    }

    if (Object.keys(patch).length > 0) ecs.set(track.entity, track.component, patch);
  };

  return {
    started,

    track: (
      entity: Entity,
      component: AnyComponent,
      to: Record<string, number>,
      options: TrackOptions,
      muted: () => ReadonlySet<string>
    ): MotionHandle => {
      started.push({ entity, component: component.componentName, to: { ...to }, options });

      const track: FakeTrack = {
        entity,
        component,
        to,
        ms: options.ms,
        ease: options.ease ?? "out",
        delayMs: options.delayMs ?? 0,
        elapsed: 0,
        from: undefined,
        muted,
        ended: Object.keys(to).length === 0
      };

      if (!track.ended) tracks.push(track);

      return {
        finish: (): void => {
          if (track.ended) return;

          write(track, 1);
          end(track);
        },
        cancel: (): void => {
          if (track.ended) return;

          end(track);
        },
        active: (): boolean => !track.ended
      };
    },

    cancelAll: (entity: Entity): void => {
      // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
      for (const track of [...tracks]) {
        if (track.entity === entity) end(track);
      }
    },

    step: (deltaMs: number): void => {
      // eslint-disable-next-line unicorn/no-useless-spread -- iterated while mutated
      for (const track of [...tracks]) {
        if (track.ended) continue;

        track.elapsed += deltaMs;

        const remaining = track.elapsed - track.delayMs;

        if (remaining < 0) continue;

        const fraction = track.ms <= 0 ? 1 : Math.min(remaining / track.ms, 1);

        write(track, fraction >= 1 ? 1 : applyEase(track.ease, fraction));

        if (fraction >= 1) end(track);
      }
    },

    active: (): number => tracks.length
  };
}
