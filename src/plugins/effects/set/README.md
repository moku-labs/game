# The effect set

Ready filter members, so a game stops writing shaders of its own for the common looks. Each member is one component
made by `defineFilter`, exported from the root `@moku-labs/game` by name, and listed by a feature in its `filters` as a
game's own filter is. Nothing here registers itself: a member no feature lists is not in the game's bundle and compiles
no shader. Two features may list the same member; it is one kind, at the place of the first.

```ts
import { defineFeature, Flash, Grade } from "@moku-labs/game";

export const board = defineFeature("board", { filters: [Flash, Grade] });

// A merged piece flashes gold, then a motion fades it out.
spawn([Sprite({ texture: "board.piece" }), Transform(), Flash({ amount: 1, color: 0xffd700 })]);
view.tween(Flash, { amount: 0 }, { ms: 160 });
```

A view that carries a member, or any filter, that no feature lists draws unfiltered. A dev build says so once per id:
`effects:filter-unlisted` `{ filter: "effects.flash", entity, hint: 'Filter "effects.flash" is on a view but no feature
lists it in filters' }`.

## Members

Every number field is tweenable; a colour is a `0xrrggbb` number, set, not tweened. Every member also carries
`enabled: true` and `order: 0`. The value types `FlashValue`, `GradeValue` and `VignetteValue` are root exports.

| Member | Fields (default, range) | In A Memory Missing | Frame | Passes | Mpx at 2 | A value change costs | A26 ms (run) |
|---|---|---|---|---|---|---|---|
| `Flash` | `amount: 0` (0..1), `color: 0xffffff` | new: a flash of colour | screen | 1 | ≤ 1.465 | its quad | pending |
| `Grade` | `brightness: 1`, `contrast: 1`, `saturation: 1` (each 0..2, 1 for none), `tint: 0xffffff` | the `ColorMatrix` cases C1–C5 | screen | 1 | ≤ 1.465 | its quad | pending |
| `Vignette` | `x: 0.5`, `y: 0.5` (0..1 of the view), `radius: 0.5`, `soft: 0.25`, `color: 0x000000`, `amount: 1` (0..1) | new | screen | 1 | ≤ 1.465 | its quad | pending |

- **`Flash`** mixes the view towards `color` by `amount`, at the view's own alpha: 0 draws it as it is, 1 draws its
  shape in `color`, the transparent pixels around it stay transparent. `amount` is clamped to 0..1, so a tween that
  overshoots does not burn.
- **`Grade`** works on the colour without its alpha: `contrast` about the middle grey, then `brightness`, then
  `saturation` against the Rec. 709 luma (`saturation: 0` is grey: a red `0xff0000` turns `0x363636`), then a multiply
  by `tint`, clamped to 0..1, and the alpha multiplied back. At its defaults it changes nothing. Where Pixi's
  `ColorMatrix` pays a filter pass for every value of a tween, a `Grade` draws on the view's quad.
- **`Vignette`** keeps the view inside `radius` of the point `x`, `y` and fades it to `color` over `soft` beyond it, by
  `amount`. The point and the lengths are in 0..1 of the view on each axis, so on a view twice as wide as tall the
  disc is an ellipse. A `soft` under 1e-4 is drawn as 1e-4: two equal edges of `smoothstep` are undefined on a GPU.
  The alpha stays.

## How a member draws

