import { describe, expect, it, vi } from "vitest";
import { lookupTexture } from "../../api";
import { createHandlers } from "../../handlers";
import type { Config, Events, LookAhead, Manifest } from "../../types";
import type { MockAssets } from "./mock-assets";
import { createMockAssets, manifestOf } from "./mock-assets";

// F198 row 3: `releaseUndrawnS` unloads a loaded bundle that went N game seconds with nothing drawing it and nothing
// keeping it. The pass runs inside the system `assets.leave`, once a second, on the frame clock `ctx.time.elapsed`.

/** The warning of the loop guard. */
const ASKED = "assets: a view asked again for a bundle the budget unloaded";

/** One lazy bundle with one key: nothing keeps it by its tier. */
const one = manifestOf({ alpha: { feature: "alpha", tier: "lazy", keys: ["alpha.bg"] } });

/**
 * Lets every running load settle: the fake io answers at once, so one macrotask is enough.
 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Starts the plugin over the fakes with the system `assets.leave` registered, and loads bundles through the API.
 *
 * @param options - Config overrides.
 * @param manifest - The manifest; one lazy bundle `alpha` by default.
 * @param load - The bundles to load once started.
 * @returns The mock plugin.
 */
async function loaded(
  options: Partial<Config>,
  manifest: Manifest = one,
  load: readonly string[] = ["alpha"]
): Promise<MockAssets> {
  const mock = createMockAssets({ manifest, preloadDepth: 0, ...options });

  await mock.start();
  mock.connect();

  for (const name of load) await mock.api.load(name);

  await settle();

  return mock;
}

/**
 * Runs one frame of phase `sync` at a game time.
 *
 * @param mock - The mock plugin.
 * @param seconds - The frame clock in seconds; `ctx.time.elapsed` is milliseconds.
 */
function tick(mock: MockAssets, seconds: number): void {
  mock.world.time.elapsed = seconds * 1000;
  mock.world.sync();
}

/**
 * Runs one frame per second, both ends included.
 *
 * @param mock - The mock plugin.
 * @param from - The first second.
 * @param to - The last second.
 */
function run(mock: MockAssets, from: number, to: number): void {
  for (let second = from; second <= to; second += 1) tick(mock, second);
}

/**
 * The bundles the pass unloaded, in order.
 *
 * @param mock - The mock plugin.
 * @returns The bundle names.
 */
function undrawnUnloads(mock: MockAssets): string[] {
  return mock.emitted
    .filter(
      entry =>
        entry.name === "assets:bundle-unloaded" &&
        (entry.payload as Events["assets:bundle-unloaded"]).reason === "undrawn"
    )
    .map(entry => (entry.payload as Events["assets:bundle-unloaded"]).bundle);
}

/**
 * How many times the plugin warned one message.
 *
 * @param mock - The mock plugin.
 * @param message - The message.
 * @returns The count.
 */
function warnings(mock: MockAssets, message: string): number {
  return (mock.log.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
    call => call[0] === message
  ).length;
}

describe("U1: the field is absent", () => {
  // Bug: the mode is on by default, so a game that never asked loses bundles it kept for the budget alone.
  it("leaves a loaded, undrawn, unkept bundle alone for 60 seconds", async () => {
    const mock = await loaded({});

    run(mock, 0, 60);

    expect(mock.api.isLoaded("alpha")).toBe(true);
    expect(undrawnUnloads(mock)).toEqual([]);
  });
});

describe("U2: releaseUndrawnS counts game seconds", () => {
  // Bug: an off-by-one at the boundary of N, or the seconds read as milliseconds (20 ms would release at 1 s).
  it("keeps the bundle through 19 s, unloads it at 20 s with the reason undrawn, and says which bundle", async () => {
    const mock = await loaded({ releaseUndrawnS: 20 });

    run(mock, 0, 19);

    expect(mock.api.isLoaded("alpha")).toBe(true);

    tick(mock, 20);

    expect(mock.api.isLoaded("alpha")).toBe(false);
    expect(mock.emitted.at(-1)).toEqual({
      name: "assets:bundle-unloaded",
      payload: { bundle: "alpha", tier: "lazy", mb: 0.063, reason: "undrawn", keys: ["alpha.bg"] }
    });
  });

  // Bug: a frame between two checks counted as a check, so a long frame gap or a late first frame shortened the wait.
  it("does not release between two checks: a frame 999 ms after a check changes nothing", async () => {
    const mock = await loaded({ releaseUndrawnS: 20 });

    run(mock, 0, 19);
    mock.world.time.elapsed = 19_999;
    mock.world.sync();

    expect(mock.api.isLoaded("alpha")).toBe(true);
  });
});

