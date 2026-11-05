/**
 * @file The case scenes: each stands for one kind of filter work a real game does.
 */
import {
  Alpha,
  Aura,
  Bloom,
  Blur,
  bind,
  ColorMatrix,
  Countdown,
  Dissolve,
  Flash,
  Fold,
  Glow,
  Grade,
  Outline,
  RevealLine,
  RevealRound,
  Shape,
  Shine,
  Sprite,
  Text,
  Transform,
  Vignette,
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
  RestShade,
  RootTint,
  RowFlip,
  RowFlipLive,
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

/** One turn of `scale-up`: a step low, then a step back. */
const SCALE_UP_TURN_MS = 2 * SCALE_STEP_MS;

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
        const turn = Math.floor(elapsedMs / SCALE_UP_TURN_MS);
        const at = elapsedMs % SCALE_UP_TURN_MS;

        // Down first: the fill change below is taken at the low scale.
        if (turn !== state.lowered) {
          state.lowered = turn;
          stage.setResolution(base * SCALE_UP_LOW);
        }

        // A new fill, so the pictures are taken again at the low scale.
        if (at >= SCALE_UP_CHANGE_MS && turn !== state.changed) {
          const fill = turn % 2 === 0 ? SCALE_UP_FILL : SCALE_FILL;

          state.changed = turn;
          for (const picture of pictures) stage.set(picture, Shape, { fill });
        }

        // Back up: all 40 pictures now owe a take at once.
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

/** The order rows of `rows` and `rows-live`. */
const ROWS = 8;

/** The kept pictures of `rest`. */
const RESTING = 24;

/** The drawn frames of `rows-enter`'s turn of writes before its views run on their shaders: the engine's third write. */
const ENTRY_WRITE = 3;

/** The drawn frames after the last write until its views leave their shaders: the engine's calm. */
const LEAVE_AFTER = 30;

/** Half a turn of `rows-enter`: it writes for this long, then rests for as long. */
const ENTER_TURN_MS = 2000;

/**
 * The rows of `rows`, `rows-live` and the `set-*` arms over a full-screen sprite: 340 × 72 each, a sprite in it.
 *
 * @param stage - The stage.
 * @param filter - Makes the filter of one row.
 * @returns The rows.
 */
function spawnRows(stage: Stage, filter: () => World.AnyComponentValue): World.Entity[] {
  fullSprite(stage);

  const rows: World.Entity[] = [];
  const count = stage.n ?? ROWS;

  for (let index = 0; index < count; index += 1) {
    const row = stage.spawn(
      Transform({ x: 25, y: 120 + index * 84 }),
      Shape({ w: 340, h: 72, fill: 0xf2_b4_3d, radius: 12 }),
      filter()
    );

    stage.child(
      row,
      Transform({ x: 12, y: 8 }),
      Sprite({ texture: PICTURE, width: 56, height: 56, anchor: { x: 0, y: 0 } })
    );
    rows.push(row);
  }

  return rows;
}

/**
 * Order rows flipping all the time.
 *
 * @param name - The scene.
 * @param stands - What it stands for.
 * @param filter - The filter of a row.
 * @returns The scene.
 */
function rowScene(name: string, stands: string, filter: typeof RowFlip): BenchScene {
  return {
    name,
    stands,
    mount: stage => {
      const rows = spawnRows(stage, () => filter());

      return {
        tick: elapsedMs => {
          for (const [index, row] of rows.entries()) {
            stage.set(row, filter, { angle: elapsedMs / 500 + index * 0.4 });
          }
        }
      };
    }
  };
}

/** Kept pictures that never change, over one small sprite moving so a frame is drawn. */
const restScene: BenchScene = {
  name: "rest",
  stands: "kept pictures at rest: a batched sprite each, no shader running",
  mount: stage => {
    fullSprite(stage);

    const mover = stage.spawn(
      Transform({ x: 0, y: 700 }),
      Sprite({ texture: PICTURE, width: 8, height: 8, anchor: { x: 0, y: 0 } })
    );
    const count = stage.n ?? RESTING;

    for (let index = 0; index < count; index += 1) {
      const item = stage.spawn(
        Transform(itemAt(index)),
        Shape({ w: ITEM_SIDE, h: ITEM_SIDE, fill: 0x33_88_ff, radius: 12 }),
        RestShade()
      );

      stage.child(
        item,
        Transform({ x: 8, y: 8 }),
        Sprite({ texture: PICTURE, width: 32, height: 32, anchor: { x: 0, y: 0 } })
      );
    }

    return { tick: elapsedMs => stage.set(mover, Transform, { x: (elapsedMs / 20) % 300 }) };
  }
};

/** Forty small views that write their numbers together, then rest together: every entry and leaving of a screen. */
const rowsEnterScene: BenchScene = {
  name: "rows-enter",
  stands:
    "40 views entering their shaders in one frame, leaving two a flush: the entry and leaving marked in the row",
  mount: stage => {
    fullSprite(stage);

    const views: World.Entity[] = [];

    for (let index = 0; index < ITEMS; index += 1) {
      views.push(
        stage.spawn(
          Transform(itemAt(index)),
          Shape({ w: ITEM_SIDE, h: ITEM_SIDE, fill: 0xf2_b4_3d, radius: 12 }),
          RowFlip()
        )
      );
    }

    let writes = 0;
    let rests = 0;

    return {
      tick: elapsedMs => {
        if (elapsedMs % (2 * ENTER_TURN_MS) >= ENTER_TURN_MS) {
          writes = 0;
          rests += 1;
          if (rests === LEAVE_AFTER) stage.mark("rows-enter leaving");

          return;
        }

        rests = 0;
        writes += 1;
        if (writes === ENTRY_WRITE) stage.mark("rows-enter entry");

        for (const view of views) stage.set(view, RowFlip, { angle: elapsedMs / 500 });
      }
    };
  }
};

/** A turn of a value the `set-*` arms write: a sine of the time, each row a step behind the one above. */
const SET_TURN_MS = 500;

/**
 * Where a value of a `set-*` arm stands: a sine of the time, each row 0.4 rad behind the one above it.
 *
 * @param elapsedMs - The time.
 * @param index - The row.
 * @returns From -1 to 1.
 * @example
 * ```ts
 * wave(0, 0); // 0
 * ```
 */
function wave(elapsedMs: number, index: number): number {
  return Math.sin(elapsedMs / SET_TURN_MS + index * 0.4);
}

/**
 * The rows of `rows` under a member of the engine's effect set, its first number written in every frame: after its
 * third write a row draws on its quad in the canvas pass.
 *
 * @param name - The scene.
 * @param stands - What it stands for.
 * @param member - The member.
 * @param write - The patch of one row in one frame.
 * @returns The scene.
 */
function memberRowScene<Value extends object>(
  name: string,
  stands: string,
  member: World.ComponentType<Value>,
  write: (elapsedMs: number, index: number) => Partial<Value>
): BenchScene {
  return {
    name,
    stands,
    mount: stage => {
      const rows = spawnRows(stage, () => member());

      return {
        tick: elapsedMs => {
          for (const [index, row] of rows.entries())
            stage.set(row, member, write(elapsedMs, index));
        }
      };
    }
  };
}

/**
 * One full-screen view over the full-screen sprite, its filter written in every frame: the `full` shape.
 *
 * @param name - The scene.
 * @param stands - What it stands for.
 * @param filter - The filter, as a component.
 * @param write - The patch of one frame.
 * @returns The scene.
 */
function fullWriteScene<Value extends object>(
  name: string,
  stands: string,
  filter: World.ComponentType<Value>,
  write: (elapsedMs: number) => Partial<Value>
): BenchScene {
  return {
    name,
    stands,
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
        filter()
      );

      return { tick: elapsedMs => stage.set(graded, filter, write(elapsedMs)) };
    }
  };
}

