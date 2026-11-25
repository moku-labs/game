/**
 * @file The "pictures vs filters" arms (F126 stage 4, piece В): seven cases a game meets, each drawn as a baked
 * picture (an asset drawn ahead, `tools/bake.ts`), as a filter whose value moves, as a filter at rest (the engine keeps
 * its picture) and as that kept picture moving; at rest and in motion, with 1 and with 8 instances. An arm is named
 * `pv-<case>-<way>-<state>-<count>`: `pv-glow-baked-move-8`.
 */
import {
  Aura,
  Display,
  Dissolve,
  Fold,
  Frost,
  Grade,
  Outline,
  Shadow,
  Shape,
  Source,
  Sprite,
  Transform,
  type World
} from "../../../../../src/index.ts";
import { WindowFrost } from "../filters";
import { fullSprite, PICTURE } from "./shared";
import type { BenchScene, Perspective, Stage } from "./types";

/** The side of an item, reference units: its baked picture is drawn at 2 px a unit. */
const ITEM = 140;

/** The padding of an effect layer around the item, as the set's `Aura` and `Shadow` pad. */
const PAD = 8;

/** The width of a baked outline's rim outside the item. */
const RIM = 2;

/** The counts of instances an arm is run with. */
export const PV_COUNTS = [1, 8] as const;

/** The frames of a baked dissolve and of a baked tilt (`tools/bake.ts`). */
const FRAMES = 8;

/** How long one frame of a baked flipbook stands. */
const FLIP_MS = 60;

/** The angle the tilts stand at when they rest. */
const REST_ANGLE = 0.6;

/** The baked frames of a dissolve and of a tilt, their keys made once. */
const DISSOLVE_KEYS = Array.from({ length: FRAMES }, (_unused, frame) => `ui.pv-dissolve-${frame}`);
const TILT_KEYS = Array.from({ length: FRAMES }, (_unused, frame) => `ui.pv-tilt-${frame}`);

/** Where an item stands. */
type Spot = { readonly x: number; readonly y: number };

/** One item alone, in the middle; eight in two columns of four. */
const SPOTS: Readonly<Record<(typeof PV_COUNTS)[number], readonly Spot[]>> = {
  1: [{ x: 125, y: 352 }],
  8: Array.from({ length: 8 }, (_unused, index) => ({
    x: 40 + (index % 2) * 170,
    y: 70 + Math.floor(index / 2) * 175
  }))
};

/** What moves one item in a frame: the time, and the wave of the item, -1 to 1. */
type Move = (elapsedMs: number, wave: number) => void;

/** One way of drawing a case: makes one item and answers what moves it. */
type Way = (stage: Stage, spot: Spot) => Move;

/**
 * A case drawn one way, at rest, in motion, or (`live`) with a child of its Source changed in every frame. A `source`
 * arm draws the full picture under `Source()` (F126 stage 5).
 */
type Arm = {
  readonly way: string;
  readonly state: "rest" | "move" | "live";
  readonly make: Way;
  readonly source?: true;
};

/**
 * The item drawn live: a rounded square of `Graphics` with a sprite in it, the view a filter goes on.
 *
 * @param stage - The stage.
 * @param spot - Where it stands.
 * @param filter - The filter, when it has one.
 * @returns The item.
 */
function liveItem(stage: Stage, spot: Spot, filter?: World.AnyComponentValue): World.Entity {
  const item = stage.spawn(
    Transform({ x: spot.x, y: spot.y }),
    Shape({ w: ITEM, h: ITEM, fill: 0xf2_b4_3d, radius: 20 }),
    ...(filter === undefined ? [] : [filter])
  );

  stage.child(
    item,
    Transform({ x: 40, y: 40 }),
    Sprite({ texture: PICTURE, width: 60, height: 60, anchor: { x: 0, y: 0 } })
  );

  return item;
}

/**
 * A baked picture: one sprite of an asset drawn ahead.
 *
 * @param stage - The stage.
 * @param spot - Where the item stands.
 * @param texture - The asset.
 * @param pad - How far the picture reaches out of the item a side.
 * @returns The sprite.
 */
function baked(stage: Stage, spot: Spot, texture: string, pad: number): World.Entity {
  const side = ITEM + 2 * pad;

  return stage.spawn(
    Transform({ x: spot.x - pad, y: spot.y - pad }),
    Sprite({ texture, width: side, height: side, anchor: { x: 0, y: 0 } })
  );
}

