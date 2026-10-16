import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, exit, frameAt, type PerfLogLine, type } from "../../../../index";
import { worldPlugin } from "../../../world";
import { rendererPlugin } from "../../index";
import { installFakeDom } from "../fake-dom";
import { createFakePixi } from "../fake-pixi";

// ---------------------------------------------------------------------------
// Integration: the performance monitor of an agent build in a real app — time,
// lifecycle, model, clock, flow, world and renderer over the fake Pixi and the
// fake DOM, frames driven by `time.step` (spec 11 "Integration").
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const { defineNode, defineFlow } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, unknown>;
}>();

const home = defineNode({ outcomes: { play: type() }, rest: true });
const board = defineNode({ outcomes: { quit: type() }, rest: true });
const main = defineFlow("main", {
  nodes: { home, board },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { play: "board" }, board: { quit: exit("over") } }
});

const round = defineNode({ outcomes: { back: type() }, rest: true });
const lobby = defineNode({ outcomes: { play: type() }, rest: true });
/** A screen entered and left again and again: the lobby and a round. */
const rounds = defineFlow("main", {
  nodes: { lobby, round },
  start: "lobby",
  outcomes: { over: type() },
  edges: { lobby: { play: "round" }, round: { back: "lobby" } }
});

const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts the app over the fakes, with the page clock in the test's hand.
 *
 * @param mainFlow - The flow the app runs.
 * @returns The started app and the page clock.
 */
async function startApp(mainFlow: typeof main | typeof rounds = main) {
  const pixi = createFakePixi();
  const clock = { now: 0 };

  installFakeDom();
  vi.spyOn(globalThis.performance, "now").mockImplementation(() => clock.now);

  const app = createApp({
    plugins: [worldPlugin, rendererPlugin],
    pluginConfigs: {
      flow: { mainFlow },
      model: { initialPlayer: {}, initialSession: {}, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) }
    }
  });

  await app.start();

  return { app, clock };
}

/** Steps `count` frames of 8.33 ms, the page clock moving with them. */
function steps(
  app: { time: { step(ms: number): void } },
  clock: { now: number },
  count: number
): void {
  for (let index = 0; index < count; index += 1) {
    clock.now += 1000 / 120;
    app.time.step(1000 / 120);
  }
}

describe("the performance monitor of an agent build", () => {
  it("records every frame with its six phases, streams the header first and a sample a second", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { app, clock } = await startApp();
    const lines: PerfLogLine[] = [];

    app.renderer.monitor.stream(line => lines.push(line));
    app.flow.run().catch(() => undefined);
    await tick();
    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();
    steps(app, clock, 130);

    const ring = app.renderer.monitor.frames();
    const newest = frameAt(ring, 0);

    expect(ring.size).toBe(130);
    expect(newest?.stepped).toBe(true);
    expect(Object.keys(newest?.phases ?? {})).toEqual([
      "input",
      "animate",
      "layout",
      "sync",
      "signals",
      "render",
      "agent"
    ]);
    expect(lines[0]?.kind).toBe("header");

    const sample = lines.find(line => line.kind === "sample");
    const mark = lines.find(line => line.kind === "mark");

    expect(sample).toMatchObject({ kind: "sample", path: "board" });
    expect(mark).toMatchObject({ kind: "mark", label: "board", auto: true });

    await app.stop();

    const after = lines.length;

    app.renderer.monitor.mark("after the stop");

    expect(lines).toHaveLength(after);
  });

  // Bug caught: a count that does not come back to where it was after a screen is left (a count of the wrong thing, or
  // one never taken back), and a listener a screen leaks on every visit that the counts do not show.
  it("samples counts that come back to their baseline after every visit, and grow by one a visit for a leaked listener", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const { app, clock } = await startApp(rounds);
    const lines: PerfLogLine[] = [];
    const counts = (): unknown => lines.findLast(line => line.kind === "sample")?.counts;

    app.renderer.monitor.stream(line => lines.push(line));
    app.flow.run().catch(() => undefined);
    await tick();
    steps(app, clock, 130);

    const baseline = counts();
    const visits: unknown[] = [];

    for (let visit = 0; visit < 3; visit += 1) {
      app.flow.gate.answer({ intent: "play" });
      await tick();
      app.flow.gate.answer({ intent: "back" });
      await tick();
      steps(app, clock, 130);
      visits.push(counts());
    }

    expect(baseline).toMatchObject({
      entities: expect.any(Number),
      clockListeners: expect.any(Number)
    });
    expect(visits).toEqual([baseline, baseline, baseline]);

    const leaked: number[] = [];

    for (let visit = 0; visit < 3; visit += 1) {
      app.flow.gate.answer({ intent: "play" });
      await tick();
      app.clock.onElapsed(() => undefined);
      app.flow.gate.answer({ intent: "back" });
      await tick();
      steps(app, clock, 130);
      leaked.push(app.renderer.stats().counts?.clockListeners ?? Number.NaN);
    }

    const before = (baseline as { clockListeners: number }).clockListeners;

    expect(leaked).toEqual([before + 1, before + 2, before + 3]);

    await app.stop();
  });

  it("measures nothing and calls no listener in a build without the flag", async () => {
    const { app, clock } = await startApp();
    const listener = vi.fn();

    app.renderer.monitor.stream(listener);
    steps(app, clock, 10);

    expect(app.renderer.monitor.frames().capacity).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    await app.stop();
  });
});
