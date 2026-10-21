import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, projection, screen, type } from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import type { CompiledMessages } from "../../../i18n/types";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { createFakePixi } from "../../../renderer/__tests__/fake-pixi";
import { Box } from "../../../ui/components";
import { component } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { bind, Countdown, Text } from "../../components";

// ---------------------------------------------------------------------------
// Integration (F22): a label `ui` spawns shows its string in the frame it is
// spawned. `ui` adds the `Text` in its solve, after the layout system of
// `text` ran; the flush of phase `layout` attaches it, and `text` resolves it
// right after that flush, before the renderer builds it in phase `sync`. The
// screen set on the fake page and the fake Pixi of the renderer's own tests,
// so `sync` builds a real display tree; no font is loaded.
// ---------------------------------------------------------------------------

/** The game's own counter a bound label shows. */
const Counter = component("Counter", { value: 0 });

/** The player of the fixture: the line the changing label shows. */
type Player = { line: string };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Record<string, never>;
  assets: string;
  strings: { "spawn.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "spawn.title": () => [{ kind: "text", text: "spawn" }]
};

/** One plain label and one bound to the counter its own entity carries. */
const labels = projection({
  name: "spawn.labels",
  layer: "ui",
  from: () => ({ id: "labels" }),
  view: () => (
    <column key="labelsRoot" style={{ width: 400, height: 400 }}>
      <text key="seven" content="7" />
      <text
        key="three"
        style="digits"
        bind={bind(Counter, "value")}
        components={[Counter({ value: 3 })]}
      />
    </column>
  )
});

/** A label whose content is the player's line: a commit changes it in place. */
const line = projection({
  name: "spawn.line",
  layer: "ui",
  from: (player: Player) => ({ id: "line", line: player.line }),
  view: (item: { line: string }) => (
    <column key="lineRoot" style={{ width: 400, height: 400 }}>
      <text key="line" content={item.line} />
    </column>
  )
});

/** The moment the fake clock of the app stands at. */
const START = 1_000_000;

/**
 * A countdown 95 s from now, shown as whole milliseconds: `ui` measures the `left` its component
 * lists, 0, and `text` resolves the time that is left, "95000".
 */
const timer = projection({
  name: "spawn.timer",
  layer: "ui",
  from: () => ({ id: "timer" }),
  view: () => (
    <row key="timerRoot" style={{ width: 400, height: 400 }}>
      <text
        key="timer"
        style="digits"
        bind={bind(Countdown, "left")}
        components={[Countdown({ until: START + 95_000 })]}
      />
    </row>
  )
});

const home = defineNode({ rest: true, outcomes: { next: type() } });

const write = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.line = "b";

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, write },
  start: "home",
  outcomes: {},
  edges: { home: { next: "write" }, write: { done: "home" } }
});

const spawnFeature = defineFeature("spawn", {
  flows: [main],
  projections: [labels, line, timer],
  strings: { en: english }
});

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to give it.
 */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set on the fake page, drawn on the fake Pixi, with the flow resting on `home`
 * and the `ui` layer set. Nothing is mounted yet.
 *
 * @returns The started app.
 */
async function startApp() {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const app = createApp({
    plugins: [...screen, spawnFeature],
    pluginConfigs: {
      clock: { source: fakeClock(START) },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { line: "a" }, initialSession: {}, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), warm: 0 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);

  return app;
}

/** The app `startApp` builds. */
type SpawnApp = Awaited<ReturnType<typeof startApp>>;

/**
 * The entity of a keyed element, failing the test when it is not there.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
function entityOf(app: SpawnApp, key: string): Entity {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? 0;
}

/**
 * What `text` resolved for a keyed label.
 *
 * @param app - The running app.
 * @param key - The key of the label.
 * @returns `Text.resolved`.
 */
function resolvedOf(app: SpawnApp, key: string): string | undefined {
  return app.world.ecs.get(entityOf(app, key), Text)?.resolved;
}

/**
 * How many display objects the renderer's container of a keyed label holds: one glyph run per
 * line of a plain style, none for an empty string.
 *
 * @param app - The running app.
 * @param key - The key of the label.
 * @returns The child count, or `undefined` when nothing was built.
 */
function glyphsOf(app: SpawnApp, key: string): number | undefined {
  const shown = app.renderer.sync.displayOf(entityOf(app, key)) as
    | { children: unknown[] }
    | undefined;

  return shown?.children.length;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a label ui spawns, in its spawn frame", () => {
  it("is resolved and drawn with its glyphs: a plain string and a bound number", async () => {
    const app = await startApp();

    app.world.projection.mount(["spawn.labels"], { kind: "plugin", name: "test" });
    app.time.step(16);

    expect(resolvedOf(app, "seven")).toBe("7");
    expect(resolvedOf(app, "three")).toBe("3");
    expect(glyphsOf(app, "seven")).toBeGreaterThan(0);
    expect(glyphsOf(app, "three")).toBeGreaterThan(0);

    await app.stop();
  });
});

describe("a label whose content changes", () => {
  // Bug (F45, A Memory Missing's typewriter): `ui` writes the new content after the layout system of `text` ran, so
  // `Text.resolved` held the old line for a frame and the frame drew it.
  it("resolves in the frame ui writes it, before that frame is drawn", async () => {
    const app = await startApp();

    app.world.projection.mount(["spawn.line"], { kind: "plugin", name: "test" });
    app.time.step(16);

    expect(resolvedOf(app, "line")).toBe("a");

    // The commit is reconciled in the next frame's `input`; `ui` writes the new content in that
    // frame's `layout`, after the layout system of `text` ran.
    app.flow.gate.answer({ intent: "next" });
    await tick();
    app.time.step(16);

    expect(app.world.ecs.get(entityOf(app, "line"), Text)?.content).toBe("b");
    expect(resolvedOf(app, "line")).toBe("b");

    await app.stop();
  });
});

describe("a label resolved after the layout flush", () => {
  // Bug: ui measured the label in its solve, before it was resolved, and the change of `Text` the
  // resolution made is gone by the next layout phase: the box keeps the size of the listed value.
  it("is measured again by ui in the next layout phase, with the string it shows", async () => {
    const app = await startApp();

    app.world.projection.mount(["spawn.timer"], { kind: "plugin", name: "test" });
    app.time.step(16);

    expect(resolvedOf(app, "timer")).toBe("95000");

    app.time.step(16);
    app.time.step(16);

    const width = Math.ceil(app.text.measure("95000", "digits").width);

    expect(width).toBeGreaterThan(Math.ceil(app.text.measure("0", "digits").width));
    expect(app.world.ecs.get(entityOf(app, "timer"), Box)?.w).toBe(width);

    await app.stop();
  });
});
