import { describe, expect, it } from "vitest";
import {
  createApp,
  defineAnimation,
  defineComponent,
  defineGame,
  haptic,
  popup,
  screen,
  sequence,
  type
} from "../../../../index";
import { platformPlugin } from "../../index";
import { createFakeProvider, type FakeProvider } from "../fake-provider";

// ---------------------------------------------------------------------------
// Integration: the real logic plugins, the screen set and `platform`, headless.
// A minimal game: Home rests and lists "back"; Board rests without it; Asking
// shows a popup whose `escape` button answers "stay". The provider is the fake
// of six functions, so every press and every tick is read back from it.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** The popup of the Asking node: one button, marked `escape`, that answers "stay". */
const AskPopup = defineComponent("Ask", {
  outcomes: { stay: type() },
  view: () => (
    <panel key="askPanel" style={{ width: 400, height: 300 }}>
      <button key="stay" intent="stay" escape style={{ width: 100, height: 60 }} />
    </panel>
  )
});

const home = defineNode({
  rest: true,
  outcomes: { ask: type(), play: type(), buzz: type(), back: type() }
});

const asking = defineNode({
  rest: true,
  outcomes: { stay: type() },
  run: async ({ fx, out }) => {
    await fx(popup(AskPopup, {}));

    return out.stay();
  }
});

const board = defineNode({ rest: true, outcomes: { home: type() } });

const leaving = defineNode({ rest: true, outcomes: { home: type() } });

const buzzing = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    await fx(haptic("success"));

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, asking, board, leaving, buzzing },
  start: "home",
  outcomes: {},
  edges: {
    home: { ask: "asking", play: "board", buzz: "buzzing", back: "leaving" },
    asking: { stay: "home" },
    board: { home: "home" },
    leaving: { home: "home" },
    buzzing: { done: "home" }
  }
});

const backFeature = defineFeature("backGame", { flows: [main], ui: [AskPopup] });

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the minimal game with the fake provider, resting on Home.
 *
 * @param fake - The provider the platform plugin gets.
 * @returns The started app.
 */
async function startGame(fake: FakeProvider) {
  const app = createApp({
    plugins: [...screen, platformPlugin, backFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      platform: { provider: fake.provider, keepAwake: true }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);

  return app;
}

/** The started app. */
type GameApp = Awaited<ReturnType<typeof startGame>>;

/**
 * Lets the runner move, then runs frames, so the next node is entered and the screen follows.
 *
 * @param app - The running app.
 */
async function settle(app: GameApp): Promise<void> {
  await tick();

  for (let frame = 0; frame < 3; frame += 1) app.time.step(16);

  await tick();
}

/**
 * The node the graph rests on, the last part of the flow path.
 *
 * @param app - The running app.
 * @returns The node name.
 */
function nodeOf(app: GameApp): string | undefined {
  return app.flow.state().path.split(/[./]/).at(-1);
}

describe("the Back chain", () => {
  it("closes an open popup like Escape", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake);

    expect(app.flow.gate.answer({ intent: "ask" })).toBe(true);
    await settle(app);
    expect(app.ui.find("stay")).toBeDefined();

    expect(app.platform.back()).toBe("popup");
    await settle(app);

    expect(nodeOf(app)).toBe("home");
    expect(fake.provider.exit).not.toHaveBeenCalled();

    await app.stop();
  });

  it("hands the press to the resting node that lists back", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake);

    expect(fake.press()).toBe(true);
    await settle(app);

    expect(nodeOf(app)).toBe("leaving");
    expect(fake.provider.exit).not.toHaveBeenCalled();

    await app.stop();
  });

  it("leaves the app when neither a popup nor the node takes the press", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake);

    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await settle(app);

    expect(app.platform.back()).toBe("exit");
    expect(fake.provider.exit).toHaveBeenCalledTimes(1);

    await app.stop();
  });
});

describe("haptics", () => {
  it("reaches the provider from a node's fx", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake);

    expect(app.flow.gate.answer({ intent: "buzz" })).toBe(true);
    await settle(app);

    expect(fake.provider.haptic).toHaveBeenCalledWith("success");
    expect(nodeOf(app)).toBe("home");

    await app.stop();
  });

  it("reaches the provider from a haptic step of a timeline", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake);
    const tickOnce = defineAnimation("test.tick", {
      slots: {},
      build: () => sequence(haptic("light"))
    });

    app.anim.play(tickOnce, {});
    app.time.step(16);

    expect(fake.provider.haptic).toHaveBeenCalledWith("light");

    await app.stop();
  });
});

describe("pause, keep-awake and stop", () => {
  it("pauses the game on the provider's pause and keeps the screen on only while it runs", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake);

    expect(fake.provider.keepAwake).toHaveBeenLastCalledWith(true);

    fake.pause();
    await tick();
    expect(app.lifecycle.reasons()).toEqual(["background"]);
    expect(fake.provider.keepAwake).toHaveBeenLastCalledWith(false);

    fake.resume();
    await tick();
    expect(app.lifecycle.isPaused()).toBe(false);
    expect(fake.provider.keepAwake).toHaveBeenLastCalledWith(true);

    await app.stop();
  });

  it("removes every subscription on stop and lets the screen sleep", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake);

    await app.stop();

    expect(fake.removers.pause).toHaveBeenCalledTimes(1);
    expect(fake.removers.resume).toHaveBeenCalledTimes(1);
    expect(fake.removers.back).toHaveBeenCalledTimes(1);
    expect(fake.provider.keepAwake).toHaveBeenLastCalledWith(false);
  });

  it("is inert without a provider: back answers none", async () => {
    const app = createApp({ plugins: [...screen, platformPlugin] });

    await app.start();

    expect(app.platform.back()).toBe("none");

    await app.stop();
  });
});
