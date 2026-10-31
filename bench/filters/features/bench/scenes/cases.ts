/**
 * @file The case scenes: each stands for one kind of filter work a real game does.
 */
import {
  Alpha,
  Blur,
  bind,
  ColorMatrix,
  Countdown,
  Glow,
  Outline,
  Shape,
  Sprite,
  Text,
  Transform,
  type World
} from "../../../../../src/index.ts";
import { Emitter } from "../../../kit";
import {
  FlipFold,
  FogDevelopLive,
  FogDevelopLocal,
  FogWipeLive,
  FogWipeLocal,
  FullGrade,
  LensWindow,
  ObjectGlow,
  PromoMap,
  PromoMirror,
  PromoProcedural,
  PromoStroke,
  RootTint,
  Shadow
} from "../filters";
import { fullSprite, loop, PICTURE, ramped } from "./shared";
import type { BenchScene, Stage } from "./types";

/** The items of `fade` and `entry`, and the pictures of `scale` and `scale-up`. */
const ITEMS = 40;

/** The side of one item. */
const ITEM_SIDE = 64;

/** Items a row. */
const ROW = 5;

/** A far end for a countdown: it ticks once a second through the whole run. */
const AN_HOUR = 3_600_000;

/** The default number of glows of `glow`; `#glow&n=24` names another. */
const GLOWS = 12;

/** The steps of `scale`, of the page's own resolution, each held 2 s. */
const SCALE_STEPS = [1, 0.85, 0.75, 0.85] as const;

/** How long one step of `scale` and of `scale-up` holds. */
const SCALE_STEP_MS = 2000;

/** The fill the pictures of `scale` and `scale-up` are spawned with. */
const SCALE_FILL = 0x33_88_ff;

/** The fill the pictures of `scale-up` change to every other loop, and back the loop after. */
const SCALE_UP_FILL = 0xf2_b4_3d;

/** The low step of `scale-up`, of the page's own resolution. */
const SCALE_UP_LOW = 0.75;

/** How long after the step down the pictures of `scale-up` change: they are taken low from then on. */
const SCALE_UP_CHANGE_MS = 300;

/** The cross-dissolve of `fade`. */
const DISSOLVE_MS = 420;

/** One turn of `fade`: there and back, each dissolve followed by a rest. */
const FADE_TURN_MS = 2000;

/**
 * Where the n-th item of a grid stands.
 *
 * @param index - The item.
 * @returns Its place.
 * @example
 * ```ts
 * itemAt(6); // { x: 94, y: 90 }
 * ```
 */
function itemAt(index: number): { x: number; y: number } {
  return { x: 16 + (index % ROW) * 78, y: 12 + Math.floor(index / ROW) * 78 };
}

/**
 * One root of `fade`: 390 wide, 40 shadowed items, a once-a-second countdown, an emitter.
 *
 * @param stage - The stage.
 * @param fill - Its colour.
 * @param alpha - Where its dissolve starts.
 * @returns The root.
 */
function fadeRoot(stage: Stage, fill: number, alpha: number): World.Entity {
  const root = stage.spawn(
    Transform({ x: 0, y: 0 }),
    Shape({ w: 390, h: stage.height, fill }),
    Alpha({ alpha })
  );

  for (let index = 0; index < ITEMS; index += 1) {
    stage.child(
      root,
      Transform(itemAt(index)),
      Shape({ w: ITEM_SIDE, h: ITEM_SIDE, fill: 0xf2_b4_3d, radius: 12 }),
      Shadow()
    );
  }

  stage.child(
    root,
    Transform({ x: 195, y: 760 }),
    Countdown({ until: stage.now() + AN_HOUR }),
    Text({ style: "bench.digits", bind: bind(Countdown, "left", { format: "mm:ss" }) })
  );
  stage.child(root, Transform({ x: 195, y: 700 }), Emitter({ effect: "fx.ember", active: true }));

  return root;
}

/** Two rooms in a loop of dissolves. */
const fadeScene: BenchScene = {
  name: "fade",
  stands: "the screen fade: two rooms of shadowed items, a timer tag and an emitter dissolving",
  mount: stage => {
    const from = fadeRoot(stage, 0x1b_2a_6b, 1);
    const to = fadeRoot(stage, 0x8a_2b_5e, 0);

    return {
      tick: elapsedMs => {
        const at = loop(elapsedMs, FADE_TURN_MS);
        const there = ramped(at, DISSOLVE_MS / FADE_TURN_MS);
        const back = ramped(Math.max(at - 0.5, 0), DISSOLVE_MS / FADE_TURN_MS);
        const shown = there - back;

        stage.set(from, Alpha, { alpha: 1 - shown });
        stage.set(to, Alpha, { alpha: shown });
      }
    };
  }
};