Every member's body has the plain signature `@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0)
vec4<f32>`, reads no `@builtin` and nothing of the screen, and has no inputs and no padding: its category is
`"local"`, and it carries a `quadSource`. So a still view under it is kept as a picture (a batched sprite, no pass),
and on WebGPU a view whose value moves draws the member's body on its own quad in the canvas pass from its third write
(renderer README, "Kept pictures"): `canvasPasses` stays 1. Two members on one view, or a member beside `Alpha`, draw
through the filter pass, the way two filters of a game do. On WebGL a tween costs one filter pass a frame; the GLSL
twin does the same math, line for line.

Before every member's body the engine puts the set head (`head.ts`), which a game's own body does not get:

- `inputPlace(uv)`: where the pixel is in its input frame, 0..1 on each axis, from `uInputClamp` alone. Pixi's clamp is
  half a texel in from the frame, and the frame is often a share of a larger pooled texture; on the quad the clamp is
  half a texel in from the whole picture. Both map the first texel's centre to 0 and the last one's to 1, so a body
  places a pixel the same in a filter pass and on the quad.
- `sampleInput(n)`: the input at such a place, clamped inside the frame, with `textureSampleLevel`, so a member may read
  it inside a branch and never reads a neighbour in a pooled texture.

The head joins a body through a call, so a bundle that drops an unlisted member drops its text and the head too.

## Budgets

`__tests__/unit/set/set-budgets.test.ts` pins every member: passes, samples, Mpx and what a value change costs, read
from its definition and its own body. Mpx of a member is `css area × resolution² × (1 + Σ scale²)` of its chain's steps;
the budget frames are the screen, 411 × 891 CSS px (the A26's viewport as assumed until the first slice-1 run logs
`viewport.size()`), and a tile, 128 × 128. At resolution 2 one pass over the screen is 411 × 891 × 4 = 1.4648 Mpx; the
delta spec's 1.46 is that number rounded, and the test holds it at ≤ 1.465. A tile is 0.066 Mpx.

| Member | Passes | Samples | Screen at 2 | Tile at 2 | A value change |
|---|---|---|---|---|---|
| `Flash` | 1 | 1 | ≤ 1.465 Mpx | ≤ 0.066 Mpx | quad |
| `Grade` | 1 | 1 | ≤ 1.465 Mpx | ≤ 0.066 Mpx | quad |
| `Vignette` | 1 | 1 | ≤ 1.465 Mpx | ≤ 0.066 Mpx | quad |

A member adds no JavaScript per frame: `filters-sync.perf.ts` measures a `Flash` amount tweened on one of 12 filtered
views, its quad handed over, at 0 B a frame, beside the `Glow` line of the same shape.

## Checked

- Unit: `__tests__/unit/set/`: the head on the live and the quad clamp (`set-head`), one file per member (the
  signature, the quad, `"local"`, the uniforms of both twins, line for line), the budgets, two features listing one
  member (`set-listing`), the unlisted check and its two dev gates (`set-unlisted`).
- Build: `tests/integration/game-build.test.ts`: a game that lists no member carries no `"effects.flash"` and no
  `inputPlace`, also against a one-module build of the package as `dist/` ships it; a game listing `Flash` carries it
  and no other member; a release bundle carries no `effects:filter-unlisted`, a dev bundle does.
- Pixels: `bun tests/visual/effects-set.visual.ts`, Chrome on WebGPU and WebGL at resolution 1 and 2. Per member a held
  value kept as a picture against live (the frame oracle, 0.001), a tween on its quad within 1/255 of live, one pixel by
  hand within 2/255 (`Flash` at amount 1 is its colour, `Grade` at saturation 0 of red is 54, `Vignette`'s centre is the
  source), and WebGL against WebGPU: alpha within 2/255 and colour within 8/255 on 99.5 % of pixels. On the Mac
  (2026-11-04) every row was within 1/255 of live and WebGL was within 1/255 of WebGPU on every pixel.
- Phone: the bench arms `set-flash`, `set-grade`, `set-vignette` (8 rows 340 × 72 under the member, its first number
  written each frame), `set-grade-full` (one full-screen `Grade` written each frame) and `sweep-grade` (the same screen
  under Pixi's `ColorMatrix`). Lines of the delta spec: each `set-*` row arm ≤ `rest` + 1.0 ms with `canvasPasses` 1
  after the third write, `set-grade-full` ≤ `full` + 0.5 ms and ≤ `sweep-grade` − 1.0 ms. A member over its line is
  pulled from the exports and named here as "out, over budget". The A26 column above is pending that run.
