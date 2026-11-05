# The effect set

Ready filter members, so a game stops writing shaders of its own for the common looks. Each member is one component
made by `defineFilter`, exported from the root `@moku-labs/game` by name, and listed by a feature in its `filters` as a
game's own filter is. Nothing here registers itself: a member no feature lists is not in the game's bundle and compiles
no shader. Two features may list the same member; it is one kind, at the place of the first.

```ts
import { defineFeature, Flash, Grade } from "@moku-labs/game";

export const board = defineFeature("board", { filters: [Flash, Grade] });

// A merged piece carries Flash({ amount: 1, color: 0xffd700 }) beside its Sprite, then a motion fades it out.
view.tween(Flash, { amount: 0 }, { ms: 160 });
```

A view that carries a member, or any filter, that no feature lists draws unfiltered. A dev build says so once per id:
`effects:filter-unlisted` `{ filter: "effects.flash", entity, hint: 'Filter "effects.flash" is on a view but no feature
lists it in filters' }`.

## Members

Every number field is tweenable; a colour is a `0xrrggbb` number, set, not tweened. Every member also carries
`enabled: true` and `order: 0`. The value types `FlashValue`, `GradeValue`, `VignetteValue`, `RevealLineValue`,
`RevealRoundValue`, `DissolveValue`, `ShineValue`, `AuraValue`, `FoldValue` and `BloomValue` are root exports.

| Member | Fields (default, range) | In A Memory Missing | Frame | Passes | Mpx at 2 | A value change costs | A26 ms (run) |
|---|---|---|---|---|---|---|---|
| `Flash` | `amount: 0` (0..1), `color: 0xffffff` | new: a flash of colour | screen | 1 | ≤ 1.065 | its quad | 22.6 against `rest` 22.4 (perf/a26-2026-11-04-f126-s3-slice1) |
| `Grade` | `brightness: 1`, `contrast: 1`, `saturation: 1` (each 0..2, 1 for none), `tint: 0xffffff` | the `ColorMatrix` cases C1–C5 | screen | 1 | ≤ 1.065 | its quad | 22.7 against `rest` 22.4; on the full screen 22.2 against Pixi's `ColorMatrix` 27.5 (perf/a26-2026-11-04-f126-s3-slice1) |
| `Vignette` | `x: 0.5`, `y: 0.5` (0..1 of the view), `radius: 0.5`, `soft: 0.25`, `color: 0x000000`, `amount: 1` (0..1) | new | screen | 1 | ≤ 1.065 | its quad | 22.4 against `rest` 22.4 (perf/a26-2026-11-04-f126-s3-slice1) |
| `RevealLine` | `progress: 0` (0..1; 0 hides all, 1 shows all), `angle: 0` (radians), `soft: 0.05` | new: a wipe | screen | 1 | ≤ 1.065 | its quad | 22.9 against `rest` 22.7 (perf/a26-2026-11-04-f126-s3-slice2) |
| `RevealRound` | `x: 0.5`, `y: 0.5`, `radius: 0` (0..1.5), `soft: 0.05`, `wobble: 0` (0..0.2) | LensWindow F12–F14, FogWipe | screen | 1 | ≤ 1.065 | its quad | 23.0 against `rest` 22.7 (perf/a26-2026-11-04-f126-s3-slice2) |
| `Dissolve` | `progress: 0` (0..1), `scale: 8` (cells across), `edge: 0.08`, `edgeColor: 0xffffff` | new | screen | 1 | ≤ 1.065 | its quad | 23.2 against `rest` 22.7 (perf/a26-2026-11-04-f126-s3-slice2) |
| `Shine` | `position: -0.5` (-0.5..1.5), `width: 0.2`, `angle: 0.6` (radians), `strength: 0.6` | new: a glint | screen | 1 | ≤ 1.065 | its quad | 22.8 against `rest` 22.7 (perf/a26-2026-11-04-f126-s3-slice2) |
| `Aura` | `color: 0xffffff`, `strength: 1` (0..2), `spread: 8` (CSS px, the padding) | a cheap `Glow` | tile | 1 | ≤ 0.083 | its quad | 24.9 against `rest` 22.7; by round `rest` + 2.05 against its line + 2.0 (perf/a26-2026-11-04-f126-s3-slice2) |
| `Fold` | `angle: 0` (radians), `axis: 0` (0 about the vertical axis, 1 about the horizontal), `perspective: 0.5` (0..1), `shade: 0.4` (0..1) | OrderFlip, CoverFold | tile | 1 | ≤ 0.083 | its quad | 22.7 against `rest` 22.7 (perf/a26-2026-11-04-f126-s3-slice2) |
| `Bloom` | `strength: 0.6` (0..2), `threshold: 0.7` (0..1), `radius: 16` (CSS px) | new: light around what is bright | tile: for an object, not the screen | 5 at 2 (4-step ladder ½, ¼, ¼, ¼); 6 at 2.625 (5-step ladder ½, ¼, ⅛, ⅛, ⅛) | ≤ 0.094 (0.153 at 2.625) | its chain and stage 3, in every frame it moves; never its quad | pending |

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
- **`RevealLine`** shows the view up to a straight line that sweeps across it at `angle` (0 from the left, `π / 2` from
  the top), `progress` 0 none of it, 1 all of it, over an edge `soft` wide on each side of the line. The angle is in
  the view's own 0..1 frame, and the sweep runs from the first corner the line meets to the last at any angle: at
  `π / 4` it goes corner to corner and progress 1 shows both far corners. Below 0 and above 1 `progress` is clamped.
