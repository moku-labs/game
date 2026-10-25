import { describe, expect, it } from "vitest";
import { NineSlice, Shape, Sprite, Transform } from "../../../renderer/components";
import { component } from "../../../world/ecs/define";
import type { AnyComponent } from "../../../world/ecs/types";
import type { Entity, TweenDriver } from "../../../world/types";
import { Frames } from "../../components";
import { createDriver, startStepTrack } from "../../tween/driver";
import type { MockAnim } from "./mock-anim";
import { createMockAnim, spawnTestEntity } from "./mock-anim";

// ---------------------------------------------------------------------------
// Unit test: endless loops of views an overlay hides write nothing (spec 22 O9.3). The stand-in renderer of the mock
// answers `sync.loopsHeld` from `mock.held`; the clock of a held loop runs on, so it writes the phase of the time when
// it is shown again. Finite tracks always write.
// ---------------------------------------------------------------------------

/**
 * Nothing is muted.
 *
 * @returns An empty field set.
 */
function open(): ReadonlySet<string> {
  return new Set();
}

/**
 * A started mock world with one entity at x 0 and the real driver.
 *
 * @returns The mock, the driver and the entity.
 */
function setup(): { mock: MockAnim; driver: TweenDriver; entity: Entity } {
  const mock = createMockAnim();

  mock.start();

  const entity = spawnTestEntity(mock, [Transform({ x: 0 })]);

  return { mock, driver: createDriver(mock.actx), entity };
}

/**
 * Reads x of an entity.
 *
 * @param mock - The mock anim world.
 * @param entity - The entity.
 * @returns Its x.
 */
function xOf(mock: MockAnim, entity: Entity): number | undefined {
  return mock.world.ecs.get(entity, Transform)?.x;
}

describe("anim — endless loops of held views", () => {
  it("an endless track of a held entity writes nothing and its value on release is the phase of the time that passed", () => {
    const { mock, driver, entity } = setup();

    driver.track(
      entity,
      Transform,
      { x: 100 },
      { ms: 100, ease: "linear", repeat: "forever" },
      open
    );
    mock.frame(25);

    expect(xOf(mock, entity)).toBe(25);

    mock.held.add(entity);
    mock.frame(25);
    mock.frame(25);

    // Held: the loop wrote nothing while its clock ran on to 75 ms.
    expect(xOf(mock, entity)).toBe(25);

    mock.held.delete(entity);
    mock.frame(10);

    // Shown again: the phase of 85 ms, as if it had never been held.
    expect(xOf(mock, entity)).toBe(85);
  });

  it("a finite track of a held entity writes", () => {
    const { mock, driver, entity } = setup();

    mock.held.add(entity);
    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "linear", repeat: 2 }, open);
    mock.frame(50);

    expect(xOf(mock, entity)).toBe(50);
  });

  it("an endless Frames loop of a held entity keeps its texture and shows the frame of the time when released", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [
      Sprite({ texture: "start" }),
      Frames({ keys: ["k0", "k1", "k2", "k3"], fps: 10 })
    ]);
    const texture = (): string | undefined => mock.world.ecs.get(entity, Sprite)?.texture;

    mock.frame(16);

    expect(texture()).toBe("k0");

    mock.held.add(entity);
    mock.frame(100);
    mock.frame(100);

    expect(texture()).toBe("k0");

    mock.held.delete(entity);
    mock.frame(16);

    // 232 ms of the loop: key 2.
    expect(texture()).toBe("k2");
  });

  it("a Frames animation that plays once writes while held", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [
      Sprite({ texture: "start" }),
      Frames({ keys: ["k0", "k1"], fps: 10, loop: false })
    ]);

    mock.held.add(entity);
    mock.frame(150);

    expect(mock.world.ecs.get(entity, Sprite)?.texture).toBe("k1");
  });
});

/** A game's own component: anim cannot know what a system makes of it. */
const Glow = component("test.heldGlow", { amount: 0 });

/**
 * The rule of the renderer for a view at alpha 0 (spec 26 R1.7): held, unless the loop writes the view's alpha.
 *
 * @param mock - The mock anim world.
 * @returns The answer of `sync.loopsHeld` for a sprite.
 */