/**
 * The arms of the engine's effect set (F126 stage 3 slices 1 and 2), and Pixi's colour matrix beside the full-screen
 * grade.
 */
const SET_SCENES: readonly BenchScene[] = [
  memberRowScene(
    "set-flash",
    "the rows under Flash, its amount written each frame: on the quad",
    Flash,
    (elapsedMs, index) => ({ amount: 0.5 + 0.5 * wave(elapsedMs, index) })
  ),
  memberRowScene(
    "set-grade",
    "the rows under Grade, its brightness written each frame: on the quad",
    Grade,
    (elapsedMs, index) => ({ brightness: 1 + 0.3 * wave(elapsedMs, index) })
  ),
  memberRowScene(
    "set-vignette",
    "the rows under Vignette, its x written each frame: on the quad",
    Vignette,
    (elapsedMs, index) => ({ x: 0.5 + 0.2 * wave(elapsedMs, index) })
  ),
  fullWriteScene(
    "set-grade-full",
    "one full-screen Grade, its brightness written each frame: on the quad",
    Grade,
    elapsedMs => ({ brightness: 1 + 0.3 * wave(elapsedMs, 0) })
  ),
  fullWriteScene(
    "sweep-grade",
    "the same screen under Pixi's ColorMatrix, its brightness written each frame: a pass for every value",
    ColorMatrix,
    elapsedMs => ({ brightness: 1 + 0.3 * wave(elapsedMs, 0) })
  ),
  // Slice 2: each member's first number written each frame, over its range.
  memberRowScene(
    "set-reveal-line",
    "the rows under RevealLine, its progress written each frame: on the quad",
    RevealLine,
    (elapsedMs, index) => ({ progress: 0.5 + 0.5 * wave(elapsedMs, index) })
  ),
  memberRowScene(
    "set-reveal-round",
    "the rows under RevealRound, its radius written each frame: on the quad",
    RevealRound,
    (elapsedMs, index) => ({ radius: 0.75 + 0.75 * wave(elapsedMs, index) })
  ),
  memberRowScene(
    "set-dissolve",
    "the rows under Dissolve, its progress written each frame: on the quad",
    Dissolve,
    (elapsedMs, index) => ({ progress: 0.5 + 0.5 * wave(elapsedMs, index) })
  ),
  memberRowScene(
    "set-shine",
    "the rows under Shine, its position written each frame: on the quad",
    Shine,
    (elapsedMs, index) => ({ position: 0.5 + wave(elapsedMs, index) })
  ),
  memberRowScene(
    "set-aura",
    "the rows under Aura, its strength written each frame: on the quad, 13 samples, padded by its spread",
    Aura,
    (elapsedMs, index) => ({ strength: 1 + wave(elapsedMs, index) })
  ),
  memberRowScene(
    "set-fold",
    "the rows under Fold, its angle written each frame: on the quad, padded by 8, the shape of rows",
    Fold,
    (elapsedMs, index) => ({ angle: elapsedMs / 500 + index * 0.4 })
  )
];

