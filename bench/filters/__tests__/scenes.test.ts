import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../src/control.ts";
import type { Assets } from "../../../src/index.ts";
import { fakeClock } from "../../../src/testing.ts";
import { diskIo, openPage, type Watched, watch } from "../../../tests/integration/drawn-helpers";
import { benchScene } from "../features/bench/bench.dev";
import { scaleScene, scaleUpScene } from "../features/bench/scenes/cases";
import type { Stage } from "../features/bench/scenes/types";
import game from "../index";
import { ARMS } from "../lib/a26";

/** The bench folder: the manifest and the files of the game. */
const FOLDER = new URL("../", import.meta.url);

/** Every scene the spec and R11 name. */
const EVERY_SCENE = [
  "ballast",
  "slope-0",
  "slope-1",
  "slope-2",
  "slope-4",
  "slope-8",
  "slope-0-mask",
  "slope-1-mask",
  "slope-2-mask",
  "slope-4-mask",
  "slope-8-mask",
  "full",
  "fade",
  "entry",
  "glow",
  "sweep",
  "fog",
  "fog-local",
  "flip",
  "scale",
  "scale-up",
  "lens",
  "promo"
] as const;

/** The running game of a test. */
type App = ReturnType<typeof game.screen>["app"];

const running: App[] = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();

  vi.unstubAllGlobals();
});

/**
 * Starts the bench on the fake page, over Pixi's own objects, and waits for its first scene.
 *
 * @param onPage - Runs once the fake page stands, before the app starts.
 * @returns The app and its frame driver.
 */
async function open(onPage?: () => void): Promise<{ app: App; driver: Watched }> {
  const page = openPage();

  onPage?.();

  const clock = fakeClock(1_000_000);
  const manifest = JSON.parse(
    await readFile(new URL("generated/manifest.json", FOLDER), "utf8")
  ) as Assets.Manifest;
  const { app } = game.screen({
    manifest,
    io: diskIo(FOLDER, manifest),
    renderer: page.renderer,
    clock
  });

  running.push(app);
  await app.start();
  app.flow.run().catch(() => undefined);

  const driver = watch(app, page, clock);

  for (let frame = 0; frame < 200 && app.bench.current() === undefined; frame += 1) {
    await driver.frames(1);
  }

  return { app, driver };
}

/** The warnings a run may log: the fake GPU has no texture system, and the bench is over budget on purpose. */
const EXPECTED = new Set([
  "renderer:upload-failed",
  "effects:pass-budget",
  "effects:full-screen-filters"
]);

/**
 * The warnings and errors the app logged, in words, but for the ones a bench is meant to cause.
 *
 * @param app - The app.
 * @returns Their events.
 */
function complaints(app: App): string[] {
  return app.log
    .trace()
    .filter(entry => entry.level === "warn" || entry.level === "error")
    .map(entry => entry.event)
    .filter(event => !EXPECTED.has(event));
}

describe("every scene", () => {
  // Bug: a scene of the spec is missing from the table, a filter is not registered in the feature,
  // or a tick throws on a stale entity once its loop turns.
  it.each(EVERY_SCENE)("%s mounts, draws and loops without a complaint", async name => {
    const { app, driver } = await open();

    app.bench.show(name, { k: 2 });
    await driver.frames(2);
    expect(app.bench.current()?.scene).toBe(name);
    // Two sprites of the ballast, and the views of the scene on top.
    expect(app.world.ecs.count()).toBeGreaterThan(name === "ballast" ? 1 : 2);

    await driver.frames(260);
    expect(complaints(app)).toEqual([]);
  });

  // Bug: the schedule of the phone names a scene the table does not have: the arm is lost on the run.
  it("the schedule of the phone names only scenes of the table", async () => {
    const { app } = await open();

    expect(app.bench.names()).toEqual(expect.arrayContaining([...ARMS]));
  });
});

