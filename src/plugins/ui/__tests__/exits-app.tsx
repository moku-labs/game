/**
 * @file ui plugin — the app of the replaced-element tests (F83, F84) and of the `change` hooks of
 * a visual (F85). Not a test file. One counter of the player, raised by the intent `next`, drives
 * six screens: a ward whose view returns a root of another key once the counter moved, a sheet
 * component whose view returns a root of another key once its local state says so, a list
 * whose card is replaced by one of another key and whose slot changes its tag, the XP ring of a
 * HUD whose arc walks its sweep, a gauge whose bar tweens its alpha and turns its ends flat in
 * the same render, a bar that grows and brightens in one render, and an image with `change` hooks
 * `ui` plays and hooks it never plays. Every exit fades its `Alpha` and is recorded with its cause; every `change.Shape`
 * call is recorded with the values it got and the motion it returned. Real flow runner, plain Bun,
 * inert renderer, real Yoga, real `anim`.
 */
import { Alpha, component, createApp, defineGame, projection, Shape, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import type { ShapeValue } from "../../renderer/components";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import type { Motion, MotionCause, MotionHandle, ViewHandle } from "../../world/types";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { ElementMotion } from "../jsx/types";

/** The player of the fixture: how many times `next` was answered. */
export type ExitsPlayer = { step: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: ExitsPlayer;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** One exit hook that played: the key of its element and why it left. */
export type ExitCall = { key: string; cause: MotionCause | undefined };

/** Every exit hook that played, in order; a test empties it. */
export const exits: ExitCall[] = [];

/** How long every exit of the fixture fades, in ms. */
export const EXIT_MS = 200;

/**
 * The motion of an element that fades out when it leaves and notes its exit.
 *
 * @param key - The key the exit is recorded under.
 * @returns The motion prop.
 */
function fadeOut(key: string): ElementMotion {
  return {
    exit: (view, _node, _hint, cause) => {
      exits.push({ key, cause });

      return view.tween(Alpha, { alpha: 0 }, { ms: EXIT_MS, reduced: "keep" });
    }
  };
}

/** The exit motions of the fixture, built once at module level as a game builds them. */
const fades = {
  wardWait: fadeOut("wardWait"),
  waitCard: fadeOut("waitCard"),
  wardReady: fadeOut("wardReady"),
  cardA: fadeOut("cardA"),
  cardAInner: fadeOut("cardAInner"),
  cardADeep: fadeOut("cardADeep"),
  slot: fadeOut("slot"),
  slotInner: fadeOut("slotInner"),
  swapShut: fadeOut("swapShut")
};

/** What one call of a `change.Shape` hook got, and the motion it returned. */
export type ShapeCall = {
  key: string;
  previous: ShapeValue;
  next: ShapeValue;
  motion: MotionHandle | undefined;
};

/** Every `change.Shape` call of the ring and the gauge's two bars, in order; a test empties it. */
export const shapeCalls: ShapeCall[] = [];

/** How long the arc of the ring walks to a new share, as the game's `.xr .pr` transition. */
export const ARC_MS = 520;

/**
 * The XP arc of A Memory Missing's level ring (`shared/views/hud-pill.tsx`, `arcMotion`): a new
 * share puts the arc back where it stood and walks it home.
 */
const arcMotion: ElementMotion = {
  change: {
    Shape: (view: ViewHandle<unknown>, previous: ShapeValue, next: ShapeValue): Motion => {
      if (previous.sweep === next.sweep) {
        shapeCalls.push({ key: "xpArc", previous, next, motion: undefined });

        return undefined;
      }

      view.set(Shape, { sweep: previous.sweep ?? 1 });

      const motion = view.toRest(Shape, { ms: ARC_MS, ease: "out" });

      shapeCalls.push({ key: "xpArc", previous, next, motion });

      return motion;
    }
  }
};

/** How long the bar of the gauge tweens to a new share. */
export const BAR_MS = 400;

/** The bar of the gauge: it tweens its alpha alone and leaves every other field to the render. */
const barMotion: ElementMotion = {
  change: {
    Shape: (view: ViewHandle<unknown>, previous: ShapeValue, next: ShapeValue): Motion => {
      const motion = view.tween(Shape, { alpha: next.alpha }, { ms: BAR_MS, ease: "linear" });

      shapeCalls.push({ key: "gaugeBar", previous, next, motion });

      return motion;
    }
  }
};

/**
 * The bar that grows: it brings its look home when its alpha moved, and plays nothing for a look
 * whose alpha stands, as a hook that compares the values before and after does.
 */
const growMotion: ElementMotion = {
  change: {
    Shape: (view: ViewHandle<unknown>, previous: ShapeValue, next: ShapeValue): Motion => {
      const motion =
        previous.alpha === next.alpha
          ? undefined
          : view.toRest(Shape, { ms: BAR_MS, ease: "linear" });

      shapeCalls.push({ key: "gaugeGrow", previous, next, motion });

      return motion;
    }
  }
};

/** The box of a control button. */
const control = { width: 100, height: 60 } as const;

/** The box of a card. */
const card = { width: 200, height: 100 } as const;

/** One item of a single-root screen. */
type Item = { id: string; step: number };

/**
 * The ward (F83): a projection view whose root is `wardWait` until `next` is answered, then
 * `wardReady`. Both hold the button `wardNext`, under one key.
 */
export const wardScreen = projection({
  name: "exits.ward",
  layer: "ui",
  from: (player: ExitsPlayer): Item => ({ id: "ward", step: player.step }),
  view: (item: Item) =>
    item.step === 0 ? (
      <stack
        key="wardWait"
        style={{ width: 1080, height: 1080 }}
        motion={fades.wardWait}
        components={[Alpha()]}
      >
        <button key="wardNext" intent="next" style={control} />
        <row key="waitCard" style={card} motion={fades.waitCard} components={[Alpha()]} />
      </stack>
    ) : (
      <stack
        key="wardReady"
        style={{ width: 1080, height: 1080 }}
        motion={fades.wardReady}
        components={[Alpha()]}
      >
        <button key="wardNext" intent="next" style={control} />
      </stack>
    )
});

/**
 * The list (F84): a live column whose card `cardA`, with a child and a grandchild, becomes
 * `cardB` once `next` is answered, and whose `slot` turns from a row into a column. The new card
 * keeps the key `cardInner` of the old card's child.
 */
export const listScreen = projection({
  name: "exits.list",
  layer: "ui",
  from: (player: ExitsPlayer): Item => ({ id: "list", step: player.step }),
  view: (item: Item) => (
    <column key="listRoot" style={{ width: 1080, height: 1080 }}>
      {item.step === 0 ? (
        <row key="cardA" style={card} motion={fades.cardA} components={[Alpha()]}>
          <stack
            key="cardInner"
            style={{ width: 80, height: 80 }}
            motion={fades.cardAInner}
            components={[Alpha()]}
          >
            <stack
              key="cardADeep"
              style={{ width: 40, height: 40 }}
              motion={fades.cardADeep}
              components={[Alpha()]}
            />
          </stack>
        </row>
      ) : (
        <row key="cardB" style={card}>
          <stack key="cardInner" style={{ width: 80, height: 80 }} />
        </row>
      )}
      {item.step === 0 ? (
        <row key="slot" style={card} motion={fades.slot} components={[Alpha()]}>
          <stack
            key="slotInner"
            style={{ width: 40, height: 40 }}
            motion={fades.slotInner}
            components={[Alpha()]}
          />
        </row>
      ) : (
        <column key="slot" style={card} />
      )}
      <button key="listNext" intent="next" style={control} />
    </column>
  )
});

/**
 * A sheet whose view returns a row of another key once its local `open` is set, and keeps its
 * buttons: one opens it, one answers `next`, which renders the projection again.
 */
export const Swap = defineComponent("ExitsSwap", {
  local: { open: false },
  view: (props: { step: number }, local) =>
    local.open ? (
      <row key="swapOpen" style={card}>
        <button key="swapNext" intent="next" style={control} />
        <text key="swapStep" style={{ width: 60, height: 40 }} content={String(props.step)} />
      </row>
    ) : (
      <row key="swapShut" style={card} motion={fades.swapShut} components={[Alpha()]}>
        <button key="swapOpener" local={{ open: true }} style={control} />
      </row>
    )
});

/** The sheet (F83): a projection whose view is the unkeyed component, so the `Tree` node keeps its key. */
export const swapScreen = projection({
  name: "exits.swap",
  layer: "ui",
  from: (player: ExitsPlayer): Item => ({ id: "swap", step: player.step }),
  view: (item: Item) => <Swap step={item.step} />
});

/** The ring of the HUD (F85): its XP arc shows a quarter of a ring per answered `next`, dimmed while pressed. */
export const ringScreen = projection({
  name: "exits.ring",
  layer: "ui",
  from: (player: ExitsPlayer): Item => ({ id: "ring", step: player.step }),
  view: (item: Item) => (
    <column key="ringRoot" style={{ width: 1080, height: 1080 }}>
      <stack
        key="xpArc"
        style={{
          width: 32,
          height: 32,
          shape: "arc",
          stroke: 0xff_f9_e8,
          strokeWidth: 3.6,
          sweep: Math.min(1, item.step / 4),
          cap: "round",
          alpha: 0.97,
          is: { pressed: { alpha: 0.5 } }
        }}
        motion={arcMotion}
      />
      <button key="ringNext" intent="next" style={control} />
    </column>
  )
});

/**
 * The gauge (F85): a bar whose alpha and ends change in one render and that turns into a
 * nine-slice at the second `next`, and a bar that grows and brightens in one render.
 */
export const gaugeScreen = projection({
  name: "exits.gauge",
  layer: "ui",
  from: (player: ExitsPlayer): Item => ({ id: "gauge", step: player.step }),
  view: (item: Item) => (
    <column key="gaugeRoot" style={{ width: 1080, height: 1080 }}>
      <stack
        key="gaugeBar"
        style={{
          width: 40,
          height: 40,
          shape: "arc",
          stroke: 0x33_33_33,
          strokeWidth: 4,
          sweep: 0.6,
          alpha: item.step === 0 ? 0.4 : 0.8,
          cap: item.step === 0 ? "round" : "butt",
          ...(item.step > 1 ? { nineSlice: "ui.panel" } : {})
        }}
        motion={barMotion}
      />
      <stack
        key="gaugeGrow"
        style={{
          width: item.step === 0 ? 40 : 80,
          height: 20,
          fill: 0x33_33_33,
          alpha: item.step === 0 ? 0.4 : 0.8
        }}
        motion={growMotion}
      />
      <button key="gaugeNext" intent="next" style={control} />
    </column>
  )
});

/** A game's own counter: the extra of the hooked image. */
export const Count = component("ExitsCount", { value: 0 });

/**
 * A `change` hook that plays nothing.
 *
 * @returns No motion.
 */
function still(): Motion {
  return undefined;
}

/**
 * The hooks of the hooked image at mount: its sprite, its rect, its pose and its extra, which `ui`
 * plays, and `Shape` and `Alpha`, which it never plays on an image without an `Alpha` extra.
 */
const idleFirst: ElementMotion = {
  change: {
    Sprite: still,
    Box: still,
    Transform: still,
    ExitsCount: still,
    Shape: still,
    Alpha: still
  }
};

/** The hooks of the hooked image once `next` was answered: the same and `Tick`, never played either. */
const idleNext: ElementMotion = { change: { ...idleFirst.change, Tick: still } };

/** The hooked image (F85): a dev build names the `change` hooks it never plays. */
export const idleScreen = projection({
  name: "exits.idle",
  layer: "ui",
  from: (player: ExitsPlayer): Item => ({ id: "idle", step: player.step }),
  view: (item: Item) => (
    <column key="idleRoot" style={{ width: 1080, height: 1080 }}>
      <image
        key="idlePic"
        texture="ui.coin"
        style={{ width: 40, height: 40 }}
        motion={item.step === 0 ? idleFirst : idleNext}
        components={[Count({ value: item.step })]}
      />
      <button key="idleNext" intent="next" style={control} />
    </column>
  )
});

const home = defineNode({ rest: true, outcomes: { next: type() } });

/** One commit that raises the counter. */
const next = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.step += 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, next },
  start: "home",
  outcomes: {},
  edges: { home: { next: "next" }, next: { done: "home" } }
});