- **`RevealRound`** shows the view inside `radius` of `x`, `y` (0..1 of the view, an ellipse on a wide view), fading
  out over the `soft` just inside the radius, its edge waving by `wobble × sin(37 x + 23 y)`, the fog's edge. `radius:
  0` hides every pixel, also where the wobble would pull the distance under 0; from the centre 0.75 reaches the corners
  without wobble, and the example's 1.2 shows all of it with any wobble up to 0.2. It hides by alpha and declares no
  `area`: the view's fill is still paid. A game that needs the fill cut keeps its own filter with an `area`.
- **`Dissolve`** eats the view by a value noise of `scale` cells across (at least 1) from the head's integer hash, the
  four cells around a pixel mixed with smoothstep weights, no time: the same cells go first in every run, on WebGPU and
  WebGL alike. `progress` 0 keeps every pixel untinted and 1 none; a pixel fades out over `edge` of the noise under the
  edge and is tinted `edgeColor` over `edge` above it, the rim of what is left. The grain is continuous, so the edge is
  soft and a pixel a hair off on another GPU moves by a hair.
- **`Shine`** adds a band of light across the view: `position` is where the band stands along its sweep, measured as
  `RevealLine`'s line, -0.5 before the view and 1.5 past it, so a tween from one to the other sweeps it across once and
  a resting `Shine` lights nothing; `width` is how far from its line it reaches, `strength` how much light. The light
  is added to the colour at the view's alpha and clamped to it: a transparent pixel stays transparent.
- **`Aura`** puts a halo of `color` around the shape of the view and its subtree, `spread` CSS px wide: 12 probes on a
  ring of `spread` px (the loop of `Outline`), their mean alpha eased by `smoothstep(0, 0.5, mean)` times `strength`
  and clamped to 1, under the source. Next to a straight edge it is full at strength 1 and fades to nothing at
  `spread`; strength 2 widens the full part. The view is padded by its live `spread`. With 12 probes it bands a little
  where `Glow` (64 to 256) is smooth. A tween of `spread` changes the padding at every step: tween `strength` for a pulse.
- **`Fold`** turns the view by `angle` about its vertical axis (`axis: 0`) or its horizontal one (`axis: 1`): it
  shrinks along the turned axis by `|cos angle|`, is edge-on at a quarter turn and shows its back, unmirrored, at a
  half turn, darkened to `1 − shade × −cos angle`. `perspective` shrinks the side that goes away, to `1 − perspective`
  of its height at a quarter turn, while the near side keeps its size, so the turned view never leaves its box. It is
  padded by 8 px, and maps its content box inside the padded frame.
- **`Bloom`** puts light around the bright parts of the view and its subtree: of every premultiplied pixel it keeps what
  is above `threshold` of its own alpha (`max(c.rgb − threshold × c.a, 0)`, its alpha its brightest channel), blurs
  that `radius` CSS px wide and adds it back by `strength` (at least 0). Its second texture `bright` is drawn by a chain
  of three stages of the set: `BloomCut` at ½, `Downsample` (a 4-tap box over 4 × 4 texels) to ¼, then `GaussAlong` (9
  taps over ±2 sigma) along x and along y at ¼, sigma the radius in texels there. When the radius is more than 8
  texels at ¼ (`radius × resolution / 4 > 8`), one more `Downsample` takes it to ⅛ and the Gaussian runs there. Sigma is
  capped at 8 texels: past it the bloom stops widening (at 2, past radius 32). So the default draws 5 passes at
  resolution 2 and, at the phone's full 2.625 (radius 16 is 10.5 texels at ¼), the 5-step ladder, 6 passes, 0.15 Mpx a
  tile. It has no padding: the light stays inside the view's bounds. It is for an object, not the screen: over the A26's
  screen its passes would fill 1.53 Mpx a frame at 2 and 2.49 at 2.625, over the 2 Mpx line. A chain member never rides
  the quad: a still `Bloom` is kept as a picture (its chain drawn once over the picture, stage 2, and the filter once
  over both, stage 3), and a tween of any field marks its chain stale, so in every frame it moves the chain runs again
  in JavaScript and stage 3 redraws, a pass for each step; a change of `strength` alone leaves the stages' uniforms as
  they were, so stage 2 is not redrawn. The stages are not root exports: a game that wants a chain writes its own.

## How a member draws

Every member's body has the plain signature `@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0)
vec4<f32>`, reads no `@builtin` and nothing of the screen, and has no inputs (`Aura` and `Fold` have a padding, `Bloom`
one input): its category is `"local"`, and, but for `Bloom`, it carries a `quadSource`. So a still view under it is kept as a picture (a batched sprite, no pass),
and on WebGPU a view whose value moves draws the member's body on its own quad in the canvas pass from its third write
(renderer README, "Kept pictures"): `canvasPasses` stays 1. Two members on one view, or a member beside `Alpha`, draw
through the filter pass, the way two filters of a game do. On WebGL a tween costs one filter pass a frame; the GLSL
twin does the same math, line for line. `Bloom` reads a second texture, which no quad binds: a still one is kept as a
picture, a moving one pays its chain and stage 3, on WebGPU and WebGL alike.

Before every member's body the engine puts the set head (`head.ts`), which a game's own body does not get:

- `inputPlace(uv)`: where the pixel is in its input frame, 0..1 on each axis, from `uInputClamp` alone. Pixi's clamp is
  half a texel in from the frame, and the frame is often a share of a larger pooled texture; on the quad the clamp is
  half a texel in from the whole picture. Both map the first texel's centre to 0 and the last one's to 1, so a body
  places a pixel the same in a filter pass and on the quad.
- `sampleInput(n)`: the input at such a place, clamped inside the frame, with `textureSampleLevel`, so a member may read
  it inside a branch and never reads a neighbour in a pooled texture.
- `inputFrame()`: the frame's size in CSS px, `(clamp span + one texel) × uInputSize`. Live `uInputSize` is the size of
  the pooled texture, not of the frame; on the quad the frame is the whole picture; both give the frame. A padded member
  maps its content box with it, `inner = (n × S − P) / (S − 2P)` with `S = inputFrame()` and `P` its padding (Pixi pads
  by its whole pixels), and `Aura` turns its `spread` px into a step of `n` with it.
- `setHash(cell)`: a 32-bit integer hash of a cell, 0 up to 1 in steps of 2⁻²⁴. Integers wrap the same on every GPU; the
  GLSL twin's integers are `highp`, the fragment stage's default `mediump` being 16 bits on a phone.

The head joins a body through a call, so a bundle that drops an unlisted member drops its text and the head too.
`Bloom`'s stages (`stages.ts`) put one more helper between the head and their bodies, `inputTexel()`: one texel of the
input in the 0..1 of `inputPlace`, `uInputPixel.zw` over the clamp's span. Its two ladders are made once, by a call at
module scope that a bundle without `Bloom` drops with the stages.

## Budgets

`__tests__/unit/set/set-budgets.test.ts` pins every member: passes, samples, Mpx and what a value change costs, read
from its definition and its own body. Mpx of a member is `css area × resolution² × (1 + Σ scale²)` of its chain's steps;
the budget frames are the screen, 384 × 693 CSS px (Chrome's viewport on the A26, read on the phone on 2026-11-04), and
a tile, 128 × 128. At resolution 2 one pass over the screen is 384 × 693 × 4 = 1.0644 Mpx, and the test holds it at
≤ 1.065. A tile is 0.066 Mpx.

| Member | Passes | Samples | Screen at 2 | Tile at 2 | A value change |
|---|---|---|---|---|---|
| `Flash` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `Grade` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `Vignette` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `RevealLine` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `RevealRound` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `Dissolve` | 1 | 1 (and 4 hashes) | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `Shine` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `Aura` | 1 | 13 | ≤ 1.065 Mpx | ≤ 0.083 Mpx (padded by 8) | quad |
| `Fold` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.083 Mpx (padded by 8) | quad |
| `Bloom` | 5; 6 at 2.625 | 1 of its own body; its steps 1, 4, 9, 9 (and 4 more at ⅛) | 1.53 Mpx; 2.49 at 2.625: for an object, not the screen | ≤ 0.1 Mpx (0.094); ≤ 0.16 at 2.625 (0.153) | chain + stage 3 |

A padded member draws its frame grown by the padding on every side: a tile under `Aura` (at its default `spread` 8) or
`Fold` is 144 × 144, 0.083 Mpx at 2. On the screen Pixi cuts the frame to the screen, so it stays 1.0644.

A member adds no JavaScript per frame: `filters-sync.perf.ts` measures a `Flash` amount tweened on one of 12 filtered
views, its quad handed over, at 0 B a frame, beside the `Glow` line of the same shape. `Bloom`'s chain answers one of
two arrays made once, written in place: called as a tween calls it, over both ladders, 0 B. Its `strength` tweened on
one of the 12 views costs 2 920 B a frame (`budgets.ts`, `filtersBloomTween`, Node 24.21): a chain member's uniform write
marks its chain stale, and the engine's `evaluate` walks the chain's answer again in every frame (`entries()` pairs,
`Object.keys` of the step uniforms, an object per placed step). Those bytes are the engine's, not the member's.

## Checked

- Unit: `__tests__/unit/set/`: the head on the live and the quad clamp, `inputFrame()` in a pooled texture and on the
  quad, the hash's numbers in both languages and its range (`set-head`); one file per member (the signature, the quad,
  `"local"`, the padding, the uniforms of both twins, line for line), and the slice 2 members' formulas evaluated on the
  CPU from their own WGSL (`body-eval.ts`): `RevealLine`'s four corners in 0..1 at 0, π/4, π/2 and 2, all shown at
  progress 1 and none at 0; `RevealRound` closed at radius 0 with any wobble and open at 1.2; `Dissolve` whole at 0 and
  gone at 1 over the hash's whole range; `Shine` dark at -0.5 and 1.5, its light on the colour only; `Aura`'s ring as
  wide as its padding; `Fold`'s content box mapped with its padding and its lean never past the box; the budgets, two
  features listing one member (`set-listing`), the unlisted check and its two dev gates (`set-unlisted`). `Bloom`
  (`bloom`): its chain at resolution 2, 4 steps at radius 16 (½, ¼, ¼, ¼, sigma 8), 5 at 32 and at 128 (½, ¼, ⅛, ⅛,
  ⅛, sigma still 8), the 5-step ladder at 2.625, the same array answered twice in a row, every step a listed stage with
  uniforms it declares; its stages (`stages`): `BloomCut` black at threshold 1 and premultiplied above it, its alpha its
  brightest channel, `Downsample`'s 4 taps, `GaussAlong`'s 9 taps `k × sigma / 2` texels apart weighed `exp(−k² / 8)`,
  `inputTexel()` one texel of a frame in a pooled texture; the budget rows of `Bloom` at 2 and 2.625.
- Build: `tests/integration/game-build.test.ts`: a game that lists no member carries no `"effects.flash"`, no
  `"effects.bloom"` nor a stage of its chain, and no `inputPlace`, also against a one-module build of the package as `dist/` ships it; a game listing `Flash` carries it
  and no other member; a release bundle carries no `effects:filter-unlisted`, a dev bundle does.
- Pixels: `bun tests/visual/effects-set.visual.ts`, Chrome on WebGPU and WebGL at resolution 1 and 2. Per member a held
  value kept as a picture against live (the frame oracle, 0.001), a tween on its quad within 1/255 of live, one pixel by
  hand within 2/255 (`Flash` at amount 1 is its colour, `Grade` at saturation 0 of red is 54, `Vignette`'s centre is the
  source; `RevealLine` at π/4 and progress 1 shows its top-left and bottom-right corners; the centre of a `RevealRound`
  at x 0.25 is the source; `Dissolve` at 0 is the source; `Shine`'s line adds 0.6 of light, and a transparent corner
  under it stays black; an `Aura` at strength 2 is its colour next to a straight edge; `Fold` at a half turn is the
  colour at 0.6; `Bloom` at threshold 1 is the source, and the middle of a gold square on a dark card gains 0.6 of its
  light over 0.7, green 204 to 219), and WebGL against WebGPU: alpha within 2/255 and colour within 8/255 on 99.5 % of
  pixels. `Bloom` has no quad: its held rows at radius 16 and 32 and its tween, kept again once the value stops, are
  held within 1/255 of live on both backends, and its tween row never takes the quad. Both
  comparisons are of premultiplied pixels, what the canvas composites: Pixi's WebGL extract writes its read-back as it
  is, premultiplied, while the WebGPU one writes straight alpha, so a half-transparent pixel (a soft edge, a halo) would
  differ by its alpha. On the Mac (2026-11-04) every row of slice 1 was within 1/255 of live and of WebGPU on every
  pixel; of slice 2 every row was within 1/255 of live, and WebGL held to WebGPU on 99.86 % to 100 % of the pixels,
  the rest at most 11/255 off in colour, never in alpha: low-alpha pixels of soft edges, where the 2D canvas that reads
  a capture back rounds the colour. On the Mac (2026-11-05) every `Bloom` row was kept and at most 0/255 off live on
  WebGPU and WebGL at 1 and 2, its tween off the quad; WebGL held to WebGPU on 100 % of the pixels, colour at most
  5/255 (radius 32), alpha 0; the gold square's middle read 220 against the 219 by hand (the 8-bit stages round 0.1
  of light up to 26/255).
- Phone: the bench arms `set-flash`, `set-grade`, `set-vignette` and, of slice 2, `set-reveal-line`,
  `set-reveal-round`, `set-dissolve`, `set-shine`, `set-aura`, `set-fold` (8 rows 340 × 72 under the member, its first
  number written each frame), `set-grade-full` (one full-screen `Grade` written each frame) and `sweep-grade` (the same screen
  under Pixi's `ColorMatrix`). Lines of the delta spec: each `set-*` row arm ≤ `rest` + 1.0 ms with `canvasPasses` 1
  after the third write, `set-grade-full` ≤ `full` + 0.5 ms and ≤ `sweep-grade` − 1.0 ms. A member over its line is
  pulled from the exports and named here as "out, over budget". The run of 2026-11-04 (221 MHz on 96–99 % of frames,
  k=8, whole GPU per frame, medians, `perf/a26-2026-11-04-f126-s3-slice1`): every member is in, every arm draws 1 canvas
  pass, CPU work 3.1–3.6 ms against `rows` 3.6. `set-grade-full` 22.2 ms is under `full` 26.5 and 5.3 ms under
  `sweep-grade` 27.5: Pixi's matrix pays a pass for every value, the member a body on its quad. Slice 2's lines: each
  arm ≤ `rest` + 1.0 ms, `set-aura` ≤ `rest` + 2.0 (13 samples), `set-fold` ≤ `rows` + 0.5; the run of 2026-11-04 (221 MHz on 94–100 % of frames, k=8, whole GPU, medians, `perf/a26-2026-11-04-f126-s3-slice2`): `rest` 22.7, `rows` 22.7; `set-reveal-line` 22.9, `set-reveal-round` 23.0, `set-dissolve` 23.2, `set-shine` 22.8, `set-fold` 22.7, each 1 canvas pass, CPU work 3.7–3.9 ms. `set-aura` 24.9 is `rest` + 2.05 by the median of its 9 rounds (1.6–4.0) against its line + 2.0: within the run-to-run spread of `rest` (0.3 ms), so the owner kept it in the exports on 2026-11-05. Its 13 samples are its price; today's `Glow` costs + 2.5 on the bench. Slice 3's arms: `set-bloom` (12 tiles 128 × 128 under `Bloom`, its `strength` written each frame), and, for the owner's question on `Blur`, `sweep-blur` (a full-screen `Blur` of strength 6 at quality 0: the config's 2, 4 passes at 0.5) and `sweep-blur-q4` (the game's pan, quality 4, strength 0 to 16 in a 1 s loop: 8 passes), numbers, not gates. Lines: `set-bloom` ≤ 6 canvas passes a tile and ≤ 0.1 Mpx of filter fill a tile (the monitor's `filterMpx`), GPU ms ≤ `rest` + 3.0, and the warm-up of the bench with `Bloom` listed at most 25 % over a page without it (three stages more). The A26 run of slice 3 is pending.