/** One turn of `entry`: the items mount, grow in, and stand a while. */
const ENTRY_TURN_MS = 1500;

/** The time an entry takes to grow in. */
const ENTRY_GROW_MS = 300;

/**
 * Spawns the items of `entry`.
 *
 * @param stage - The stage.
 * @returns The items.
 */
function entryItems(stage: Stage): World.Entity[] {
  const items: World.Entity[] = [];

  for (let index = 0; index < ITEMS; index += 1) {
    items.push(
      stage.spawn(
        Transform({ ...itemAt(index), scale: 0.5 }),
        Shape({ w: ITEM_SIDE, h: ITEM_SIDE, fill: 0x3f_a9_f5, radius: 12 }),
        Shadow(),
        Outline({ thickness: 2, color: 0xff_ff_ff })
      )
    );
  }

  return items;
}

/** A board that mounts again and again. */
const entryScene: BenchScene = {
  name: "entry",
  stands: "a board entry: 40 items with shadow and outline mounting at once",
  mount: stage => {
    fullSprite(stage);

    const state = { items: entryItems(stage), turn: 0 };

    return {
      tick: elapsedMs => {
        const turn = Math.floor(elapsedMs / ENTRY_TURN_MS);

        if (turn !== state.turn) {
          state.turn = turn;
          for (const item of state.items) stage.despawn(item);
          state.items = entryItems(stage);
        }

        const scale = 0.5 + 0.5 * ramped(elapsedMs % ENTRY_TURN_MS, ENTRY_GROW_MS);

        for (const item of state.items) stage.set(item, Transform, { scale });
      }
    };
  }
};

/** N glows breathing under a filtered root. */
const glowScene: BenchScene = {
  name: "glow",
  stands: "ward idle: placed object glows, breath and glint uniforms, under a filtered root",
  mount: stage => {
    const root = stage.spawn(
      Transform({ x: 0, y: 0 }),
      Sprite({
        texture: PICTURE,
        width: stage.width,
        height: stage.height,
        anchor: { x: 0, y: 0 }
      }),
      RootTint()
    );
    const glows: World.Entity[] = [];
    const count = stage.n ?? GLOWS;

    for (let index = 0; index < count; index += 1) {
      glows.push(
        stage.child(
          root,
          Transform(itemAt(index)),
          Sprite({ texture: PICTURE, width: ITEM_SIDE, height: ITEM_SIDE, anchor: { x: 0, y: 0 } }),
          ObjectGlow()
        )
      );
    }

    return {
      tick: elapsedMs => {
        const breath = Math.sin(elapsedMs / 900);
        const glint = elapsedMs / 400;

        for (const glow of glows) stage.set(glow, ObjectGlow, { breath, glint });
      }
    };
  }
};

/** The strongest blur of the sweep. */
const SWEEP_BLUR = 16;

/** Blur and colour over the whole screen, ramped in a loop. */
const sweepScene: BenchScene = {
  name: "sweep",
  stands: "the connect sweep: Blur at quality 4 and a ColorMatrix over the full screen",
  mount: stage => {
    const root = stage.spawn(
      Transform({ x: 0, y: 0 }),
      Sprite({
        texture: PICTURE,
        width: stage.width,
        height: stage.height,
        anchor: { x: 0, y: 0 }
      }),
      Blur({ strength: 0, quality: 4 }),
      ColorMatrix({ grayscale: 0 })
    );

    return {
      tick: elapsedMs => {
        const at = loop(elapsedMs, 1000);

        stage.set(root, Blur, { strength: at * SWEEP_BLUR });
        stage.set(root, ColorMatrix, { grayscale: at });
      }
    };
  }
};

/** The tiles of `fog`. */
const FOG_TILES = 12;

/** The side of a tile of `fog`. */
const FOG_TILE_SIDE = 128;

/** One turn of `fog`: the wipes run, then the screen stands still. */
const FOG_TURN_MS = 2000;

/**
 * The fog over tiles and over a 2048 × 1024 layer.
 *
 * @param name - The scene's name.
 * @param stands - What it stands for.
 * @param wipe - The filter of a tile.
 * @param develop - The filter of the wide layer.
 * @returns The scene.
 */