function heldAtAlphaZero(mock: MockAnim) {
  return (entity: Entity, reveals: "alpha" | "place" | "both" | undefined): boolean =>
    (mock.world.ecs.get(entity, Sprite)?.alpha ?? 1) <= 0 &&
    reveals !== "alpha" &&
    reveals !== "both";
}

describe("anim — what an endless loop reveals (spec 26 R1.7)", () => {
  it("names what a track writes: its place, its alpha, both, or nothing that shows the view", () => {
    const mock = createMockAnim();

    mock.start();

    const driver = createDriver(mock.actx);
    const entity = spawnTestEntity(mock, [
      Transform(),
      Sprite({ texture: "glint" }),
      NineSlice({ texture: "panel", width: 100, height: 100 }),
      Shape({ w: 10, h: 10 }),
      Glow()
    ]);
    const revealsOf = (target: AnyComponent, to: Record<string, number>) => {
      driver.track(entity, target, to, { ms: 100, repeat: "forever" }, open);

      return [...mock.state.tracks.values()].at(-1)?.reveals;
    };

    expect([
      revealsOf(Transform, { rotation: 1 }),
      revealsOf(Sprite, { alpha: 0 }),
      revealsOf(Sprite, { alpha: 0, width: 80 }),
      revealsOf(NineSlice, { height: 120 }),
      revealsOf(Shape, { fill: 0xff_00_00 }),
      revealsOf(Glow, { amount: 1 })
    ]).toEqual(["place", "alpha", "both", "place", undefined, "both"]);
  });

  it("an endless track asks with what it reveals, a timeline's own included (F76); a finite track never asks", () => {
    const { mock, driver, entity } = setup();

    driver.track(entity, Transform, { x: 100 }, { ms: 100, ease: "linear", repeat: 3 }, open);
    mock.frame(25);

    expect(mock.asks).toEqual([]);

    const step = startStepTrack(
      mock.actx,
      entity,
      Transform,
      { y: 50 },
      { ms: 100, repeat: "forever" }
    );

    step.advance(25);
    // The frame step leaves a timeline's track to its step: it asks once, from its own advance.
    mock.frame(25);

    expect(mock.asks).toEqual([{ entity, reveals: "place" }]);

    driver.track(entity, Transform, { rotation: 1 }, { ms: 100, repeat: "forever" }, open);
    mock.frame(25);

    expect(mock.asks).toEqual([
      { entity, reveals: "place" },
      { entity, reveals: "place" }
    ]);
  });

  it("an endless Frames loop asks with its place: a new frame may change the sprite's size", () => {
    const mock = createMockAnim();

    mock.start();

    const entity = spawnTestEntity(mock, [
      Sprite({ texture: "start" }),
      Frames({ keys: ["k0", "k1"], fps: 10 })
    ]);

    mock.frame(16);

    expect(mock.asks).toEqual([{ entity, reveals: "place" }]);
  });

  it("a forever blink of a sprite at alpha 0 keeps writing and shows it again at its crest", () => {
    const mock = createMockAnim();

    mock.start();

    const driver = createDriver(mock.actx);
    const glint = spawnTestEntity(mock, [Sprite({ texture: "glint", alpha: 0 })]);

    mock.rule.answer = heldAtAlphaZero(mock);
    driver.track(glint, Sprite, { alpha: 1 }, { ms: 100, ease: "linear", repeat: "forever" }, open);
    mock.frame(50);
    mock.frame(50);

    expect(mock.world.ecs.get(glint, Sprite)?.alpha).toBe(1);
  });

  it("a held tint loop stands still and shows the phase of the time that passed when its view is seen again", () => {
    const mock = createMockAnim();

    mock.start();

    const driver = createDriver(mock.actx);
    const glint = spawnTestEntity(mock, [Sprite({ texture: "glint", alpha: 0, tint: 0 })]);

    mock.rule.answer = heldAtAlphaZero(mock);
    driver.track(
      glint,
      Sprite,
      { tint: 100 },
      { ms: 100, ease: "linear", repeat: "forever" },
      open
    );
    mock.frame(25);
    mock.frame(25);

    expect(mock.world.ecs.get(glint, Sprite)?.tint).toBe(0);

    mock.world.ecs.set(glint, Sprite, { alpha: 1 });
    mock.frame(10);

    expect(mock.world.ecs.get(glint, Sprite)?.tint).toBe(60);
  });
});