describe("U3 and U10: zero is on, and needs two checks in a row", () => {
  // Bug: 0 read as "off", so `releaseUndrawnS: 0` never released anything.
  it("with 0 the bundle goes by the second check", async () => {
    const mock = await loaded({ releaseUndrawnS: 0 });

    run(mock, 0, 1);

    expect(undrawnUnloads(mock)).toEqual(["alpha"]);
  });

  // Bug: the first step of a `load` effect was freed before the next step could draw it: the first check found the
  // bundle undrawn and released it at once.
  it("with 0 the first check only starts the count", async () => {
    const mock = await loaded({ releaseUndrawnS: 0 });

    tick(mock, 0);

    expect(mock.api.isLoaded("alpha")).toBe(true);

    // 999 ms later no check runs yet; the second check, a second after the first, releases.
    mock.world.time.elapsed = 999;
    mock.world.sync();

    expect(mock.api.isLoaded("alpha")).toBe(true);

    tick(mock, 1);

    expect(mock.api.isLoaded("alpha")).toBe(false);
  });
});

describe("U4: a drawn bundle", () => {
  // Bug: the drawn check is missing, so the pass unloads what a view shows (a magenta placeholder, then F184 churn).
  it("is never unloaded while a view draws it", async () => {
    const mock = await loaded({ releaseUndrawnS: 5 });

    mock.renderer.drawn = new Set(["alpha.bg"]);
    run(mock, 0, 60);

    expect(mock.api.isLoaded("alpha")).toBe(true);
    expect(undrawnUnloads(mock)).toEqual([]);
  });

  // Bug: the timer is not reset by a draw: a bundle undrawn at 0-10 s, drawn for 11-15 s and undrawn again goes at
  // 20 s on the old count instead of 20 s after the draw ended.
  it("restarts the count when a view drew it in between", async () => {
    const mock = await loaded({ releaseUndrawnS: 20 });

    run(mock, 0, 10);
    mock.renderer.drawn = new Set(["alpha.bg"]);
    run(mock, 11, 15);
    mock.renderer.drawn = new Set();
    // The first check that finds it undrawn again is at 16 s: it goes at 36 s.
    run(mock, 16, 35);

    expect(mock.api.isLoaded("alpha")).toBe(true);

    tick(mock, 36);

    expect(mock.api.isLoaded("alpha")).toBe(false);
  });
});

/** A look-ahead that names alpha, as the last walk of a rest does. */
function walkNaming(mock: MockAssets): LookAhead {
  return {
    flow: "main",
    node: "board",
    frames: [],
    player: {},
    session: {},
    graph: {},
    manifest: mock.ctx.state.manifest,
    scenes: new Map(),
    depth: 2,
    ordered: ["alpha"]
  };
}

/** What keeps alpha, one rule each; the check that breaks it is the rule it names. */
const keeps: ReadonlyArray<readonly [string, (mock: MockAssets) => void]> = [
  [
    "pinned",
    mock => {
      mock.ctx.state.pinned.add("alpha");
    }
  ],
  [
    "named by the mounted scene",
    mock => {
      mock.api.sceneBundles(["alpha"]);
    }
  ],
  [
    "named by the coming scene",
    mock => {
      mock.api.sceneComing(["alpha"]);
    }
  ],
  [
    "named by a leaving scene whose elements still exit",
    mock => {
      mock.ctx.state.sceneLeaving = ["alpha"];
      mock.ctx.state.exiting = 1;
    }
  ],
  [
    "rested on through ready",
    mock => {
      mock.ctx.state.readyWaiting.set("alpha", 0);
    }
  ],
  [
    "held after a reload",
    mock => {
      mock.ctx.state.reloadHeld.add("alpha");
    }
  ],
  [
    "in the preload queue",
    mock => {
      mock.ctx.state.queue = { bundles: ["alpha"], controller: new AbortController() };
    }
  ],
  [
    "in the last look-ahead walk",
    mock => {
      mock.ctx.state.lookAhead = walkNaming(mock);
    }
  ]
];

