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

## Transition bodies

Three members double as the bodies of a scene transition (`scenes`, a `leave` or `enter` with `transition: { kind: "wipe" | "iris" | "dissolve" }`): `RevealLine` draws `wipe`, `RevealRound` draws `iris`, `Dissolve` draws `dissolve`. List the member in a feature's `filters` to use its kind:

```ts
defineFeature("board", { filters: [RevealLine, RevealRound], scenes: [board, night] }); // wipe and iris
```

Each of the three marks itself (`markTransition`, `set/transition-mark.ts`) as the initialiser of its export, so the mark ships with the member and only with it. Once the member's quad check settled, `effects` builds a warm filter of it, puts its uniform group in the double form that writes in place, and hands it to `renderer.sync.leave.body(kind, quad, member)`; stop takes it back and destroys the filter. The renderer draws the picture of the scene being left on that quad and writes the uniforms by name (`progress`, `angle`, `soft` of a wipe; `radius`, `x`, `y`, `soft` of an iris; `progress`, `scale`, `edge`, `edgeColor` of a dissolve) in every frame of the transition, 0 B a frame (`transition-body.perf.ts`). A kind whose member no feature lists plays as a fade, and a dev build says which member to list. WebGPU only: on WebGL, or where the member's quad check failed, no body is handed and the kind plays as a fade. A game that lists none carries none of this: no member, no mark.

## Members