/**
 * Moves a view sideways: what a kept picture costs while it moves and its filter stands.
 *
 * @param stage - The stage.
 * @param view - The view.
 * @param spot - Where it stands.
 * @returns What moves it.
 */
function slide(stage: Stage, view: World.Entity, spot: Spot): Move {
  const patch = { x: spot.x };

  return (_elapsedMs, wave) => {
    patch.x = spot.x + 6 * wave;
    stage.set(view, Transform, patch);
  };
}

/**
 * A live item under a filter whose one number moves each frame.
 *
 * @param stage - The stage.
 * @param spot - Where it stands.
 * @param filter - The filter's component.
 * @param patch - The patch, written in place.
 * @param write - Writes the number into the patch.
 * @returns What moves it.
 */
function filterMoving<Value extends object>(
  stage: Stage,
  spot: Spot,
  filter: World.ComponentType<Value>,
  patch: Partial<Value>,
  write: (patch: Partial<Value>, elapsedMs: number, wave: number) => void
): Move {
  const item = liveItem(stage, spot, filter(patch));

  return (elapsedMs, wave) => {
    write(patch, elapsedMs, wave);
    stage.set(item, filter, patch);
  };
}

/** Nothing moves. */
const still: Move = () => undefined;

/**
 * The arms of one filter case that has a baked twin.
 *
 * @param bakedWay - The baked picture at rest and moving.
 * @param bakedWay.rest - The baked picture at rest.
 * @param bakedWay.move - The baked picture moving.
 * @param filter - Makes the filter's value at rest.
 * @param moving - The live item under its filter, its number moving.
 * @returns The five arms: baked at rest and moving, the filter at rest and moving, the kept picture moving.
 */
function filterCase(
  bakedWay: { rest: Way; move: Way },
  filter: () => World.AnyComponentValue,
  moving: Way
): readonly Arm[] {
  return [
    { way: "baked", state: "rest", make: bakedWay.rest },
    { way: "baked", state: "move", make: bakedWay.move },
    {
      way: "filter",
      state: "rest",
      make: (stage, spot) => {
        liveItem(stage, spot, filter());

        return still;
      }
    },
    { way: "filter", state: "move", make: moving },
    {
      way: "kept",
      state: "move",
      make: (stage, spot) => slide(stage, liveItem(stage, spot, filter()), spot)
    }
  ];
}

/**
 * A baked effect layer under or over the baked item, its alpha moving.
 *
 * @param texture - The effect's asset.
 * @param pad - Its padding.
 * @param over - Whether the layer lies over the item.
 * @returns The baked way, at rest and moving.
 */
function bakedLayer(texture: string, pad: number, over: boolean): { rest: Way; move: Way } {
  const make = (stage: Stage, spot: Spot): World.Entity => {
    if (over) {
      baked(stage, spot, "ui.pv-item", 0);

      return baked(stage, spot, texture, pad);
    }

    const layer = baked(stage, spot, texture, pad);

    baked(stage, spot, "ui.pv-item", 0);

    return layer;
  };

  return {
    rest: (stage, spot) => {
      make(stage, spot);

      return still;
    },
    move: (stage, spot) => {
      const layer = make(stage, spot);
      const patch = { alpha: 1 };

      return (_elapsedMs, wave) => {
        patch.alpha = 0.6 + 0.4 * wave;
        stage.set(layer, Sprite, patch);
      };
    }
  };
}

/**
 * A baked flipbook: one sprite whose texture turns through the frames.
 *
 * @param keys - The frames.
 * @param pad - Their padding.
 * @param restFrame - The frame it rests on.
 * @returns The baked way, at rest and moving.
 */
function flipbook(
  keys: readonly string[],
  pad: number,
  restFrame: number
): { rest: Way; move: Way } {
  return {
    rest: (stage, spot) => {
      baked(stage, spot, keys[restFrame] ?? "", pad);

      return still;
    },
    move: (stage, spot) => {
      const sprite = baked(stage, spot, keys[restFrame] ?? "", pad);
      const patch = { texture: keys[restFrame] ?? "" };

      return elapsedMs => {
        patch.texture = keys[Math.floor(elapsedMs / FLIP_MS) % keys.length] ?? "";
        stage.set(sprite, Sprite, patch);
      };
    }
  };
}

/**
 * Writes the four corners of a card turned about its vertical axis, its near edge taller.
 *
 * @param mesh - The mesh.
 * @param angle - The turn, radians.
 */