/** The feature of the fixture. */
const exitsFeature = defineFeature("exits", {
  flows: [main],
  projections: [wardScreen, swapScreen, listScreen, ringScreen, gaugeScreen, idleScreen],
  ui: [Swap]
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(): Promise<void> {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
}

/**
 * Starts the fixture headless with one screen mounted and given the two frames of a reconcile and
 * a solve, the records emptied.
 *
 * @param screen - The projection name of the screen.
 * @returns The started app.
 */
export async function startExits(screen: string) {
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
      exitsFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { step: 0 }, initialSession: {}, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount([screen], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
  exits.length = 0;
  shapeCalls.length = 0;

  return app;
}

/** The app `startExits` builds. */
export type ExitsApp = Awaited<ReturnType<typeof startExits>>;

/**
 * Taps the button of that key, lets the runner commit, and steps the frame the commit lands in.
 *
 * @param app - The running app.
 * @param button - The key of a button whose intent is `next`.
 */
export async function answerNext(app: ExitsApp, button: string): Promise<void> {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  app.input.tap(app.ui.find(button) ?? 0);
  await tick();
  app.time.step(16);
}

/**
 * Steps frames of 16 ms.
 *
 * @param app - The running app.
 * @param count - How many.
 */
export function frames(app: ExitsApp, count: number): void {
  for (let frame = 0; frame < count; frame += 1) app.time.step(16);
}