describe("U5: what keeps a bundle", () => {
  // Bug: one keep rule is missing from the pass, so the bundle the rule protects is unloaded while the game needs it.
  it.each(keeps)("%s", async (_name, hold) => {
    const mock = await loaded({ releaseUndrawnS: 5 });

    hold(mock);
    run(mock, 0, 30);

    expect(mock.api.isLoaded("alpha")).toBe(true);
    expect(undrawnUnloads(mock)).toEqual([]);
  });

  // Bug: a boot or core bundle, which stays for the session, is unloaded by the pass.
  it.each(["boot", "core"])("the %s tier", async tier => {
    const mock = await loaded(
      { releaseUndrawnS: 5 },
      manifestOf({ alpha: { feature: "alpha", tier, keys: ["alpha.bg"] } })
    );

    run(mock, 0, 30);

    expect(mock.api.isLoaded("alpha")).toBe(true);
    expect(undrawnUnloads(mock)).toEqual([]);
  });

  // Bug: the pass counts a loading bundle: the count starts at the first check and the bundle goes at the first check
  // after it landed, never having been looked at loaded.
  it("a bundle still loading starts its count when it lands, not when its load began", async () => {
    const mock = createMockAssets({ manifest: one, preloadDepth: 0, releaseUndrawnS: 20 });

    await mock.start();
    mock.connect();
    mock.io.control.gated = true;

    const loading = mock.api.load("alpha");

    run(mock, 0, 30);

    expect(mock.ctx.state.records.get("alpha")?.status).toBe("loading");

    mock.io.control.gated = false;
    mock.io.releaseAll();
    await loading;
    tick(mock, 31);

    expect(mock.api.isLoaded("alpha")).toBe(true);
  });
});

describe("U6: a fast walk and a headless run", () => {
  // Bug: a fast walk, which shows nothing to anybody, frees the bundles the replay still needs.
  it("a fast flow mode releases nothing, and the same bundle goes once the mode is live", async () => {
    const mock = await loaded({ releaseUndrawnS: 5 });

    mock.flow.mode = "fast";
    run(mock, 0, 30);

    expect(mock.api.isLoaded("alpha")).toBe(true);

    mock.flow.mode = "live";
    run(mock, 31, 36);

    expect(undrawnUnloads(mock)).toEqual(["alpha"]);
  });

  // Bug: a headless replay (no io, nothing on the GPU) unloads a bundle: records churn for nothing.
  it("headless releases nothing", async () => {
    const mock = await loaded({ releaseUndrawnS: 5 });

    mock.ctx.state.io = undefined;
    run(mock, 0, 30);

    expect(mock.ctx.state.records.get("alpha")?.status).toBe("loaded");
    expect(undrawnUnloads(mock)).toEqual([]);
  });
});

/**
 * Lets the pass unload alpha, then has a view ask for its key.
 *
 * @param between - What happens between the unload and the ask.
 * @returns The mock plugin, alpha loaded again.
 */
async function askedAgain(between: (mock: MockAssets) => void): Promise<MockAssets> {
  const mock = await loaded({ releaseUndrawnS: 5 });

  run(mock, 0, 6);
  expect(undrawnUnloads(mock)).toEqual(["alpha"]);

  between(mock);
  lookupTexture(mock.assetsCtx, "alpha.bg");
  await settle();

  return mock;
}