function tiltCorners(mesh: Perspective, angle: number): void {
  const half = (ITEM / 2) * Math.cos(angle);
  const lean = (ITEM / 8) * Math.sin(angle);
  const middle = ITEM / 2;

  mesh.corners(
    middle - half,
    lean,
    middle + half,
    -lean,
    middle + half,
    ITEM + lean,
    middle - half,
    ITEM - lean
  );
}

/**
 * The item's picture on a perspective mesh: a `Display` the game owns, its corners turned in place.
 *
 * @param moving - Whether its angle moves each frame.
 * @returns The way.
 */
function meshTilt(moving: boolean): Way {
  return (stage, spot) => {
    const mesh = stage.perspective("ui.pv-item");

    if (mesh === undefined) return still;

    tiltCorners(mesh, REST_ANGLE);
    stage.spawn(Transform({ x: spot.x, y: spot.y }), Display({ object: mesh.object }));

    return moving ? elapsedMs => tiltCorners(mesh, elapsedMs / 500) : still;
  };
}

/** The window of the blur case: a pane of milk over the scene, the frost under it read from the canvas. */
const PANE = { w: ITEM, h: ITEM, fill: 0xff_ff_ff, fillAlpha: 0.25, radius: 20 } as const;

/** Every case and its arms. */
const CASES: Readonly<Record<string, readonly Arm[]>> = {
  plain: [
    {
      way: "item",
      state: "rest",
      make: (stage, spot) => {
        liveItem(stage, spot);

        return still;
      }
    },
    {
      way: "item",
      state: "move",
      make: (stage, spot) => slide(stage, liveItem(stage, spot), spot)
    }
  ],
  glow: filterCase(
    bakedLayer("ui.pv-halo", PAD, false),
    () => Aura({ strength: 1 }),
    (stage, spot) =>
      filterMoving(stage, spot, Aura, { strength: 1 }, (patch, _elapsedMs, wave) => {
        patch.strength = 1 + wave;
      })
  ),
  shadow: filterCase(
    bakedLayer("ui.pv-shadow", PAD, false),
    () => Shadow({ soft: 4 }),
    (stage, spot) =>
      filterMoving(stage, spot, Shadow, { soft: 4 }, (patch, _elapsedMs, wave) => {
        patch.soft = 2 + 2 * wave;
      })
  ),
  outline: filterCase(
    bakedLayer("ui.pv-outline", RIM, true),
    () => Outline({ thickness: 2, color: 0xff_ff_ff }),
    (stage, spot) =>
      filterMoving(
        stage,
        spot,
        Outline,
        { thickness: 2, color: 0xff_ff_ff, alpha: 1 },
        (patch, _elapsedMs, wave) => {
          patch.alpha = 0.5 + 0.5 * wave;
        }
      )
  ),
  grade: filterCase(
    {
      rest: (stage, spot) => {
        baked(stage, spot, "ui.pv-graded", 0);

        return still;
      },
      // The baked picture's answer to a moving colour: the sprite's tint, no shader of its own.
      move: (stage, spot) => {
        const sprite = baked(stage, spot, "ui.pv-graded", 0);
        const patch = { tint: 0xff_ff_ff };

        return (_elapsedMs, wave) => {
          const level = Math.round(200 + 55 * wave);

          patch.tint = (255 << 16) | (level << 8) | level;
          stage.set(sprite, Sprite, patch);
        };
      }
    },
    () => Grade({ saturation: 0.4 }),
    (stage, spot) =>
      filterMoving(
        stage,
        spot,
        Grade,
        { saturation: 0.4, brightness: 1 },
        (patch, _elapsedMs, wave) => {
          patch.brightness = 1 + 0.3 * wave;
        }
      )
  ),
  dissolve: filterCase(
    flipbook(DISSOLVE_KEYS, 0, 3),
    () => Dissolve({ progress: 0.4 }),
    (stage, spot) =>
      filterMoving(stage, spot, Dissolve, { progress: 0.4 }, (patch, _elapsedMs, wave) => {
        patch.progress = 0.5 + 0.5 * wave;
      })
  ),
  tilt: [
    ...filterCase(
      flipbook(TILT_KEYS, PAD, 2),
      () => Fold({ angle: REST_ANGLE }),
      (stage, spot) =>
        filterMoving(stage, spot, Fold, { angle: REST_ANGLE }, (patch, elapsedMs) => {
          patch.angle = elapsedMs / 500;
        })
    ),
    { way: "mesh", state: "rest", make: meshTilt(false) },
    { way: "mesh", state: "move", make: meshTilt(true) }
  ],
  // Today's backdrop path: a window that blurs what is under it, read from the canvas in every frame, never kept; and
  // the same glass as the set's `Frost` over the full picture under `Source()` (F126 stage 5).
  blur: [
    {
      way: "baked",
      state: "rest",
      make: (stage, spot) => {
        baked(stage, spot, "ui.pv-frost", 0);

        return still;
      }
    },
    {
      way: "baked",
      state: "move",
      make: (stage, spot) => slide(stage, baked(stage, spot, "ui.pv-frost", 0), spot)
    },
    {
      way: "filter",
      state: "rest",
      make: (stage, spot) => {
        stage.spawn(Transform({ x: spot.x, y: spot.y }), Shape(PANE), WindowFrost());

        return still;
      }
    },
    {
      way: "filter",
      state: "move",
      make: (stage, spot) =>
        slide(
          stage,
          stage.spawn(Transform({ x: spot.x, y: spot.y }), Shape(PANE), WindowFrost()),
          spot
        )
    },
    { way: "source", state: "rest", source: true, make: frostPane(false) },
    { way: "source", state: "move", source: true, make: frostPane(true) },
    { way: "source", state: "live", source: true, make: frostPane(false) }
  ]
};

