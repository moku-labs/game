import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { type CauseApp, frames, PEAK, startCauseApp, tick } from "../cause-app";

// ---------------------------------------------------------------------------
// Spec 16 U4 (C3, ui side): `ui` decides why an element's motion plays. An element that comes or
// goes with its screen (a mount, an unmount, a restore) has the cause "mount"; one a commit adds
// to or removes from a live tree, and every element of a popup, has the cause "change". A
// `defineMotion({ when: "change" })` plays nothing for "mount"; a default motion plays for both.
// ---------------------------------------------------------------------------

/** Who mounts the screens of the tests. */
const OWNER = { kind: "plugin", name: "test" } as const;

/**
 * The entity of a keyed element, failing the test when it is not mounted.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
function entityOf(app: CauseApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? 0;
}

/**
 * Steps frames and reads the smallest scale an entity was drawn at on the way; 1 when it stood at
 * rest, `undefined` once it is gone.
 *
 * @param app - The running app.
 * @param entity - The entity of the element.
 * @param count - How many frames.
 * @returns The smallest scale seen.
 */
function smallestScale(app: CauseApp, entity: number, count: number): number | undefined {
  let smallest: number | undefined;

  for (let frame = 0; frame < count; frame += 1) {
    app.time.step(16);

    const scale = app.world.ecs.get(entity, Transform)?.scale;

    if (scale !== undefined) smallest = Math.min(smallest ?? scale, scale);
  }

  return smallest;
}

/**
 * Mounts the cards by hand, the way a scene mounts its projections, and runs their first frame.
 *
 * @returns The running app with the cards built.
 */
async function mountedCards(): Promise<CauseApp> {
  const app = await startCauseApp();

  app.world.projection.mount(["cards.screen"], OWNER);
  app.time.step(16);

  return app;
}

/**
 * Taps a local-state button and runs the frame that renders the screen again.
 *
 * @param app - The running app.
 * @param key - The key of the button.
 */
function tapLocal(app: CauseApp, key: string): void {
  app.input.tap(entityOf(app, key));
  app.time.step(16);
}

describe("the cause of an element's motion (spec 16 U4)", () => {
  // Bug (C3): every card of a screen that mounts plays its enter, so a board pops in card by card.
  it("stands a `when: change` card at rest when its screen mounts", async () => {
    const app = await mountedCards();

    expect(app.world.ecs.get(entityOf(app, "card0"), Transform)?.scale).toBe(1);
    expect(smallestScale(app, entityOf(app, "card0"), 5)).toBe(1);

    await app.stop();
  });

  it("still plays a default motion on mount", async () => {
    const app = await mountedCards();

    expect(smallestScale(app, entityOf(app, "plainCard"), 3)).toBeLessThan(1);

    await app.stop();
  });

  it("grows the same card in when a commit adds it to the live tree", async () => {
    const app = await mountedCards();

    frames(app, 20);
    tapLocal(app, "addCard");

    const card = entityOf(app, "card1");

    expect(smallestScale(app, card, 3)).toBeLessThan(1);

    frames(app, 20);

    expect(app.world.ecs.get(card, Transform)?.scale).toBe(1);

    await app.stop();
  });

  // Bug: a card plays its exit over the scene that leaves, and keeps the screen a beat longer.
  it("lets the card leave with no exit when its screen unmounts", async () => {
    const app = await mountedCards();

    frames(app, 20);

    const card = entityOf(app, "card0");

    app.world.projection.unmount(["cards.screen"]);

    // It stands at rest until the screen is gone with the exit of the default card beside it.
    expect(smallestScale(app, card, 30)).toBe(1);
    expect(app.world.ecs.get(card, Transform)).toBeUndefined();

    await app.stop();
  });

  it("plays its exit when a commit removes it", async () => {
    const app = await mountedCards();

    frames(app, 20);

    const card = entityOf(app, "card0");

    tapLocal(app, "dropCards");

    expect(smallestScale(app, card, 3)).toBeLessThan(1);

    await app.stop();
  });

  it("plays the enter and the exit of a popup with `when: change`", async () => {
    const app = await startCauseApp();

    expect(app.flow.gate.answer({ intent: "open" })).toBe(true);
    await tick();
    app.time.step(16);

    const panel = entityOf(app, "popupCard");

    expect(smallestScale(app, panel, 3)).toBeLessThan(1);

    frames(app, 20);
    app.input.tap(entityOf(app, "popupClose"));
    await tick();

    expect(smallestScale(app, panel, 4)).toBeLessThan(1);

    await app.stop();
  });

  // Bug: a restore builds every root again through the mount path, and every card pops in again.
  it("stands the cards at rest after a restore", async () => {
    const app = await mountedCards();

    frames(app, 20);

    const before = entityOf(app, "card0");
    const bookmark = app.flow.bookmark();

    await app.flow.restore(bookmark);
    await app.flow.walk([]);
    await tick();
    app.time.step(16);

    const card = entityOf(app, "card0");

    expect(card).not.toBe(before);
    expect(app.world.ecs.get(card, Transform)?.scale).toBe(1);
    expect(smallestScale(app, card, 5)).toBe(1);

    await app.stop();
  });

  it("starts the loop on mount whatever `when` says", async () => {
    const app = await mountedCards();
    const card = entityOf(app, "card0");
    let widest = 0;

    for (let frame = 0; frame < 30; frame += 1) {
      app.time.step(16);
      widest = Math.max(widest, app.world.ecs.get(card, Transform)?.rotation ?? 0);
    }

    expect(widest).toBeGreaterThan(PEAK / 2);

    await app.stop();
  });
});