function fogScene(
  name: string,
  stands: string,
  wipe: typeof FogWipeLive,
  develop: typeof FogDevelopLive
): BenchScene {
  return {
    name,
    stands,
    mount: stage => {
      const layer = stage.spawn(
        Transform({ x: -800, y: -100 }),
        Sprite({ texture: PICTURE, width: 2048, height: 1024, anchor: { x: 0, y: 0 } }),
        develop({ radius: 0 })
      );
      const tiles: World.Entity[] = [];

      for (let index = 0; index < FOG_TILES; index += 1) {
        tiles.push(
          stage.spawn(
            Transform({ x: (index % 3) * 130, y: Math.floor(index / 3) * 130 }),
            Sprite({
              texture: PICTURE,
              width: FOG_TILE_SIDE,
              height: FOG_TILE_SIDE,
              anchor: { x: 0, y: 0 }
            }),
            wipe({ radius: 0 })
          )
        );
      }

      return {
        tick: elapsedMs => {
          const at = loop(elapsedMs, FOG_TURN_MS);

          // The second half of a turn writes nothing: a "local" picture rests there.
          if (at > 0.5) return;

          const radius = at * 2;

          stage.set(layer, develop, { radius });
          for (const tile of tiles) stage.set(tile, wipe, { radius });
        }
      };
    }
  };
}

/** The wipes drawn live in every frame. */
const fogLiveScene = fogScene(
  "fog",
  "FogWipe and FogDevelop on tiles and a 2048 x 1024 layer, cache: false",
  FogWipeLive,
  FogDevelopLive
);

/** The same wipes, kept as pictures between two writes. */
const fogLocalScene = fogScene(
  "fog-local",
  'the same fog with cache: "local": what stage 4 would win',
  FogWipeLocal,
  FogDevelopLocal
);

/** A card folding round and round. */
const flipScene: BenchScene = {
  name: "flip",
  stands: "the flip and fold of a card: a perspective body that reads the canvas origin",
  mount: stage => {
    fullSprite(stage);

    const card = stage.spawn(
      Transform({ x: 45, y: 212 }),
      Shape({ w: 300, h: 420, fill: 0xf2_b4_3d, radius: 24 }),
      FlipFold()
    );

    stage.child(
      card,
      Transform({ x: 40, y: 80 }),
      Sprite({ texture: PICTURE, width: 220, height: 260, anchor: { x: 0, y: 0 } })
    );

    return {
      tick: elapsedMs => stage.set(card, FlipFold, { angle: elapsedMs / 400 })
    };
  }
};

/**
 * Spawns the kept pictures of `scale` and `scale-up`.
 *
 * @param stage - The stage.
 * @returns The pictures.
 */
function scalePictures(stage: Stage): World.Entity[] {
  const pictures: World.Entity[] = [];

  for (let index = 0; index < ITEMS; index += 1) {
    pictures.push(
      stage.spawn(
        Transform(itemAt(index)),
        Shape({ w: ITEM_SIDE, h: ITEM_SIDE, fill: SCALE_FILL, radius: 12 }),
        Glow({ strength: 2, distance: 8 })
      )
    );
  }

  return pictures;
}

/** 40 kept pictures under a stepping render scale. */
export const scaleScene: BenchScene = {
  name: "scale",
  stands: "the adaptive render scale: 40 kept pictures under steps of 1, 0.85, 0.75 (debug page)",
  mount: stage => {
    const base = stage.setResolution(undefined);
    const state = { step: -1 };

    scalePictures(stage);

    return {
      tick: elapsedMs => {
        const step = Math.floor(elapsedMs / SCALE_STEP_MS);

        if (step === state.step) return;

        state.step = step;
        stage.setResolution(base * (SCALE_STEPS[step % SCALE_STEPS.length] ?? 1));
      },
      leave: () => {
        stage.setResolution(undefined);
      }
    };
  }
};

