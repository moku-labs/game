import { describe, expect, it } from "vitest";
import { component } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import type { MotionHandle, TweenDriver } from "../../projection/types";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the muted fields a driver asks for on every frame (change
// 2026-10-18-cheap-idle-tick, W3). An unmuted component answers one shared empty
// set, the owned fields are found once per type, and a joined set is kept until
// a mute or its release changes it.
// ---------------------------------------------------------------------------

const Plain = component("Plain", { x: 0, y: 0 });
const Caption = component("Caption", { x: 0, y: 0, shown: 0 }, { owned: ["shown"] });
const UI: Owner = { kind: "plugin", name: "ui" };

/** A track handle that never ends. */
const RUNNING: MotionHandle = {
  finish: (): void => {},
  cancel: (): void => {},
  active: (): boolean => true
};

/**
 * Starts one tween on a fresh element and hands back the muted-fields ask its driver got.
 *
 * @param world - The mock world.
 * @param caption - Whether the element carries `Caption` (owned field) or `Plain`.
 * @returns The element and its ask.
 */
function trackedElement(
  world: MockWorld,
  caption: boolean
): { entity: number; muted: () => ReadonlySet<string> } {
  const asks: Array<() => ReadonlySet<string>> = [];
  const driver: TweenDriver = {
    track: (_entity, _component, _to, _options, muted) => {
      asks.push(muted);

      return RUNNING;
    },
    cancelAll: (): void => {}
  };

  world.api.projection.setDriver(driver);

  const entity = world.api.ecs.spawn(UI, [caption ? Caption() : Plain()]);
  const handle = world.api.projection.viewOf(entity, UI);

  if (caption) handle?.tween(Caption, { x: 10 }, { ms: 100, ease: "linear" });
  else handle?.tween(Plain, { x: 10 }, { ms: 100, ease: "linear" });

  return { entity, muted: asks[0] ?? ((): ReadonlySet<string> => new Set(["missing"])) };
}

describe("the muted fields of a track", () => {
  it("are none for a component nobody mutes and nobody owns, one answer for every ask", () => {
    const world = createMockWorld();
    const first = trackedElement(world, false);
    const second = trackedElement(world, false);

    expect([...first.muted()]).toEqual([]);
    expect(first.muted()).toBe(second.muted());
  });

  it("follow a mute and its release, also when they were asked before", () => {
    const world = createMockWorld();
    const { entity, muted } = trackedElement(world, false);

    expect([...muted()]).toEqual([]);

    const release = world.api.projection.mute(entity, Plain, ["y"]);

    expect([...muted()]).toEqual(["y"]);

    release();

    expect([...muted()]).toEqual([]);
  });

  it("are the owned fields of a type nobody mutes, joined with a mute until it is released", () => {
    const world = createMockWorld();
    const { entity, muted } = trackedElement(world, true);

    expect([...muted()]).toEqual(["shown"]);

    const releaseY = world.api.projection.mute(entity, Caption, ["y"]);

    expect([...muted()].toSorted()).toEqual(["shown", "y"]);
    expect(muted()).toBe(muted());

    const releaseX = world.api.projection.mute(entity, Caption, ["x"]);

    expect([...muted()].toSorted()).toEqual(["shown", "x", "y"]);

    releaseY();

    expect([...muted()].toSorted()).toEqual(["shown", "x"]);

    releaseX();

    expect([...muted()]).toEqual(["shown"]);
  });
});