describe("U7: a view asks again for a bundle the pass unloaded", () => {
  // Bug: a consumer `renderer` does not track (a particle, a filter input, an inline text image) draws the key, so the
  // pass finds the bundle undrawn: it was unloaded and reloaded for ever, once every N seconds.
  it("holds it from the first ask on, so it is not released again", async () => {
    const mock = await askedAgain(() => {});

    expect(mock.ctx.state.reloadHeld.has("alpha")).toBe(true);

    run(mock, 7, 60);

    expect(mock.api.isLoaded("alpha")).toBe(true);
    expect(undrawnUnloads(mock)).toEqual(["alpha"]);
    expect(warnings(mock, ASKED)).toBe(1);
  });

  // Bug: the mark of an undrawn unload is cleared at a rest like the budget's, so a consumer asking after any rest is
  // not held and the release/reload cycle repeats every N seconds.
  it("holds it also when a rest passed between the unload and the ask", async () => {
    const mock = await askedAgain(during => {
      createHandlers(during.ctx)["flow:rest"]({ path: "main/alpha", checkpoint: false });
    });

    expect(mock.ctx.state.reloadHeld.has("alpha")).toBe(true);

    run(mock, 7, 60);

    expect(undrawnUnloads(mock)).toEqual(["alpha"]);
  });

  // Bug: the mark outlives a later load, so a bundle the game loaded itself and unloaded again is held at its next
  // miss and never leaves by the pass.
  it("forgets the mark when the game loads the bundle itself", async () => {
    const mock = await loaded({ releaseUndrawnS: 5 });

    run(mock, 0, 6);
    await mock.api.load("alpha");
    mock.api.unload("alpha");
    lookupTexture(mock.assetsCtx, "alpha.bg");
    await settle();

    expect(mock.ctx.state.reloadHeld.has("alpha")).toBe(false);
  });
});

describe("U8: the value is checked at init", () => {
  // Bug: a bad value silently disables or breaks the mode (a negative limit releases at once, NaN never does).
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("throws for %s", value => {
    const mock = createMockAssets({ releaseUndrawnS: value });

    expect(() => mock.connect()).toThrow(
      `[game] assets.releaseUndrawnS must be a finite number of seconds ≥ 0, got ${String(value)}.\n` +
        "  Leave it out to keep bundles until the budget needs room."
    );
  });

  // Bug: `!value` as the check: 0, the legal "first check", is refused.
  it.each([undefined, 0, 20])("accepts %s", value => {
    const mock = createMockAssets({ releaseUndrawnS: value });

    expect(() => mock.connect()).not.toThrow();
  });
});

describe("U9: a bundle with a sound or a font", () => {
  const sound = {
    key: "ui.click",
    path: "features/ui/assets/click.mp3",
    kind: "audio" as const,
    width: 0,
    height: 0,
    mb: 0.021
  };
  const font = {
    key: "ui.body",
    path: "features/ui/assets/body.fnt",
    kind: "font" as const,
    width: 0,
    height: 0,
    mb: 0.125,
    pages: [{ path: "features/ui/assets/body_0.png", width: 256, height: 128, mb: 0.125 }]
  };
  const manifest: Manifest = {
    version: 1,
    bundles: {
      ...one.bundles,
      sound: { feature: "ui", tier: "lazy", mb: 0.021, files: [sound] },
      face: { feature: "ui", tier: "lazy", mb: 0.125, files: [font] }
    }
  };

  // Bug: `textures.used` never sees a sound or a font and a miss on `audio()` or `font()` is silent: the music or the
  // font goes missing with no hold and no reload.
  it("never releases it, where the texture bundle next to it goes", async () => {
    const mock = await loaded({ releaseUndrawnS: 5 }, manifest, ["alpha", "sound", "face"]);

    run(mock, 0, 30);

    expect(undrawnUnloads(mock)).toEqual(["alpha"]);
    expect(mock.api.isLoaded("sound")).toBe(true);
    expect(mock.api.isLoaded("face")).toBe(true);
  });
});

describe("the pass is a pass once a second", () => {
  // Bug: every frame walks every record and asks the renderer `used`, which walks the keys: the cost the 1 s check
  // exists to avoid.
  it("asks the renderer about the bundles at the check, not at the frames between", async () => {
    const mock = await loaded({ releaseUndrawnS: 60 });
    const used = vi.spyOn(mock.renderer.api.sync.textures, "used");

    for (let frame = 0; frame <= 20; frame += 1) {
      mock.world.time.elapsed = frame * 100;
      mock.world.sync();
    }

    // Checks at 0, 1000 and 2000 ms; 21 frames.
    expect(used).toHaveBeenCalledTimes(3);
  });
});
