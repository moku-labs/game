import { describe, expect, it } from "vitest";
import {
  createApp,
  defineComponent,
  defineGame,
  type Flow,
  projection,
  screen,
  type
} from "../../../../index";
import { platformPlugin } from "../../index";
import { createFakeProvider, type FakeProvider } from "../fake-provider";

// ---------------------------------------------------------------------------
// Integration: Back while a guide narrows the gate (F109). The real logic
// plugins, the screen set and `platform`, headless, over the fake provider.
// The rest node `board` lists `back` and holds a guide derived from the
// session's step: `merge` allows a merge, `back` allows Back itself. A press
// the guide refuses answers `tutorialBlocked`, which leads to `scold`. The
// `shop` projection is a ui root whose `escape` button answers `shop`.
// ---------------------------------------------------------------------------

/** The step of the tutorial the guide of `board` shows. */
type Step = "merge" | "back";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: { step: Step };
  assets: string;
  strings: Record<string, never>;
}>();

/** The guide of each step. */
const STEPS: Record<Step, Flow.GuideOptions> = {
  merge: { allow: { intent: "merge" }, blocked: { intent: "tutorialBlocked" } },
  back: { allow: { intent: "back" }, blocked: { intent: "tutorialBlocked" } }
};

/** A ui root with one button, marked `escape`, that answers "shop". */
const Shop = defineComponent("GuidedShop", {
  view: () => (
    <panel key="shopPanel" style={{ width: 400, height: 300 }}>
      <button key="shop" intent="shop" escape style={{ width: 100, height: 60 }} />
    </panel>
  )
});

/** The shop's projection, mounted only by the test of the Escape path. */
const shop = projection({
  name: "guided.shop",
  layer: "ui",
  from: () => ({ id: "shop" }),
  view: () => <Shop key="shopView" />
});

const board = defineNode({
  rest: true,
  outcomes: { merge: type(), back: type(), shop: type(), tutorialBlocked: type() },
  guide: ({ session }) => STEPS[session.step]
});

const merged = defineNode({ rest: true, outcomes: { home: type() } });
const left = defineNode({ rest: true, outcomes: { home: type() } });
const shopped = defineNode({ rest: true, outcomes: { home: type() } });
const scold = defineNode({ rest: true, outcomes: { home: type() } });

const main = defineFlow("main", {
  nodes: { board, merged, left, shopped, scold },
  start: "board",
  outcomes: {},
  edges: {
    board: { merge: "merged", back: "left", shop: "shopped", tutorialBlocked: "scold" },
    merged: { home: "board" },
    left: { home: "board" },
    shopped: { home: "board" },
    scold: { home: "board" }
  }
});

const guidedFeature = defineFeature("guidedBack", {
  flows: [main],
  projections: [shop],
  ui: [Shop]
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the guided game with the fake provider, resting on `board`.
 *
 * @param fake - The provider the platform plugin gets.
 * @param step - The step the guide of `board` shows.
 * @param withShop - Mounts the shop's ui root with its `escape` button.
 * @returns The started app.
 */
async function startGame(fake: FakeProvider, step: Step, withShop = false) {
  const app = createApp({
    plugins: [...screen, platformPlugin, guidedFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialSession: { step } },
      platform: { provider: fake.provider }
    }
  });

  await app.start();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);

  if (withShop) app.world.projection.mount(["guided.shop"], { kind: "plugin", name: "test" });

  app.flow.run().catch(() => undefined);
  await tick();
  app.time.step(16);
  app.time.step(16);

  return app;
}

/** The started app. */
type GameApp = Awaited<ReturnType<typeof startGame>>;

/**
 * Lets the runner move, then runs frames, so a next node would be entered.
 *
 * @param app - The running app.
 */
async function settle(app: GameApp): Promise<void> {
  await tick();

  for (let frame = 0; frame < 3; frame += 1) app.time.step(16);

  await tick();
}

describe("Back while a guide narrows the gate", () => {
  it("takes the press as the intent and never leaves the app", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake, "merge");
    const path = app.flow.state().path;

    expect(app.flow.gate.state().narrowed).toBe(true);
    expect(app.platform.back()).toBe("intent");
    await settle(app);

    expect(fake.provider.exit).not.toHaveBeenCalled();
    expect(app.flow.state().path).toBe(path);

    await app.stop();
  });

  it("never presses Escape, so an escape button never turns Back into blocked", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake, "merge", true);
    const path = app.flow.state().path;

    expect(app.ui.find("shop")).toBeDefined();
    expect(app.platform.back()).toBe("intent");
    await settle(app);

    expect(app.flow.state().path).toBe(path);
    expect(fake.provider.exit).not.toHaveBeenCalled();

    await app.stop();
  });

  it("answers back when the guide allows it", async () => {
    const fake = createFakeProvider();
    const app = await startGame(fake, "back");

    expect(app.platform.back()).toBe("intent");
    await settle(app);

    expect(app.flow.state().path.split(/[./]/).at(-1)).toBe("left");
    expect(fake.provider.exit).not.toHaveBeenCalled();

    await app.stop();
  });
});