/** The same 40 pictures, changed while the scale is low, so that the step up owes a take of each. */
export const scaleUpScene: BenchScene = {
  name: "scale-up",
  stands: "the step up of the render scale: 40 pictures taken at 0.75, then all owing a take",
  mount: stage => {
    const base = stage.setResolution(undefined);
    const pictures = scalePictures(stage);
    const state = { lowered: -1, changed: -1, raised: -1 };

    return {
      tick: elapsedMs => {
        const turn = Math.floor(elapsedMs / (2 * SCALE_STEP_MS));
        const at = elapsedMs % (2 * SCALE_STEP_MS);

        if (turn !== state.lowered) {
          state.lowered = turn;
          stage.setResolution(base * SCALE_UP_LOW);
        }

        if (at >= SCALE_UP_CHANGE_MS && turn !== state.changed) {
          const fill = turn % 2 === 0 ? SCALE_UP_FILL : SCALE_FILL;

          state.changed = turn;
          for (const picture of pictures) stage.set(picture, Shape, { fill });
        }

        if (at >= SCALE_STEP_MS && turn !== state.raised) {
          state.raised = turn;
          stage.setResolution(base);
        }
      },
      leave: () => {
        stage.setResolution(undefined);
      }
    };
  }
};

/** A soft window opening over a picture and a subtree. */
const lensScene: BenchScene = {
  name: "lens",
  stands: "LensWindow: a soft round window opening over a picture and a subtree",
  mount: stage => {
    fullSprite(stage);

    const lens = stage.spawn(
      Transform({ x: 0, y: 0 }),
      Sprite({
        texture: PICTURE,
        width: stage.width,
        height: stage.height,
        anchor: { x: 0, y: 0 }
      }),
      LensWindow({ x: stage.width / 2, y: stage.height / 2, reach: 40 })
    );

    for (let index = 0; index < 6; index += 1) {
      stage.child(
        lens,
        Transform({ x: 90 + index * 40, y: 380 }),
        Shape({ w: 32, h: 80, fill: 0x3f_a9_f5, radius: 8 })
      );
    }

    return {
      tick: elapsedMs => {
        const open = ramped(loop(elapsedMs, 2000), 0.5);

        stage.set(lens, LensWindow, { reach: 40 + open * 140 });
      }
    };
  }
};

/** Promo: four kinds of body at once. */
const promoScene: BenchScene = {
  name: "promo",
  stands:
    "the promo: a perspective map of live text, a procedural quad, a mirrored column, a stroke sweep",
  mount: stage => {
    fullSprite(stage);

    const map = stage.spawn(
      Transform({ x: 195, y: 120 }),
      Countdown({ until: stage.now() + AN_HOUR }),
      Text({ style: "bench.digits", bind: bind(Countdown, "left", { format: "mm:ss" }) }),
      PromoMap()
    );
    const quad = stage.spawn(
      Transform({ x: 40, y: 200 }),
      Shape({ w: 310, h: 160, fill: 0xff_ff_ff }),
      PromoProcedural()
    );
    const column = stage.spawn(
      Transform({ x: 40, y: 380 }),
      Sprite({ texture: PICTURE, width: 120, height: 400, anchor: { x: 0, y: 0 } }),
      PromoMirror()
    );
    const stroke = stage.spawn(
      Transform({ x: 190, y: 380 }),
      Shape({ w: 160, h: 400, stroke: 0xf2_b4_3d, strokeWidth: 6, radius: 24 }),
      PromoStroke()
    );

    return {
      tick: elapsedMs => {
        stage.set(quad, PromoProcedural, { time: elapsedMs / 300 });
        stage.set(stroke, PromoStroke, { sweep: loop(elapsedMs, 1500) });
        stage.set(map, PromoMap, { tilt: 0.5 + 0.2 * Math.sin(elapsedMs / 700) });
        stage.set(column, Transform, { y: 380 + Math.sin(elapsedMs / 500) });
      }
    };
  }
};

/** One full-screen live filter, for the slope's other end: the price of one megapixel count. */
const fullScene: BenchScene = {
  name: "full",
  stands: "a whole-screen live grade: the price per Mpx, one break",
  mount: stage => {
    fullSprite(stage);

    const graded = stage.spawn(
      Transform({ x: 0, y: 0 }),
      Sprite({
        texture: PICTURE,
        width: stage.width,
        height: stage.height,
        anchor: { x: 0, y: 0 }
      }),
      FullGrade()
    );

    return {
      tick: elapsedMs => stage.set(graded, FullGrade, { phase: elapsedMs / 100 })
    };
  }
};

/** Every case scene. */
export const CASE_SCENES: readonly BenchScene[] = [
  fullScene,
  fadeScene,
  entryScene,
  glowScene,
  sweepScene,
  fogLiveScene,
  fogLocalScene,
  flipScene,
  scaleScene,
  scaleUpScene,
  lensScene,
  promoScene
];
