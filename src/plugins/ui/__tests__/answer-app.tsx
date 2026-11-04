/**
 * @file ui plugin — the app of the answer tests (F137, F139). Not a test file. The node `ask`
 * awaits the popup `Gift`, whose panel stands 300 in and 500 down the viewport with a padding of
 * 100, and holds the button `sphere` of 400 x 200 that answers `kitTap` with its press point. The
 * answer the node got is kept in `seen`. Drawn on the fake page and the fake Pixi, so a press is a
 * pointer event that goes through the renderer's hit test and the gesture machine; the clock is a
 * fake one the test moves. Real flow, world, text and Yoga.
 */
import { createApp, defineGame, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { fakeClock } from "../../clock/fake";
import type { FakeClock } from "../../clock/types";
import type { Answered } from "../../flow/types";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { installFakeDom } from "../../renderer/__tests__/fake-dom";
import { createFakePixi, type FakePixi, FakeTexture } from "../../renderer/__tests__/fake-pixi";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { popup } from "../components";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";

/** The answer the node `ask` resolved with, or `undefined` before it got one. */
export const seen: { answer: Answered | undefined } = { answer: undefined };

/** The gift popup: a panel moved into the viewport, holding the sphere that answers its point. */
export const Gift = defineComponent("Gift", {
  outcomes: { kitTap: type<{ point: { x: number; y: number } }>() },
  view: () => (
    <stack key="giftRoot" style={{ width: 1080, height: 1920 }}>
      <panel
        key="giftPanel"
        style={{
          position: "absolute",
          left: 300,
          top: 500,
          width: 600,
          height: 400,
          padding: 100,
          reason: "gift"
        }}
      >
        <button key="sphere" intent="kitTap" point escape style={{ width: 400, height: 200 }} />
      </panel>
    </stack>
  )
});

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, never>;
}>();

const home = defineNode({ rest: true, outcomes: { ask: type() } });

const ask = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    seen.answer = await fx(popup(Gift, {}));

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, ask },
  start: "home",
  outcomes: {},
  edges: { home: { ask: "ask" }, ask: { done: "home" } }
});

/** The feature of the answer fixture. */
const answerFeature = defineFeature("answers", { flows: [main], ui: [Gift] });

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to give it.
 */
export async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Builds the answer app on the fake page, the fake Pixi and a fake clock at 60 000, not started.
 *
 * @returns The app, its fake Pixi and its clock.
 */
function createAnswerApp() {
  seen.answer = undefined;
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
  const clock = fakeClock(60_000);
  const app = createApp({
    plugins: [
      worldPlugin,
      rendererPlugin,
      inputPlugin,
      assetsPlugin,
      scenesPlugin,
      animPlugin,
      i18nPlugin,
      textPlugin,
      uiPlugin,
      answerFeature
    ],
    pluginConfigs: {
      clock: { source: clock },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      // The warm-up probes are left out: the fake Pixi has no render texture to draw them into.
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), warm: 0 }
    }
  });

  return { app, pixi, clock };
}

/** The app `createAnswerApp` builds. */
export type AnswerApp = ReturnType<typeof createAnswerApp>["app"];

/** What `startAnswerApp` hands a test. */
export type Started = { app: AnswerApp; pixi: FakePixi; clock: FakeClock };

/**
 * Steps frames of 16 ms.
 *
 * @param app - The running app.
 * @param count - How many.
 */
export function frames(app: AnswerApp, count: number): void {
  for (let frame = 0; frame < count; frame += 1) app.time.step(16);
}

/**
 * Starts the answer app drawn, the flow on `ask` with the gift popup on screen: every texture a
 * fake one, two frames run after the popup was asked for.
 *
 * @returns The started app, its fake Pixi and its clock.
 */
export async function startAnswerApp(): Promise<Started> {
  const started = createAnswerApp();
  const { app } = started;

  await app.start();
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.flow.gate.answer({ intent: "ask" });
  await tick();
  frames(app, 2);

  return started;
}

/**
 * Dispatches one pointer event of the first touch on the fake canvas, at a point in reference
 * units.
 *
 * @param started - The running app and its fake Pixi.
 * @param name - The DOM event name.
 * @param point - Where, in reference units.
 * @param point.x - Its x.
 * @param point.y - Its y.
 */
export function pointer(started: Started, name: string, point: { x: number; y: number }): void {
  const client = started.app.renderer.viewport.toScreen(point);

  started.pixi.last().canvas.dispatch(name, {
    pointerType: "touch",
    pointerId: 1,
    clientX: client.x,
    clientY: client.y,
    preventDefault: () => undefined
  });
}
