import { describe, expect, it } from "vitest";
import { createApp, defineGame, exit, screen, tr, type } from "../../../../index";
import type { CompiledMessages } from "../../../i18n/types";
import { component } from "../../../world/ecs/define";
import { projection } from "../../../world/projection/define";
import { defineTextStyles, label, Text } from "../../components";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, an inert
// renderer, headless assets and the real `i18n` with two compiled locales, in
// plain Bun. A projection returns `label(...)`; one frame fills `resolved`.
// ---------------------------------------------------------------------------

type Bonus = { id: string; amount: number };
type Player = { bonuses: Bonus[]; coins: number };
type Session = { visits: number };

type Strings = { "board.bonus": { n: number } };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Strings;
}>();

/** The compiled Russian module, as `compileStrings` writes it. */
const russian: CompiledMessages = {
  "board.bonus": (params, intl) => [
    { kind: "text", text: `+${intl.number().format(Number(params.n))}` }
  ]
};

/** The compiled English module: a different string for the same key. */
const english: CompiledMessages = {
  "board.bonus": (params, intl) => [
    { kind: "text", text: `plus ${intl.number().format(Number(params.n))}` }
  ]
};

/** The component the HUD counter binds to. */
const Counter = component("Counter", { value: 0 });

const boardStyles = defineTextStyles({
  "board.float": { font: "ui.font-body", size: 32, fill: 0xff_ff_ff, strokeWidth: 2 }
});

const boardBonuses = projection({
  name: "board.bonuses",
  layer: "items",
  from: (player: Player) => player.bonuses,
  key: (bonus: Bonus) => bonus.id,
  view: (bonus: Bonus) =>
    label({
      text: tr("board.bonus", { n: bonus.amount }),
      style: "board.float",
      at: { x: 100, y: 200 }
    })
});

const home = defineNode({ rest: true, outcomes: { quit: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { quit: exit("over") } }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  projections: [boardBonuses],
  textStyles: boardStyles,
  strings: { ru: russian, en: english }
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts the screen set plus `text` headless and mounts the board.
 *
 * @returns The started app.
 */
async function startApp() {
  const app = createApp({
    plugins: [...screen, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "ru", fallback: "ru" },
      model: {
        initialPlayer: { bonuses: [{ id: "b1", amount: 5 }], coins: 0 },
        initialSession: { visits: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "items", sort: "y" }]);
  app.world.projection.mount(["board.bonuses"], { kind: "plugin", name: "test" });
  app.time.step(16);

  return app;
}

describe("text plugin integration", () => {
  it("resolves the message of a projection label in one frame", async () => {
    const app = await startApp();
    const entity = app.world.projection.entityOf("board.bonuses", "b1") ?? 0;

    expect(app.world.ecs.get(entity, Text)?.resolved).toBe("+5");

    await app.stop();
  });

  it("re-resolves every message on the next frame after a locale change", async () => {
    const app = await startApp();
    const entity = app.world.projection.entityOf("board.bonuses", "b1") ?? 0;

    await app.i18n.setLocale("en");
    app.time.step(16);

    expect(app.world.ecs.get(entity, Text)?.resolved).toBe("plus 5");

    await app.stop();
  });

  it("shows the rounded value of a bound component field", async () => {
    const app = await startApp();
    const counter = app.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Counter({ value: 12.4 }),
      Text({ style: "digits", bind: { component: "Counter", field: "value" } })
    ]);

    app.time.step(16);

    expect(app.world.ecs.get(counter, Text)?.resolved).toBe("12");

    app.world.ecs.set(counter, Counter, { value: 12.6 });
    app.time.step(16);

    expect(app.world.ecs.get(counter, Text)?.resolved).toBe("13");

    await app.stop();
  });

  it("measures from the 0.6 em fallback while no font is loaded", async () => {
    const app = await startApp();

    expect(app.text.measure("120", "body").width).toBeCloseTo(57.6, 5);
    expect(app.text.measure("120", "body").height).toBeCloseTo(38.4, 5);
    expect(app.text.measure(tr("board.bonus", { n: 5 }), "body").width).toBeCloseTo(38.4, 5);

    await app.stop();
  });

  it("lists the built-in styles and the styles of the feature", async () => {
    const app = await startApp();

    expect(app.text.styles()).toEqual(["body", "digits", "board.float"]);

    await app.stop();
  });

  it("draws nothing while the renderer is inert", async () => {
    const app = await startApp();
    const entity = app.world.projection.entityOf("board.bonuses", "b1") ?? 0;

    expect(app.renderer.host.pixi()).toBeUndefined();
    expect(app.renderer.sync.displayOf(entity)).toBeUndefined();

    await app.stop();
  });

  it("leaves nothing behind when it stops", async () => {
    const app = await startApp();

    await app.stop();

    expect(app.text.styles()).toEqual([]);
  });
});
