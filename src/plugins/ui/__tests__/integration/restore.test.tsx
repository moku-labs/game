import { describe, expect, it } from "vitest";
import {
  component,
  createApp,
  defineAnimation,
  defineComponent,
  defineGame,
  defineMotion,
  parallel,
  play,
  projection,
  Shape,
  screen,
  Transform,
  tween,
  type
} from "../../../../index";
import type { Target } from "../../../anim/types";
import { Pointer, PointerOver, Pressed } from "../../../input/components";
import type { Json } from "../../../model/types";
import { Parent } from "../../../renderer/components";
import { Scroll } from "../../components";
import type { ElementMotion } from "../../jsx/types";
import { tick as stackTick, startStackApp } from "../stack-app";

// ---------------------------------------------------------------------------
// Integration: after a restore a ui element stands exactly as if its root had
// just been mounted with the restored state. The screen is one constant item per
// state, so `from` hands out the same object for the same state and the restore
// remounts no projection. A timeline moves two elements off the screen and fades
// a third to nothing; the page is paused, `flow.restore` enters the rest node of
// the same screen, and frames are stepped by hand, as the control door does. The
// real flow, model, world, anim and ui plugins, inert renderer.
// ---------------------------------------------------------------------------

type Player = { dim: boolean; at: number };
type Session = { starts: number };
type Screen = { readonly id: string; readonly dim: boolean; readonly at: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The splash in each of its four states: constants, not model items. */
const SCREENS: readonly (readonly Screen[])[] = Object.freeze(
  [false, true].flatMap(dim =>
    [0, 1].map(at => Object.freeze([Object.freeze({ id: "splash", dim, at })]))
  )
);

/** Where the back hill stands on the Home end of its way, and how far the Board end is. */
const HOME = 40;
const TRAVEL = 300;

/** How far the marker of the back hill has travelled: 0 on Home, 1 on the Board. */
const Parallax = component("Parallax", { at: 0 });

/**
 * The target of an element of the splash.
 *
 * @param key - The key of the element.
 * @returns The target a timeline step takes.
 */
function view(key: string): Target {
  return { projection: "splash", key };
}

/** The exit of the splash: two giants fly away and the art fades to nothing. */
const leaveSplash = defineAnimation("splash.leave", {
  slots: {},
  build: () =>
    parallel(
      tween(view("splashX"), Transform, { y: -900 }, { ms: 400, ease: "linear" }),
      tween(view("splashO"), Transform, { y: -900 }, { ms: 400, ease: "linear" }),
      tween(view("splashArt"), Shape, { alpha: 0 }, { ms: 400, ease: "linear" })
    )
});

/** A sway of one second the second giant plays for as long as it lives. */
const sway = defineMotion({
  keyframes: {
    sway: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 0.5, ease: "linear", Transform: { rotation: 0.1 } },
      { at: 1, ease: "linear", Transform: { rotation: 0 } }
    ]
  },
  transition: { ms: 1000 },
  loop: { track: "sway" },
  on: {}
});

/**
 * The back hill: its `enter` hook puts it where its marker says and returns nothing, so the pose
 * stays off the layout rest. A new marker moves it there over 300 ms.
 */
const hillMotion: ElementMotion = {
  enter: hill => {
    hill.set(Transform, { x: HOME + (hill.get(Parallax)?.at ?? 0) * TRAVEL });
  },
  change: {
    Parallax: (hill, _previous: { at: number }, next: { at: number }) =>
      hill.tween(Transform, { x: HOME + next.at * TRAVEL }, { ms: 300, ease: "linear" })
  }
};

/** The front hill: it enters 40 u low and comes home after a delay. */
const holdMotion: ElementMotion = {
  enter: hill => {
    hill.set(Transform, { y: (hill.rest(Transform)?.y ?? 0) + 40 });

    return hill.toRest(Transform, { delayMs: 100, ms: 200, ease: "linear" });
  }
};

/**
 * A lamp the player switches on: the switch is local state, which no bookmark holds. Its row
 * takes the key of the component node, `lamp`.
 */
const Lamp = defineComponent("Lamp", {
  local: { lit: false },
  view: (_props: object, local) => (
    <row
      key="lampRow"
      style={{ width: 100, height: 60, fill: 0xaa_aa_00, alpha: local.lit ? 1 : 0.4 }}
    >
      <button key="lampSwitch" local={{ lit: true }} style={{ width: 40, height: 40 }} />
    </row>
  )
});