/**
 * A pane of milk with the set's `Frost` on it, over the picture under `Source()`.
 *
 * @param moving - Whether it slides in every frame.
 * @returns The way.
 */
function frostPane(moving: boolean): Way {
  return (stage, spot) => {
    const pane = stage.spawn(Transform({ x: spot.x, y: spot.y }), Shape(PANE), Frost({ blur: 12 }));

    return moving ? slide(stage, pane, spot) : still;
  };
}

/**
 * The full picture under `Source()`, with a spark in it: a `live` arm moves the spark in every frame, so the Source is
 * taken again in every frame.
 *
 * @param stage - The stage.
 * @returns What moves the spark.
 */
function sourcePicture(stage: Stage): Move {
  const picture = fullSprite(stage, Source());
  const spark = stage.child(
    picture,
    Transform({ x: 40, y: 40 }),
    Shape({ w: 24, h: 24, fill: 0xff_f0_a0, radius: 12 })
  );
  const patch = { x: 40 };

  return (_elapsedMs, wave) => {
    patch.x = 40 + 30 * wave;
    stage.set(spark, Transform, patch);
  };
}

/**
 * The full picture with no Source under the arm: nothing of it moves.
 *
 * @param stage - The stage.
 * @returns What moves nothing.
 */
function plainPicture(stage: Stage): Move {
  fullSprite(stage);

  return still;
}

/** How an arm's state reads in its line. */
const STANDS: Readonly<Record<Arm["state"], string>> = {
  rest: "at rest",
  move: "in motion",
  live: "its Source changed every frame"
};

/**
 * One arm as a scene: the full-screen picture under it, the items on it, each moved in every frame when it moves.
 *
 * @param name - The case.
 * @param arm - The way and the state.
 * @param count - The instances.
 * @returns The scene.
 */
function pvScene(name: string, arm: Arm, count: (typeof PV_COUNTS)[number]): BenchScene {
  return {
    name: `pv-${name}-${arm.way}-${arm.state}-${count}`,
    stands: `${name} as ${arm.way}, ${STANDS[arm.state]}, ${count} on screen`,
    mount: stage => {
      const spark = arm.source === true ? sourcePicture(stage) : plainPicture(stage);
      const moves = SPOTS[count].map(spot => arm.make(stage, spot));

      if (arm.state === "rest") return undefined;
      if (arm.state === "live")
        return { tick: elapsedMs => spark(elapsedMs, Math.sin(elapsedMs / 500)) };

      return {
        tick: elapsedMs => {
          for (const [index, move] of moves.entries()) {
            move(elapsedMs, Math.sin(elapsedMs / 500 + index * 0.4));
          }
        }
      };
    }
  };
}

/** Every `pv-*` arm, in the order of the phone's schedule: by case, then way, then state, then count. */
export const PV_SCENES: readonly BenchScene[] = Object.entries(CASES).flatMap(([name, arms]) =>
  arms.flatMap(arm => PV_COUNTS.map(count => pvScene(name, arm, count)))
);
