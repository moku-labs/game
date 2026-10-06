import { describe, expect, it } from "vitest";
import { Transform } from "../../../renderer/components";
import { Text } from "../../../text/components";
import { Exiting } from "../../../world/ecs/define";
import { Box, UiCounters } from "../../components";
import { type ExtrasApp, startExtrasApp, Tally } from "../extras-app";

// ---------------------------------------------------------------------------
// Integration: a text with `bind` is sized by the string text shows for it
// (14-ui Delta 10 Part A, design §1). Real world, text and Yoga; plain Bun,
// inert renderer, no font loaded: a digit of `digits` measures 19.2, and ui
// rounds a measured text up to whole units, so "9" is 20 wide and "10" is 39.
// ---------------------------------------------------------------------------

/**
 * Mounts the bound screen and runs its first frame: the reconcile and the first solve.
 *
 * @returns The running app, the screen solved once and `text` not run on it yet.
 */
async function mountBound(): Promise<ExtrasApp> {
  const app = await startExtrasApp();

  app.world.projection.mount(["boundScreen"], { kind: "plugin", name: "test" });
  app.time.step(16);

  return app;
}

/**
 * The rect of a keyed element, in root coordinates.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns Its `Box`.
 */
function rectOf(app: ExtrasApp, key: string) {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key) ?? 0;

  return app.world.ecs.get(entity, Box) ?? { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * The string `text` shows for the bound counter.
 *
 * @param app - The running app.
 * @returns `Text.resolved`.
 */
function shown(app: ExtrasApp): string | undefined {
  return app.world.ecs.get(app.ui.find("bound") ?? 0, Text)?.resolved;
}

/**
 * Writes the counter the way a roll does, one frame of the track, and steps that frame.
 *
 * @param app - The running app.
 * @param value - The value the track writes.
 */
function roll(app: ExtrasApp, value: number): void {
  app.world.ecs.set(app.ui.find("bound") ?? 0, Tally, { value });
  app.time.step(16);
}

describe("a bound text sized by the string it shows", () => {
  it("gets a rect on its first solve, centred like the same number as content", async () => {
    const app = await mountBound();
    const bound = rectOf(app, "bound");
    const plain = rectOf(app, "plain");
    const boundRow = rectOf(app, "boundRow");
    const plainRow = rectOf(app, "plainRow");

    expect(bound.w).toBe(20);
    expect([bound.w, bound.h]).toEqual([plain.w, plain.h]);
    expect(bound.x - boundRow.x).toBe(plain.x - plainRow.x);
    expect(bound.x + bound.w / 2 - boundRow.x).toBe(150);

    await app.stop();
  });

  it("draws the number from half its width left of the row centre, not from the centre", async () => {
    const app = await mountBound();

    app.time.step(16);

    const pose = app.world.ecs.get(app.ui.find("bound") ?? 0, Transform);
    const bound = rectOf(app, "bound");
    const row = rectOf(app, "boundRow");

    expect(shown(app)).toBe("9");
    expect((pose?.x ?? 0) - (pose?.pivot.x ?? 0)).toBe(bound.x - row.x);
    expect(bound.x - row.x).toBe(140);

    await app.stop();
  });

  it("asks for no second solve when text first resolves the string it was measured with", async () => {
    const app = await mountBound();
    const solves = app.world.ecs.resource(UiCounters).solves;

    expect(shown(app)).toBe("");

    app.time.step(16);

    expect(shown(app)).toBe("9");
    expect(app.world.ecs.resource(UiCounters).solves).toBe(solves);

    await app.stop();
  });

  it("re-measures when the shown string grows from 9 to 10, and solves nothing while it stands", async () => {
    const app = await mountBound();

    app.time.step(16);

    const counters = app.world.ecs.resource(UiCounters);
    const solves = counters.solves;
    const nine = rectOf(app, "bound");

    // 9.4 still shows "9": text writes nothing, ui solves nothing.
    roll(app, 9.4);

    expect(shown(app)).toBe("9");
    expect(counters.solves).toBe(solves);
    expect(rectOf(app, "bound")).toEqual(nine);

    // 10 shows "10": one solve, the rect grows around the same centre.
    roll(app, 10);

    const ten = rectOf(app, "bound");

    expect(shown(app)).toBe("10");
    expect(counters.solves).toBe(solves + 1);
    expect(ten.w).toBe(39);
    expect(ten.x + ten.w / 2).toBe(nine.x + nine.w / 2);

    // 11 shows "11": a new string of the same width, so still one solve.
    roll(app, 11);

    expect(shown(app)).toBe("11");
    expect(counters.solves).toBe(solves + 1);
    expect(rectOf(app, "bound")).toEqual(ten);

    await app.stop();
  });

  it("solves nothing for a bound text that is leaving, while its number still changes", async () => {
    const app = await mountBound();

    app.time.step(16);

    const entity = app.ui.find("bound") ?? 0;
    const counters = app.world.ecs.resource(UiCounters);

    app.input.tap(app.ui.find("hideBound") ?? 0);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.has(entity, Exiting)).toBe(true);

    const solves = counters.solves;

    app.world.ecs.set(entity, Tally, { value: 10 });
    app.time.step(16);

    expect(app.world.ecs.get(entity, Text)?.resolved).toBe("10");
    expect(counters.solves).toBe(solves);

    await app.stop();
  });
});