const splashScreen = projection({
  name: "splash",
  layer: "ui",
  from: (player: Player) =>
    SCREENS.find(([item]) => item?.dim === player.dim && item.at === player.at) ?? [],
  key: (item: Screen) => item.id,
  view: (item: Screen) => (
    <column key="splashRoot" style={{ width: 1080, height: 1080 }}>
      <row key="splashX" style={{ width: 200, height: 200, fill: 0x33_33_33 }} />
      <row key="splashO" style={{ width: 200, height: 200, fill: 0x33_33_33 }} motion={sway} />
      <row key="splashArt" style={{ width: 300, height: 100, fill: 0x55_55_55 }} />
      <row
        key="splashHint"
        style={{ width: 300, height: 60, fill: 0x77_77_77, is: { hover: { alpha: 0.5 } } }}
      />
      <row
        key="splashMode"
        style={{
          width: 300,
          height: 60,
          fill: 0x99_99_99,
          alpha: item.dim ? 0.3 : 1,
          offsetX: item.dim ? 50 : 0
        }}
      />
      <row
        key="hillBack"
        style={{ width: 300, height: 60, fill: 0x22_66_22 }}
        components={[Parallax({ at: item.at })]}
        motion={hillMotion}
      />
      <row
        key="hillFront"
        style={{ width: 300, height: 60, fill: 0x33_88_33 }}
        motion={holdMotion}
      />
      <Lamp key="lamp" />
      <scroll key="credits" axis="y" style={{ width: 400, height: 200 }}>
        <column key="lines" style={{ width: 400, height: 800 }} />
      </scroll>
    </column>
  )
});

/** Every keyed element of the splash. */
const KEYS = [
  "splashRoot",
  "splashX",
  "splashO",
  "splashArt",
  "splashHint",
  "splashMode",
  "hillBack",
  "hillFront",
  "lamp",
  "lampSwitch",
  "credits",
  "lines"
] as const;

const splash = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { start: type(), go: type() }
});

const leave = defineNode({
  outcomes: { done: type() },
  run: async ({ session, fx, out }) => {
    await fx(play(leaveSplash, {}));
    session.starts += 1;

    return out.done();
  }
});

const travel = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.at = player.at === 1 ? 0 : 1;

    return out.done();
  }
});

const menu = defineNode({ rest: true, outcomes: { dim: type() } });

const dimmer = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.dim = true;

    return out.done();
  }
});

const dimmed = defineNode({ rest: true, outcomes: { again: type() } });

const main = defineFlow("main", {
  nodes: { splash, leave, travel, menu, dimmer, dimmed },
  start: "splash",
  outcomes: {},
  edges: {
    splash: { start: "leave", go: "travel" },
    leave: { done: "menu" },
    travel: { done: "splash" },
    menu: { dim: "dimmer" },
    dimmer: { done: "dimmed" },
    dimmed: { again: "splash" }
  }
});