describe("the canvas estimate", () => {
  // Bug: a breaker kept as a picture, or two applies counted as two breaks: the slope's N is wrong.
  it.each([0, 1, 2, 4, 8])("slope-%i gives 1 + N, with and without the mask", async count => {
    const { app, driver } = await open();

    app.bench.show(`slope-${count}`, { k: 0 });
    await driver.frames(3);
    expect(app.renderer.stats().canvasPasses).toBe(1 + count);

    app.bench.show(`slope-${count}-mask`);
    await driver.frames(3);
    expect(app.renderer.stats().canvasPasses).toBe(1 + count);
  });

  // Bug: the full-screen filter is kept as a picture, and its break never shows.
  it("full gives 2", async () => {
    const { app, driver } = await open();

    app.bench.show("full", { k: 0 });
    await driver.frames(3);
    expect(app.renderer.stats().canvasPasses).toBe(2);
  });

  // Bug: the views of the arm before stay on screen and add their breaks to this one.
  it("a new scene leaves nothing of the one before", async () => {
    const { app, driver } = await open();

    app.bench.show("slope-8", { k: 0 });
    await driver.frames(3);
    app.bench.show("slope-0");
    await driver.frames(3);
    expect(app.renderer.stats().canvasPasses).toBe(1);
  });
});

describe("the ballast", () => {
  // Bug: the ballast adds a break, and the slope is measured on a wrong N.
  it("runs under any scene, K sprites, and adds no canvas pass", async () => {
    const { app, driver } = await open();

    app.bench.show("slope-2", { k: 0 });
    await driver.frames(2);

    const without = app.world.ecs.count();

    app.bench.show("slope-2", { k: 5 });
    await driver.frames(3);
    expect(app.world.ecs.count()).toBe(without + 5);
    expect(app.renderer.stats().canvasPasses).toBe(3);
  });

  // Bug: the ballast is spawned again with every arm: the GPU clock falls between two arms.
  it("stays through a change of arm, and K holds when the next scene names none", async () => {
    const { app, driver } = await open();

    app.bench.show("slope-1", { k: 4 });
    await driver.frames(2);

    const ballast = app.bench.ballast();

    app.bench.show("full");
    await driver.frames(2);
    expect(app.bench.current()?.k).toBe(4);
    expect(app.bench.ballast()).toEqual(ballast);
  });

  // Bug: `#ballast` on a bare address opens an empty screen.
  it("the ballast scene names its own K when none was given", async () => {
    const { app, driver } = await open();

    app.bench.show("full", { k: 0 });
    app.bench.show("ballast");
    await driver.frames(2);
    expect(app.bench.current()?.k).toBeGreaterThan(0);
  });
});

describe("the scene from the address", () => {
  // Bug: the page opens the default scene whatever the address says.
  it("opens the scene of the #token, K with it, and follows a change of the token", async () => {
    const listeners = new Map<string, () => void>();
    const { app, driver } = await open(() => {
      vi.stubGlobal("location", { hash: "#slope-2&k=3" });
      vi.stubGlobal("addEventListener", (name: string, listener: () => void) =>
        listeners.set(name, listener)
      );
      vi.stubGlobal("removeEventListener", () => undefined);
    });

    expect(app.bench.current()).toMatchObject({ scene: "slope-2", k: 3 });

    vi.stubGlobal("location", { hash: "#full" });
    listeners.get("hashchange")?.();
    await driver.frames(1);
    expect(app.bench.current()?.scene).toBe("full");
  });

  // Bug: a typo in the address leaves a dead page with no word.
  it("warns and opens the ballast for a scene the table does not have", async () => {
    const { app } = await open(() => vi.stubGlobal("location", { hash: "#slope-3" }));

    expect(app.bench.current()?.scene).toBe("ballast");
    expect(complaints(app)).toEqual(["bench:unknown-scene"]);
  });

  // Bug: a typo in the editor's command falls silently into another scene.
  it("show throws for a scene the table does not have, and names the known ones", async () => {
    const { app } = await open();

    expect(() => app.bench.show("slope-3")).toThrow(/No scene "slope-3"[\s\S]*slope-4/);
  });
});