Every number field is tweenable; a colour is a `0xrrggbb` number, set, not tweened. Every member also carries
`enabled: true` and `order: 0`. The value types `FlashValue`, `GradeValue`, `VignetteValue`, `RevealLineValue`,
`RevealRoundValue`, `DissolveValue`, `ShineValue`, `AuraValue`, `FoldValue`, `BloomValue`, `PixelateValue`,
`GradientMapValue`, `WaveValue`, `MirrorValue`, `ShadowValue` and `FrostValue` are root exports.

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
| `Bloom` | `strength: 0.6` (0..2), `threshold: 0.7` (0..1), `radius: 16` (CSS px) | new: light around what is bright | tile: for an object, not the screen | 3 at any radius and resolution: its 2 steps at ¼ (at ⅛ for a wide radius, and at 2.625) and its body | ≤ 0.074 (0.116 at 2.625) | a moving `strength`: its quad over the held chain result on WebGPU (stage 4 slice 1), stage 3 in every frame on WebGL, 3 passes; a moving `threshold` or `radius` reruns the chain and stage 3, 7 passes, on both | on its quad: 12 still + 0.6, one moving among 12 + 0.7, 12 moving 24.2 (+ 0.8) against `rest` 23.4, 1 pass; `perf/a26-2026-11-08-f126-s4-slice1`. Before it, at rest + 0.4 (12 still), + 2.3 (one moving among 12), 12 moving 89.0 against `rest` 22.5; `perf/a26-2026-11-05-f126-s3-bloom-2` |
| `Frost` | `blur: 12` (0..48 CSS px, 0 for none), `tint: 0xffffff` | the frosted notes and sheets over the ward (F126 stage 5) | window: a backdrop | over a `Source`: 0 canvas breaks, its chain off the canvas once per take of the Source (box + blur, 2 steps at the Source's resolution); without one, today's backdrop path: 3 passes (box, blur, body) and a canvas break per window | over a `Source` at ¼ of 2.625: 0.1–0.25 off the canvas per take (the spike's target, `stats().sources.mpx` measures it) | a moving `tint`: its quad; a moving `blur` reruns the chain from the Source, no take | not measured yet on the real member; the spike's eight windows: Source at rest 17.99 against backdrop 32.11 and baked 17.10, 1 pass against 9 (`perf/a26-f126-s5-source-spike`) |
| `Pixelate` | `size: 8` (CSS px; 1 or less draws the view as it is) | new: a memory that breaks up or sharpens | screen | 1 | ≤ 1.065 | its quad | 24.3 against `rest` 23.8 (perf/a26-2026-11-18-f126-s4-effects) |
| `GradientMap` | `dark: 0x000000`, `middle: 0x808080`, `light: 0xffffff`, `amount: 1` (0..1) | new: sepia, a night tint, a duotone | screen | 1 | ≤ 1.065 | its quad | 24.5 against `rest` 23.8 (perf/a26-2026-11-18-f126-s4-effects) |
| `Wave` | `amplitude: 4` (CSS px), `wavelength: 48` (CSS px), `phase: 0`, `angle: 0` (radians) | new: water, heat, a dream; a `phase` loop | screen | 1 | ≤ 1.065 | its quad | 24.3 against `rest` 23.8 (perf/a26-2026-11-18-f126-s4-effects) |
| `Mirror` | `axis: 1` (1 top to bottom, 0 left to right), `alpha: 1` (0..1), `fade: 0` (share of the view; 0 none) | new: a reflection, on a copy of a view | screen | 1 | ≤ 1.065 | its quad | 24.0 against `rest` 23.8 (perf/a26-2026-11-18-f126-s4-effects) |
| `Shadow` | `x: 0`, `y: 4`, `soft: 4` (CSS px; `\|x\| + soft` and `\|y\| + soft` within 8), `color: 0x000000`, `alpha: 0.5` (0..1) | new: a lifted card, a dragged piece | tile | 1 | ≤ 0.083 | its quad | 25.8 against `rest` 24.2, ring of 8 (perf/a26-2026-11-18-f126-s4-effects, shadow-ring8) |

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
- **`Bloom`** puts light around the bright parts of the view and its subtree: of the premultiplied input it keeps what
  is above `threshold` of its own alpha (`max(c.rgb − threshold × c.a, 0)`, its alpha its brightest channel), blurs
  that `radius` CSS px wide and adds it back by `strength` (at least 0). Its second texture `bright` is drawn by a chain
  of two stages of the set, so it is 3 passes with the body at any radius and resolution. `BloomDown` draws at ¼ of the
  view's input and reads it with 4 taps on the diagonals of its pixel, each on the corner of 4 texels, so the linear
  sampler reads a 2 × 2 block, cuts each tap by the threshold and averages the four cuts. `BloomBlur` blurs that at the
  same scale in one pass, 13 taps: the centre and two rings of 6, at half of sigma and at sigma texels, the outer at
  15° + 60° × k and the inner 30° off it, weighed by the Gaussian at their distance and normalised; sigma is the radius
  in texels there. When the radius is more than 8 texels at ¼ (`radius × resolution / 4 > 8`), both draw at ⅛ instead,
  the first one's taps 2 texels out, the middles of the four quarters of its 8 × 8 footprint. Sigma is capped at 8
  texels: past it the bloom stops widening (at 2, past radius 32). So the default draws at ¼ at resolution 2 and at ⅛ at
  the phone's full 2.625 (radius 16 is 10.5 texels at ¼), 0.12 Mpx a tile. The cut is taken per tap, not per texel,
  and the rings of the blur reach to about the radius: a small bright point blooms into a soft disc, a little
  hexagonal. It has no padding: the light stays inside the view's bounds. It is for an object, not the screen: over the
  A26's screen its passes would fill 1.20 Mpx a frame at 2 and 1.89 at 2.625. A still `Bloom` is kept as a picture
  (its chain drawn once over the picture, stage 2, and the filter once over both, stage 3). A tween of any field marks
  its chain stale and runs it again in JavaScript in every frame; a change of `strength` alone leaves the stages'
  uniforms as they were, so stage 2 is not redrawn: on WebGPU the view draws its body on its own quad in the canvas
  pass from its third write, over the held result of `bright` (stage 4 slice 1), no pass of its own; on WebGL it pays
  stage 3 alone, 3 passes a frame, whatever the length of the chain. A change of `threshold` or `radius` reruns the 2
  steps: the view leaves its quad in that frame and draws stage 2 and stage 3 on its sprite, 7 passes a frame, and
  comes back on the quad by the same count once only `strength` moves again. Before stage 4, on the Mac's dev page
  (WebGPU, resolution 2), `set-bloom`'s 12 moving tiles drew 40 passes a frame, 36 of them theirs; written `threshold`
  instead, 88. The stages are not root exports: a game that wants a chain writes its own.
- **`Pixelate`** draws the view in square blocks `size` CSS px wide, counted from the top-left of its frame: every
  pixel reads the view at the centre of its block, one sample, no average. Its place is `n × inputFrame()` in CSS px,
  so a block is as wide at resolution 1 as at 2, held to 0 .. frame − 0.5: the last texel stands at `n` 1, on a
  block's edge when `size` divides the frame, where the quad and the live pass would round it to two blocks. A `size` of 1 or less reads each pixel's own place, the view as it
  is: a tween down to 1 ends on the view untouched. A `size` of 0 or less is read as 1 for the division, so it draws
  no NaN.
- **`GradientMap`** recolours the view by its light: the straight colour of the premultiplied input (`c.rgb / c.a`; a
  transparent pixel black), its Rec. 709 luma clamped to 0..1, mixes `dark` to `middle` under a half and `middle` to
  `light` from a half. `amount` (clamped to 0..1) mixes the view's own colour to that one, and the alpha is kept: black
  is `dark`, white is `light`, a mid grey `middle`.
- **`Wave`** moves each row (`angle: 0`) or each column (`angle: π / 2`) of the view by `amplitude × sin(2π × s /
  wavelength + phase)` CSS px, `s` the place across the wave in CSS px (the row's y at angle 0, the column's −x at π /
  2); a `wavelength` under 1 is read as 1. The pixel reads the place it came from; one that would come from outside the
  view, more than 1e-4 past its 0..1, is transparent, not the edge smeared in. There is no time in the shader: a loop is
  `view.tween(Wave, { phase: Math.PI * 2 }, { ms: 1200, ease: "linear", repeat: "forever" })`, whole again at every
  turn. It has no padding, so what sways out of the view is cut at its bounds.
- **`Mirror`** flips the view in place, `axis: 1` top to bottom and `axis: 0` left to right (as `Fold`'s axes), times
  `alpha` clamped to 0..1. A `fade` above 0 eases it out from its mirror line, the top edge for axis 1 and the left
  edge for axis 0, by `smoothstep(0, fade, t)`, `t` the distance from the line as a share of the view: gone from `t =
  fade` on. `fade: 0` keeps it whole. It draws inside its own view: a reflection is a copy of a view placed under the
  original, with `Mirror` on the copy.
- **`Shadow`** draws a drop shadow of `color` under the view: the mean alpha of 9 samples of the view, the place
  moved back by `x`, `y` CSS px and a ring of 8 around it at `soft` CSS px, 45° apart, times `alpha`
  clamped to 0..1, under the source: where the view is opaque nothing shows. It is padded by 8 CSS px, its reach:
  `soft` is clamped to 0..8 and `x`, `y` each to `8 − soft` either way, so the shadow is never cut at its frame. With
  9 samples a wide `soft` bands a little; with the view's own sample it reads 10. (Anya's pick 2026-11-18, after the
  A26 read 12 spokes at `rest` + 2.8 ms against the line + 2.0.)

## Pictures or filters (A26)

The bench arms `pv-*` (`bench/filters`, F126 stage 4 piece В) draw seven cases four ways: a **baked** picture (an
asset drawn ahead, 2 px a unit), the member **at rest** (the engine keeps its picture), the member **moving** (its
number written each frame: on its quad), and the **kept** picture moving sideways with the member still. Each at rest
and moving, 1 and 8 items of 140 units. The run of 2026-11-23 (`perf/a26-2026-11-23-f126-s4-pv`, engine 0.15.159,
Chrome, WebGPU, k=8, 221 MHz on every frame, medians of 3 rounds after a warm-up round): GPU ms of the whole frame with
8 items, against the bare item (a `Shape` with a sprite) at 17.37; every arm 1 canvas pass but the backdrop.

| Case (member) | Baked, rest / moving | Member at rest (kept) | Member moving (quad) | Kept, moving | Worst first frame of 8 (CPU / GPU ms) |
|---|---|---|---|---|---|
| Glow (`Aura`) | 17.89 / 17.89 | 17.17 | 18.28 | 17.24 | 45.9 / 39.8 |
| Shadow (`Shadow`) | 17.83 / 17.89 | 17.24 | 17.76 | 17.17 | 21.1 / 27.8 |
| Outline (`Outline`) | 17.69 / 17.83 | 17.04 | 17.96 | 17.04 | 23.5 / 27.9 |
| Grade or tint (`Grade`; baked moving: a sprite tint) | 17.04 / 17.04 | 17.04 | 16.52 | 17.10 | 35.3 / 28.0 |
| Dissolve (`Dissolve`; baked: 8 frames) | 17.04 / 17.04 | 17.04 | 16.91 | 17.04 | 23.8 / 26.4 |
| Tilt (`Fold`; baked: 8 frames) | 17.10 / 17.17 | 17.17 | 16.52 | 17.17 | 19.2 / 23.5 |
| Tilt on a Pixi `PerspectiveMesh` in a `Display` | — | 16.97 | 16.91 | — | 18.2 / 19.1 |
| Blur behind a window (a backdrop with a ¼ chain; baked: a frost patch) | 17.04 / 17.04 | 29.88, 9 passes, CPU 9.6 | 30.05, 9 passes | — (a backdrop is never kept) | 18.1 / 34.7 |

With one item every arm reads 16.3–16.6, but the backdrop window: 18.48, 2 canvas passes. The baked rows' worst first
frame is 5–11 ms CPU and 16–20 ms GPU, an ordinary frame: their 22 textures (8.35 MB) went up with the boot bundle, so
no arm uploaded one (an upload costs about 9 ms on the A26, renderer README `uploads`). Memory: a kept glow picture is
0.47 MB, 8 hold 3.74 MB, and the kept pool stayed at 3.3–3.7 MB through every later arm: a new view reuses what a gone
one held. A baked item is its picture plus its effect layer, 0.30 + 0.39 MB, shared by every copy; a baked flipbook of 8
frames 2.5–3.1 MB. No arm redrew a `Graphics` path at rest. Rules for a game, in Russian for the owner:
[pictures vs filters](https://claude.ai/artifact/XPeyw1bBSMkNhscHPxFmJz).

## How a member draws

Every member's body has the plain signature `@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0)
vec4<f32>`, reads no `@builtin` and nothing of the screen, and has no inputs (`Aura`, `Fold` and `Shadow` have a
padding, `Bloom` one input, drawn from its view): its category is `"local"`, and it carries a `quadSource`. So a still view under it is kept as a picture (a batched sprite, no pass),
and on WebGPU a view whose value moves draws the member's body on its own quad in the canvas pass from its third write
(renderer README, "Kept pictures"): `canvasPasses` stays 1. Two members on one view, or a member beside `Alpha`, draw
through the filter pass, the way two filters of a game do. On WebGL a tween costs one filter pass a frame; the GLSL
twin does the same math, line for line. `Bloom` reads a second texture: its quad program declares `bright` at group 3
after the uniforms (`assembleQuad` with inputs), the slot's quad names it (`inputNames`), and the renderer binds the
held chain result there. A moving `strength` rides the quad; a change its chain reads, `threshold` or `radius`, reruns
the chain and stage 3, on WebGPU and WebGL alike.

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

The head joins a body through a call, so a bundle that drops an unlisted member drops its text and the head too. Its
first three helpers are the place part (`PLACE_WGSL`, `withPlaceWgsl`), on which the built-in `Outline` draws too: a
game that composes `effectsPlugin` carries them once, Outline's, and no `setHash`, which only a member brings.
`Bloom`'s stages (`stages.ts`, `BloomDown` and `BloomBlur`) put one more helper between the head and their bodies,
`inputTexel()`: one texel of the input in the 0..1 of `inputPlace`, `uInputPixel.zw` over the clamp's span. Its two
ladders (at ¼ and at ⅛, two steps each) are made once, by a call at module scope that a bundle without `Bloom` drops
with the stages.

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
| `Bloom` | 3, at 2 and at 2.625 | 1 of its own body; its steps 4 (`BloomDown`) and 13 (`BloomBlur`) | 1.20 Mpx; 1.89 at 2.625: for an object, not the screen | ≤ 0.1 Mpx (0.074); ≤ 0.16 at 2.625 (0.116) | quad for `strength`; chain + stage 3 for `threshold` or `radius` |
| `Frost` | over a `Source`: 0 canvas breaks; its 2 steps once per take, off the canvas. Without: 3 a window (its 2 steps and its body), and a canvas break | 1 of its own body; its steps 4 (`FrostDown`) and 13 (`BloomBlur`) | over a `Source` at ¼: the screen at ¼ once per take; without: the window's box at 2, twice | the window's box | quad for `tint` over a `Source`; chain for `blur` |
| `Pixelate` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `GradientMap` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `Wave` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `Mirror` | 1 | 1 | ≤ 1.065 Mpx | ≤ 0.066 Mpx | quad |
| `Shadow` | 1 | 10 (9 of the shadow, 1 of the view) | ≤ 1.065 Mpx | ≤ 0.083 Mpx (padded by 8: (128 + 16)² × 4) | quad |
| `Outline` (built-in, on the place part of the head) | 1 | 13 | ≤ 1.065 Mpx | ≤ 0.07 Mpx (padded by its default `thickness` 2) | quad |

A padded member draws its frame grown by the padding on every side: a tile under `Aura` (at its default `spread` 8) or
`Fold` is 144 × 144, 0.083 Mpx at 2. On the screen Pixi cuts the frame to the screen, so it stays 1.0644.

A member adds no JavaScript per frame: `filters-sync.perf.ts` measures a `Flash` amount tweened on one of 12 filtered
views, its quad handed over, at 0 B a frame, beside the `Glow` line of the same shape, and a `Wave` phase the same, 0 B
(Node 24.21). A `Pixelate` size tween measures 0 B too; it measured 32 B (16 alone) while V8 kept the stored `size`
as a raw double, which each read of the sync by the uniform's name boxed, until an instance moved the number fields of
its value and its uniform group to V8's tagged form once, as it is built. `Bloom`'s chain answers one of
two arrays made once, written in place: called as a tween calls it, over both ladders, 0 B. Its `strength` tweened on
one of the 12 views, its quad handed over with `bright` named, costs 32 B a frame (`budgets.ts`, `filtersBloomTween`,
Node 24.21; 2 920 B before the engine's `evaluate` walked its steps by index; the same 32 with the quad, whose names
are made once with it): a chain member's uniform write marks its chain stale, the engine checks and
writes the chain's answer again in every frame, and V8 boxes `BloomDown`'s fractional `threshold` at its check and at
its compare-on-write. A chain whose step uniforms hold whole numbers measures 0: `reach` is written as one (made as a
division it was a double, and the tween measured 64 B).

## Checked

- Unit: `__tests__/unit/set/`: the head on the live and the quad clamp, `inputFrame()` in a pooled texture and on the
  quad, the hash's numbers in both languages and its range (`set-head`); one file per member (the signature, the quad,
  `"local"`, the padding, the uniforms of both twins, line for line), and the slice 2 members' formulas evaluated on the
  CPU from their own WGSL (`body-eval.ts`): `RevealLine`'s four corners in 0..1 at 0, π/4, π/2 and 2, all shown at
  progress 1 and none at 0; `RevealRound` closed at radius 0 with any wobble and open at 1.2; `Dissolve` whole at 0 and
  gone at 1 over the hash's whole range; `Shine` dark at -0.5 and 1.5, its light on the colour only; `Aura`'s ring as
  wide as its padding; `Fold`'s content box mapped with its padding and its lean never past the box; the budgets, two
  features listing one member (`set-listing`), the unlisted check and its two dev gates (`set-unlisted`). `Bloom`
  (`bloom`): its chain 2 steps at radius 16, 32 and 128 at resolution 2 (¼ at 16, ⅛ at 32 and 128, sigma 8) and at
  2.625 (⅛, sigma 5.25 at 16, 8 at 32 and 128), the down step's taps 1 texel out at ¼ and 2 at ⅛, the same array
  answered twice in a row, every step a listed stage with uniforms it declares; its stages (`stages`): `BloomDown` black
  at threshold 1 and premultiplied above it, its alpha its brightest channel, 4 taps on the diagonals `reach` texels
  out, their cuts averaged; `BloomBlur`'s 13 taps, the centre and rings of 6 at sigma and half of it, 60° apart and off
  the texel grid at sigma 8 and 5.25, weighed `exp(−d² / (2 sigma²))` and normalised; `inputTexel()` one texel of a
  frame in a pooled texture; the budget rows of `Bloom` at 2 and 2.625, its quad on a change of `strength`, and
  `threshold` and `radius` the only fields its chain's answer moves with. Stage 4's members, one file each, on the same
  cases, and their lines evaluated on the CPU: `Pixelate` reads its block's centre counted from the top-left and the
  pixel's own place at a size of 1 or less (0 and below too, no NaN); `GradientMap` reads the straight colour (black
  where transparent), maps dark to middle under a half and middle to light above it, weighs by the Rec. 709 luma and
  mixes by `amount` clamped; `Wave` sways rows at angle 0 and columns at π/2, moves by `amplitude` a quarter wave out,
  is whole again after a full turn of `phase`, keeps a source a hair past the edge and is transparent past 1e-4, its
  `WAVE_TAU` the same in both twins; `Mirror` flips top to bottom on axis 1 and left to right on axis 0, fades from its
  mirror line to gone at `fade` and keeps the view whole at `fade` 0 or less; `Shadow` keeps `|x| + soft` and `|y| +
  soft` within its reach, the reach its padding in both twins, averages 13 and draws under the source. The built-in
  `Outline` takes the member cases too (`glsl-twins`): its quad, `"local"`, its padding `"thickness"`, its twin line for
  line, 12 spokes `thickness` CSS px out through `inputFrame()`, and the place helpers of the head without its hash.
- Build: `tests/integration/game-build.test.ts`: a game that lists no member carries no `"effects.flash"`, no
  `"effects.bloom"` nor a stage of its chain, none of stage 4's five ids, no `setHash`, and `fn inputPlace(` at most
  once, the built-in `Outline`'s, also against a one-module build of the package as `dist/` ships it; a game listing `Flash` carries it
  and no other member; a release bundle carries no `effects:filter-unlisted`, a dev bundle does.
- Pixels: `bun tests/visual/effects-set.visual.ts`, Chrome on WebGPU and WebGL at resolution 1 and 2. Per member a held
  value kept as a picture against live (the frame oracle, 0.001), a tween on its quad within 1/255 of live, one pixel by
  hand within 2/255 (`Flash` at amount 1 is its colour, `Grade` at saturation 0 of red is 54, `Vignette`'s centre is the
  source; `RevealLine` at π/4 and progress 1 shows its top-left and bottom-right corners; the centre of a `RevealRound`
  at x 0.25 is the source; `Dissolve` at 0 is the source; `Shine`'s line adds 0.6 of light, and a transparent corner
  under it stays black; an `Aura` at strength 2 is its colour next to a straight edge; `Fold` at a half turn is the
  colour at 0.6; `Bloom` at threshold 1 is the source, and the middle of a gold square on a dark card gains 0.6 of its
  light over 0.7, green 204 to 219), and WebGL against WebGPU: alpha within 2/255 and colour within 8/255 on 99.5 % of
  pixels. `Bloom`'s held rows at radius 16 and 32 and its `strength` tween are held within 1/255 of live on both
  backends, the tween on its quad on WebGPU; a `threshold` tween after it is off the quad in a frame that reran the
  chain, on WebGPU after it was on it, within 1/255 of live on both. Both
  comparisons are of premultiplied pixels, what the canvas composites: Pixi's WebGL extract writes its read-back as it
  is, premultiplied, while the WebGPU one writes straight alpha, so a half-transparent pixel (a soft edge, a halo) would
  differ by its alpha. On the Mac (2026-11-04) every row of slice 1 was within 1/255 of live and of WebGPU on every
  pixel; of slice 2 every row was within 1/255 of live, and WebGL held to WebGPU on 99.86 % to 100 % of the pixels,
  the rest at most 11/255 off in colour, never in alpha: low-alpha pixels of soft edges, where the 2D canvas that reads
  a capture back rounds the colour. On the Mac (2026-11-05, the chain of two steps) every `Bloom` row was kept and
  0/255 off live on WebGPU and WebGL at 1 and 2, its tween off the quad; WebGL held to WebGPU on 100 % of the pixels,
  colour and alpha 0/255 off; the gold square's middle read 220 against the 219 by hand (the 8-bit stages round 0.1 of
  light up to 26/255). On the Mac (2026-11-08, stage 4 slice 1) the `strength` tween drew on its quad on WebGPU at 1
  and 2 and the `threshold` row left it in the frame of its chain, every `Bloom` row 0/255 off live and WebGL 0/255
  off WebGPU.
  Stage 4's rows: per member a held value, a tween and a pixel by hand (a pixel of the card in a `Pixelate` block of
  16 reads the square at the block's centre; `GradientMap` of black is `dark`; `Wave` at amplitude 0 is the source at
  the square's edge; `Mirror`'s flip shows the square under where it stands; a white `Shadow` of `soft` 0 below an
  opaque card at y 4 is 128, its colour at 0.5; an `Outline` of 4 is on its ring 3 CSS px off a straight edge, at
  either resolution). On the Mac (2026-11-18) every row was kept and 0/255 off live on WebGPU and WebGL at 1 and 2,
  every tween on its quad on WebGPU, every probe exact; WebGL held to WebGPU on 99.77 % to 100 % of the pixels, at
  most 11/255 off in colour, never in alpha: the soft rows (`Mirror`'s fade, `Shadow`'s edge). The first run found
  `Pixelate`'s tween 255/255 off live on 24 pixels: the last texel stands at `n` 1, on a block's edge when `size`
  divides the frame, and the quad and the live pass rounded it to two blocks; its place is now held half a CSS px in.
- Phone: the bench arms `set-flash`, `set-grade`, `set-vignette` and, of slice 2, `set-reveal-line`,
  `set-reveal-round`, `set-dissolve`, `set-shine`, `set-aura`, `set-fold` (8 rows 340 × 72 under the member, its first
  number written each frame), `set-grade-full` (one full-screen `Grade` written each frame) and `sweep-grade` (the same screen
  under Pixi's `ColorMatrix`). Lines of the delta spec: each `set-*` row arm ≤ `rest` + 1.0 ms with `canvasPasses` 1
  after the third write, `set-grade-full` ≤ `full` + 0.5 ms and ≤ `sweep-grade` − 1.0 ms. A member over its line is
  pulled from the exports and named here as "out, over budget". The run of 2026-11-04 (221 MHz on 96–99 % of frames,
  k=8, whole GPU per frame, medians, `perf/a26-2026-11-04-f126-s3-slice1`): every member is in, every arm draws 1 canvas
  pass, CPU work 3.1–3.6 ms against `rows` 3.6. `set-grade-full` 22.2 ms is under `full` 26.5 and 5.3 ms under
  `sweep-grade` 27.5: Pixi's matrix pays a pass for every value, the member a body on its quad. Slice 2's lines: each
  arm ≤ `rest` + 1.0 ms, `set-aura` ≤ `rest` + 2.0 (13 samples), `set-fold` ≤ `rows` + 0.5; the run of 2026-11-04 (221 MHz on 94–100 % of frames, k=8, whole GPU, medians, `perf/a26-2026-11-04-f126-s3-slice2`): `rest` 22.7, `rows` 22.7; `set-reveal-line` 22.9, `set-reveal-round` 23.0, `set-dissolve` 23.2, `set-shine` 22.8, `set-fold` 22.7, each 1 canvas pass, CPU work 3.7–3.9 ms. `set-aura` 24.9 is `rest` + 2.05 by the median of its 9 rounds (1.6–4.0) against its line + 2.0: within the run-to-run spread of `rest` (0.3 ms), so the owner kept it in the exports on 2026-11-05. Its 13 samples are its price; today's `Glow` costs + 2.5 on the bench. Slice 3's arms: `set-bloom` (12 tiles 128 × 128 under `Bloom`, its `strength` written each frame: the worst case, reported with its pass count, no line), `set-bloom-held` (the same tiles, `strength` written once to 0.6, then at rest: kept pictures) and `set-bloom-one` (the same tiles, one of them moving), and, for the owner's question on `Blur`, `sweep-blur` (a full-screen `Blur` of strength 6 at quality 0: the config's 2, 4 passes at 0.5) and `sweep-blur-q4` (the game's pan, quality 4, strength 0 to 16 in a 1 s loop: 8 passes), numbers, not gates. Lines: `set-bloom-held` ≤ `rest` + 1.0 ms, `set-bloom-one` ≤ `rest` + 3.0 ms, `set-bloom` at most 3 passes a moving view, and the warm-up of the bench with `Bloom` listed at most 25 % over a page without it (two stages more). The run of the chain of four and five steps (2026-11-05, `perf/a26-2026-11-05-f126-s3-bloom`, 221 MHz, whole GPU) read `set-bloom` 96.2 ms against `rest` 22.6, about 40 passes a frame. A strength tween keeps the chain, so its passes do not hang on the chain's length: on the Mac's dev page the chain of two steps draws the same 40, 3 a moving tile. The run of the chain of two steps (2026-11-05, `perf/a26-2026-11-05-f126-s3-bloom-2`, commit 49ad65c, 221 MHz on 87–98 % of samples, k=8, whole GPU, medians): `rest` 22.5; `set-bloom-held` 22.9 (+ 0.4, line + 1.0); `set-bloom-one` 24.8 (+ 2.3, line + 3.0); `set-bloom` 89.0, CPU work 11.2 ms. So a still `Bloom` costs almost nothing, one in motion about 2.3 ms a frame, and twelve in motion at once are too heavy for the phone: a moving `Bloom` pays its filter's passes over the picture every frame, which only a quad that binds a held chain result would take away (stage 4). Stage 4's arms: `set-pixelate`, `set-gradient-map`, `set-wave`, `set-mirror`, `set-shadow`,
  `set-outline` in the scripts of `perf/a26-2026-11-06-f126-s4-spike`, by the method of
  `perf/a26-2026-11-08-f126-s4-slice1`; lines: each ≤ `rest` + 1.0 ms with `canvasPasses` 1, `Shadow` and `Outline`
  ≤ `rest` + 2.0 ms. The run of 2026-11-18 (`perf/a26-2026-11-18-f126-s4-effects`, 221 MHz on 92–100 % of frames, k=8,
  whole GPU, medians, n 440–529): `rest` 23.8; `set-pixelate` 24.3 (+ 0.5), `set-gradient-map` 24.5 (+ 0.7),
  `set-wave` 24.3 (+ 0.5), `set-mirror` 24.0 (+ 0.2), `set-outline` 25.5 (+ 1.7), each 1 canvas pass. `Shadow` read
  + 3.1 padded by 16 with 12 spokes and + 2.8 padded by 8: its samples, not its fill, are its price, so Anya took a ring
  of 8. Its run (`shadow-ring8`, 221 MHz on 94–99 %, n 602–685): `rest` 24.2, `set-shadow` 25.8 (+ 1.6),
  `set-outline` 26.0 (+ 1.8). Every member is in.