/** The tiles of the `set-bloom` arms: the 12 of `fog`, 128 × 128 each. */
const BLOOM_TILES = 12;

/** The strength a `set-bloom` arm writes, the member's default. */
const BLOOM_STRENGTH = 0.6;

/** How far a moving `Bloom`'s strength swings around `BLOOM_STRENGTH`. */
const BLOOM_WAVE = 0.4;

/**
 * Twelve tiles of 128 × 128 under `Bloom`, three a row, and what the arm writes of them.
 *
 * @param name - The arm.
 * @param stands - What it measures.
 * @param start - The strength each tile's `Bloom` starts at.
 * @param writes - Given the stage and the tiles once they stand, answers the write of each frame.
 * @returns The scene.
 */
function bloomTilesScene(
  name: string,
  stands: string,
  start: number,
  writes: (stage: Stage, tiles: readonly World.Entity[]) => (elapsedMs: number) => void
): BenchScene {
  return {
    name,
    stands,
    mount: stage => {
      fullSprite(stage);

      const tiles: World.Entity[] = [];

      for (let index = 0; index < BLOOM_TILES; index += 1) {
        tiles.push(
          stage.spawn(
            Transform({ x: (index % 3) * 130, y: Math.floor(index / 3) * 130 }),
            Sprite({
              texture: PICTURE,
              width: FOG_TILE_SIDE,
              height: FOG_TILE_SIDE,
              anchor: { x: 0, y: 0 }
            }),
            Bloom({ strength: start })
          )
        );
      }

      return { tick: writes(stage, tiles) };
    }
  };
}