const splashFeature = defineFeature("splash", {
  flows: [main],
  components: [Parallax],
  projections: [splashScreen],
  animations: [leaveSplash],
  ui: [Lamp]
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 60): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** How many frames `startSplash` steps after it mounted the splash. */
const MOUNT_FRAMES = 3;

/** The player every test starts with: on the Board, not dimmed. */
const ON_BOARD: Player = { dim: false, at: 1 };

/**
 * Starts the screen set with the splash mounted, resting on the node `splash`.
 *
 * @param player - The player the app starts with: on the Board, not dimmed, unless named.
 * @returns The started app, `MOUNT_FRAMES` frames after the mount.
 */
async function startSplash(player: Player = ON_BOARD) {
  const app = createApp({
    plugins: [...screen, splashFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: player, initialSession: { starts: 0 }, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["splash"], { kind: "plugin", name: "test" });

  for (let frame = 0; frame < MOUNT_FRAMES; frame += 1) app.time.step(16);

  return app;
}

type SplashApp = Awaited<ReturnType<typeof startSplash>>;

/**
 * Reads the pose and the alpha the splash elements are drawn with.
 *
 * @param app - The running app.
 * @returns The `Transform` of the first giant, the place of the second and the alpha of the art.
 */
function pictureOf(app: SplashApp) {
  const giant = app.world.ecs.get(app.ui.find("splashX") ?? 0, Transform);
  const swayer = app.world.ecs.get(app.ui.find("splashO") ?? 0, Transform);

  return {
    giant: giant === undefined ? undefined : { ...giant },
    swayer: { x: swayer?.x, y: swayer?.y, scale: swayer?.scale },
    art: app.world.ecs.get(app.ui.find("splashArt") ?? 0, Shape)?.alpha
  };
}

/**
 * Reads what every keyed element of the splash is drawn with: its components by name. `Parent`
 * is left out: it names an entity, and an entity id is not the same in two apps.
 *
 * @param app - The running app.
 * @returns The components of each element, by key.
 */
function componentsOf(app: SplashApp): Record<string, Record<string, Json> | undefined> {
  const entities = app.world.ecs.snapshot().entities;
  const drawn: Record<string, Record<string, Json> | undefined> = {};

  for (const key of KEYS) {
    // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
    const entity = app.ui.find(key);
    const components = entities.find(row => row.id === entity)?.components;

    drawn[key] =
      components === undefined
        ? undefined
        : Object.fromEntries(Object.entries(components).filter(([name]) => name !== "Parent"));
  }

  return drawn;
}

/**
 * Starts the exit of the splash and runs it to its end: the graph rests on `menu`.
 *
 * @param app - The running app.
 */
async function playExit(app: SplashApp): Promise<void> {
  expect(app.flow.gate.answer({ intent: "start" })).toBe(true);
  await tick();

  for (let frame = 0; frame < 30; frame += 1) {
    app.time.step(16);
    await tick(4);
  }

  expect(app.flow.state().path).toBe("menu");
}

/**
 * Steps frames by hand, as the control door `game.step` does on a paused page.
 *
 * @param app - The running app.
 * @param frames - How many frames to step.
 */
function stepFrames(app: SplashApp, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) app.time.step(16);
}

/**
 * Drags the credits 200 u up and lets go.
 *
 * @param app - The running app.
 */
function scrollCredits(app: SplashApp): void {
  const container = app.ui.find("credits") ?? 0;
  const pointer = app.world.ecs.resource(Pointer);

  pointer.y = 500;
  app.world.ecs.tag(container, Pressed);
  app.time.step(16);
  pointer.y = 300;
  app.time.step(16);
  app.world.ecs.untag(container, Pressed);
  app.time.step(16);
}

/**
 * Reads where the credits stand: the offset of the scroll and the `y` of its content.
 *
 * @param app - The running app.
 * @returns The offset and the content pose.
 */
function creditsOf(app: SplashApp): { offset: number | undefined; y: number | undefined } {
  const content = app.world.ecs.get(app.ui.find("lines") ?? 0, Parent)?.entity ?? 0;

  return {
    offset: app.world.ecs.get(app.ui.find("credits") ?? 0, Scroll)?.offset,
    y: app.world.ecs.get(content, Transform)?.y
  };
}

describe("ui — a restore brings the elements of a screen home", () => {
  it("after the exit animation ended, on a paused page with stepped frames", async () => {
    const app = await startSplash();
    const atRest = pictureOf(app);
    const bookmark = app.flow.bookmark();

    expect(atRest.art).toBe(1);

    await playExit(app);

    expect(pictureOf(app)).toMatchObject({ giant: { y: -900 }, swayer: { y: -900 }, art: 0 });

    app.lifecycle.push("devtools");
    await app.flow.restore(bookmark);
    stepFrames(app, 3);

    expect(app.flow.state().path).toBe("splash");
    expect(app.time.isPaused()).toBe(true);
    expect(pictureOf(app)).toEqual(atRest);

    await app.stop();
  });

  it("after the restore aborted the exit animation half way", async () => {
    const app = await startSplash();
    const atRest = pictureOf(app);
    const bookmark = app.flow.bookmark();

    expect(app.flow.gate.answer({ intent: "start" })).toBe(true);
    await tick();
    stepFrames(app, 8);

    expect(pictureOf(app).art).toBeLessThan(1);

    app.lifecycle.push("devtools");
    await app.flow.restore(bookmark);
    stepFrames(app, 3);

    expect(app.flow.state().path).toBe("splash");
    expect(pictureOf(app)).toEqual(atRest);

    await app.stop();
  });

  it("starts the loop of an element again, on its rest pose", async () => {
    const app = await startSplash();
    const bookmark = app.flow.bookmark();

    await playExit(app);
    await app.flow.restore(bookmark);
    stepFrames(app, 2);

    const swayer = app.ui.find("splashO") ?? 0;
    let widest = 0;

    for (let frame = 0; frame < 70; frame += 1) {
      app.time.step(16);
      widest = Math.max(widest, app.world.ecs.get(swayer, Transform)?.rotation ?? 0);
    }

    expect(widest).toBeCloseTo(0.1, 1);
    // The sway is the one track left: no track of the exit survives, and the loop is back.
    expect(app.anim.active()).toBe(1);

    await app.stop();
  });

  it("ends on the rest pose of the restored state when that state has another look", async () => {
    const app = await startSplash();
    const modeOf = () => {
      const mode = app.ui.find("splashMode") ?? 0;

      return {
        x: app.world.ecs.get(mode, Transform)?.x,
        alpha: app.world.ecs.get(mode, Shape)?.alpha,
        restX: app.world.projection.restOf(mode, Transform)?.x,
        restAlpha: app.world.projection.restOf(mode, Shape)?.alpha
      };
    };
    const bright = modeOf();
    const bookmark = app.flow.bookmark();

    expect(bright).toMatchObject({ alpha: 1, restAlpha: 1, restX: bright.x });

    await playExit(app);

    expect(app.flow.gate.answer({ intent: "dim" })).toBe(true);
    await tick();
    stepFrames(app, 3);

    expect(app.flow.state().path).toBe("dimmed");
    expect(modeOf()).toMatchObject({ alpha: 0.3, x: (bright.x ?? 0) + 50 });

    app.lifecycle.push("devtools");
    await app.flow.restore(bookmark);
    stepFrames(app, 3);

    expect(modeOf()).toEqual(bright);

    await app.stop();
  });
});

describe("ui — after a restore an element stands as if its root had just been mounted", () => {
  it("puts an element where its enter hook puts it, not on its layout rest", async () => {
    const app = await startSplash();
    const hillX = (): number | undefined =>
      app.world.ecs.get(app.ui.find("hillBack") ?? 0, Transform)?.x;
    const onBoard = app.flow.bookmark();

    // Mounted on the Board: the enter hook put the hill on the Board end and returned nothing.
    expect(hillX()).toBe(HOME + TRAVEL);
    expect(app.world.projection.restOf(app.ui.find("hillBack") ?? 0, Transform)?.x).not.toBe(
      HOME + TRAVEL
    );

    // The same state again: the hill stands where a mount puts it.
    await app.flow.restore(onBoard);
    stepFrames(app, 2);

    expect(hillX()).toBe(HOME + TRAVEL);

    // The player goes Home: the `change` hook moves the hill there over 300 ms. The restored node
    // opens its gate a few microtasks after the restore resolved.
    await tick();
    expect(app.flow.gate.answer({ intent: "go" })).toBe(true);
    await tick();
    stepFrames(app, 30);

    expect(app.flow.state().path).toBe("splash");
    expect(hillX()).toBe(HOME);

    const atHome = app.flow.bookmark();

    // Another state of the same screen: the enter pose of that state, at once, with no motion.
    await app.flow.restore(onBoard);
    stepFrames(app, 2);

    expect(hillX()).toBe(HOME + TRAVEL);

    await app.flow.restore(atHome);
    stepFrames(app, 2);

    expect(hillX()).toBe(HOME);

    await app.stop();
  });

  it("draws every element with the components of a fresh mount of the same state", async () => {
    const restored = await startSplash();
    const bookmark = restored.flow.bookmark();

    // Leave the mounted picture in every way the screen allows.
    scrollCredits(restored);
    restored.world.ecs.tag(restored.ui.find("splashHint") ?? 0, PointerOver);
    restored.input.tap(restored.ui.find("lampSwitch") ?? 0);
    stepFrames(restored, 2);

    expect(restored.world.ecs.get(restored.ui.find("lamp") ?? 0, Shape)?.alpha).toBe(1);

    expect(restored.flow.gate.answer({ intent: "go" })).toBe(true);
    await tick();
    stepFrames(restored, 5);
    await playExit(restored);

    expect(creditsOf(restored).offset).toBe(-200);

    restored.lifecycle.push("devtools");
    await restored.flow.restore(bookmark);
    stepFrames(restored, MOUNT_FRAMES + 9);

    // A second app mounts the same state and steps the same number of frames.
    const fresh = await startSplash();

    stepFrames(fresh, 9);

    // The front hill is on its way home and the second giant sways: both at the same instant.
    expect(componentsOf(fresh).hillFront?.Transform).not.toEqual(
      fresh.world.projection.restOf(fresh.ui.find("hillFront") ?? 0, Transform)
    );
    expect(componentsOf(restored)).toEqual(componentsOf(fresh));
    expect(restored.ui.tree()).toEqual(fresh.ui.tree());

    await restored.stop();
    await fresh.stop();
  });

  it("gives a view a slot hosts its slot back, the new one", async () => {
    const app = await startStackApp();
    const parents = (): (number | undefined)[] =>
      app.world.projection
        .entitiesOf("tokens")
        .map(entity => app.world.ecs.get(entity, Parent)?.entity);

    app.world.projection.mount(["tokens", "slotScreen"], { kind: "plugin", name: "test" });
    app.time.step(16);

    // The first frame after a mount: the slot is built and not live yet.
    expect(parents()).toEqual([undefined, undefined]);

    app.time.step(16);
    app.time.step(16);

    const slot = app.ui.find("slot");
    const bookmark = app.flow.bookmark();

    expect(parents()).toEqual([slot, slot]);

    await app.flow.restore(bookmark);
    await stackTick();
    app.time.step(16);

    // The frame that builds the roots again: the old slot is gone and the new one is not live
    // yet, exactly as in the first frame after the mount above.
    expect(parents()).toEqual([undefined, undefined]);

    app.time.step(16);

    const again = app.ui.find("slot");

    expect(again).toBeDefined();
    expect(again).not.toBe(slot);
    expect(parents()).toEqual([again, again]);

    await app.stop();
  });

  it("puts a scrolled list back to its top, as a remount of the screen does", async () => {
    const app = await startSplash();
    const bookmark = app.flow.bookmark();
    const top = creditsOf(app);

    expect(top.offset).toBe(0);

    // What a remount of the screen does to the offset: the measure a restore has to match.
    scrollCredits(app);
    expect(creditsOf(app).offset).toBe(-200);

    app.world.projection.unmount(["splash"]);
    app.world.projection.mount(["splash"], { kind: "plugin", name: "test" });
    stepFrames(app, MOUNT_FRAMES);

    expect(creditsOf(app)).toEqual(top);

    scrollCredits(app);
    expect(creditsOf(app).offset).toBe(-200);

    await app.flow.restore(bookmark);
    stepFrames(app, MOUNT_FRAMES);

    expect(creditsOf(app)).toEqual(top);

    await app.stop();
  });
});

describe("ui — the rest the world holds for an element is the one it is drawn with", () => {
  it("follows a look the element took since it entered", async () => {
    const app = await startSplash();
    const hint = app.ui.find("splashHint") ?? 0;

    app.world.ecs.tag(hint, PointerOver);
    app.time.step(16);

    expect(app.world.ecs.get(hint, Shape)?.alpha).toBe(0.5);
    expect(app.world.projection.restOf(hint, Shape)?.alpha).toBe(0.5);

    await app.stop();
  });

  it("keeps the look and a scrolled list while the world is paused and ui cannot build", async () => {
    const app = await startSplash();
    const hint = app.ui.find("splashHint") ?? 0;
    const bookmark = app.flow.bookmark();

    scrollCredits(app);
    app.world.ecs.tag(hint, PointerOver);
    app.time.step(16);

    const scrolled = creditsOf(app);

    expect(scrolled.offset).toBe(-200);

    // A paused world runs the reconcile and no phase `layout`: the world brings the elements
    // home, and `ui` builds the roots again only when the world runs.
    app.world.ecs.setMode("paused");
    await app.flow.restore(bookmark);
    stepFrames(app, 2);

    expect(app.ui.find("splashHint")).toBe(hint);
    expect(app.world.ecs.get(hint, Shape)?.alpha).toBe(0.5);
    expect(creditsOf(app)).toEqual(scrolled);

    app.world.ecs.setMode("live");
    stepFrames(app, MOUNT_FRAMES);

    expect(app.ui.find("splashHint")).not.toBe(hint);
    expect(creditsOf(app).offset).toBe(0);

    await app.stop();
  });
});