describe("the arms", () => {
  // Bug: the arms never turn, or the row of an arm is lost when it ends.
  it("turns the arms on their slot and keeps one row per finished slot", async () => {
    const { app, driver } = await open();

    app.bench.play(["slope-0", "slope-1"], 0.1, 2);
    await driver.frames(4);
    expect(app.bench.current()?.scene).toBe("slope-0");

    await driver.frames(4);
    expect(app.bench.current()?.scene).toBe("slope-1");

    await driver.frames(6);
    expect(app.bench.current()?.scene).toBe("slope-0");
    expect(app.bench.rows().map(row => [row.scene, row.slot, row.k])).toEqual([
      ["slope-0", 0, 2],
      ["slope-1", 1, 2]
    ]);
    expect(app.bench.rows()[1]?.stats.canvasPasses).toBe(2);
  });

  // Bug: a scene picked by hand during a run is overrun by the next turn of the arms.
  it("a scene shown by hand ends the arms", async () => {
    const { app, driver } = await open();

    app.bench.play(["slope-0", "slope-1"], 0.05);
    app.bench.show("full");
    await driver.frames(10);
    expect(app.bench.current()?.scene).toBe("full");
  });
});

describe("the editor", () => {
  // Bug: the command of the editor reaches no scene, or runs in a release build.
  it("switches the scene through its dev command, and refuses in a release build", async () => {
    const { app } = await open();

    await expect(run(app, benchScene, { scene: "full" })).rejects.toThrow();

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    await run(app, benchScene, { scene: "full", k: 1 });
    expect(app.bench.current()).toMatchObject({ scene: "full", k: 1 });
  });
});

/** What a scene asked of the fake stage: a resolution, or the write of one view. */
type Asked = number | undefined | { entity: number; patch: object };

/**
 * A stage with no views, on a page of resolution 2, that writes down what it is asked.
 *
 * @param asked - Takes what is asked, in order.
 * @returns The stage.
 */
function recordingStage(asked: Asked[]): Stage {
  const views = { spawned: 0 };

  return {
    width: 390,
    height: 844,
    n: undefined,
    spawn: () => {
      views.spawned += 1;

      return views.spawned;
    },
    child: () => 0,
    set: (entity, _component, patch) => {
      asked.push({ entity, patch });
    },
    despawn: () => undefined,
    now: () => 0,
    setResolution: resolution => {
      asked.push(resolution);

      return 2;
    }
  };
}

describe("the scale scene", () => {
  // Bug: the steps are absolute, not of the page's resolution, or the last step stays on the next arm.
  it("steps the page's resolution 1, 0.85, 0.75, 0.85 every 2 s, and hands it back when left", () => {
    const asked: Asked[] = [];
    const mounted = scaleScene.mount(recordingStage(asked));

    asked.length = 0;

    for (const elapsed of [0, 1999, 2000, 4000, 6000, 8000]) mounted?.tick?.(elapsed);

    expect(asked).toEqual([2, 1.7, 1.5, 1.7, 2]);
    mounted?.leave?.();
    expect(asked.at(-1)).toBeUndefined();
  });
});

describe("the scale-up scene", () => {
  // Bug: the fill changes with the step up or after it, so the pictures are never taken low and owe
  // nothing at the step up; it changes every frame, so they stay live; or a loop writes the fill the
  // loop before wrote, so nothing changes. A long frame that jumps a mark loses that mark.
  it("changes every picture once a loop, after the step down and before the step up", () => {
    const asked: Asked[] = [];
    const mounted = scaleUpScene.mount(recordingStage(asked));

    asked.length = 0;

    // The frame at 4300 is a long one: the new loop and its fill change arrive in it together.
    for (const elapsed of [0, 299, 300, 1999, 2000, 3999, 4300, 4316, 5999, 6000, 6016]) {
      mounted?.tick?.(elapsed);
    }

    const writes = asked.filter(call => typeof call === "object");
    const everyPicture = Array.from({ length: 40 }, () => "fill");

    expect(asked.map(call => (typeof call === "object" ? "fill" : call))).toEqual([
      1.5,
      ...everyPicture,
      2,
      1.5,
      ...everyPicture,
      2
    ]);
    expect(new Set(writes.slice(0, 40).map(write => write.entity)).size).toBe(40);
    expect(writes[0]?.patch).not.toEqual(writes[40]?.patch);
  });

  // Bug: the low step stays on the next arm.
  it("hands the resolution back when left", () => {
    const asked: Asked[] = [];
    const mounted = scaleUpScene.mount(recordingStage(asked));

    mounted?.tick?.(0);
    mounted?.leave?.();
    expect(asked.at(-1)).toBeUndefined();
  });
});