/**
 * The arms of `Bloom` (F126 stage 3 slice 3, its second shape): every tile moving, every tile kept, and one moving
 * among eleven kept. A chain member has no quad, so a moving tile runs its chain and redraws stage 3, 3 passes, in
 * every frame; a still one is a kept picture, a batched sprite.
 */
const BLOOM_SCENES: readonly BenchScene[] = [
  bloomTilesScene(
    "set-bloom",
    "12 tiles of 128 x 128 under Bloom, its strength written each frame: the chain and stage 3, no quad",
    BLOOM_STRENGTH,
    (stage, tiles) => elapsedMs => {
      for (const [index, tile] of tiles.entries()) {
        stage.set(tile, Bloom, { strength: BLOOM_STRENGTH + BLOOM_WAVE * wave(elapsedMs, index) });
      }
    }
  ),
  bloomTilesScene(
    "set-bloom-held",
    "the 12 Bloom tiles, their strength written once to 0.6, then at rest: kept pictures, one small sprite moving",
    0,
    (stage, tiles) => {
      const mover = stage.spawn(
        Transform({ x: 0, y: 700 }),
        Sprite({ texture: PICTURE, width: 8, height: 8, anchor: { x: 0, y: 0 } })
      );
      let written = false;

      return elapsedMs => {
        if (!written) {
          for (const tile of tiles) stage.set(tile, Bloom, { strength: BLOOM_STRENGTH });

          written = true;
        }

        stage.set(mover, Transform, { x: (elapsedMs / 20) % 300 });
      };
    }
  ),
  bloomTilesScene(
    "set-bloom-one",
    "the 12 Bloom tiles, one of them its strength written each frame, the others still",
    BLOOM_STRENGTH,
    (stage, tiles) => {
      const [moving] = tiles;

      return elapsedMs => {
        if (moving !== undefined) {
          stage.set(moving, Bloom, { strength: BLOOM_STRENGTH + BLOOM_WAVE * wave(elapsedMs, 0) });
        }
      };
    }
  )
];

/** The strongest blur of `sweep-blur-q4`, as the game's pan sweeps it. */
const SWEEP_Q4_BLUR = 16;

/**
 * The arms `sweep` splits into (F126 stage 3 slice 3): Pixi's `Blur` alone over the whole screen, at the config's
 * quality and at the game's own, so the colour matrix's pass no longer hides in the blur's.
 */
const SWEEP_SCENES: readonly BenchScene[] = [
  fullWriteScene(
    "sweep-blur",
    "a full-screen Blur of strength 6 at quality 0, the config's 2: 4 passes at 0.5 on a phone, written each frame",
    Blur,
    elapsedMs => ({ strength: 6 + 0.5 * wave(elapsedMs, 0) })
  ),
  {
    name: "sweep-blur-q4",
    stands:
      "the game's pan: a full-screen Blur at quality 4, its strength 0 to 16 in a 1 s loop: 8 passes",
    mount: stage => {
      const root = stage.spawn(
        Transform({ x: 0, y: 0 }),
        Sprite({
          texture: PICTURE,
          width: stage.width,
          height: stage.height,
          anchor: { x: 0, y: 0 }
        }),
        Blur({ strength: 0, quality: 4 })
      );

      return {
        tick: elapsedMs =>
          stage.set(root, Blur, { strength: loop(elapsedMs, 1000) * SWEEP_Q4_BLUR })
      };
    }
  }
];

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
  promoScene,
  rowScene(
    "rows",
    "order rows flipping, kept: the filter's own body on a mesh in the canvas pass",
    RowFlip
  ),
  rowScene("rows-live", "the same rows with cache: false, drawn live", RowFlipLive),
  restScene,
  rowsEnterScene,
  ...SET_SCENES,
  ...BLOOM_SCENES,
  ...SWEEP_SCENES
];
