# Filter bench

A small game with the worst filter cases of a real game, one scene at a time, to measure what a
canvas break and a filtered pixel cost on the phone. It is a normal Layer-3 game: `createApp` through
`defineGameApp`, a flow of one rest node, one plugin. It imports the engine from `../../src/`, never
from `@moku-labs/game`: the package name can resolve to a stale `dist/`. It is not published.

The bench is one plugin and this file is its README. Its tests sit in `__tests__/` of this folder,
because they run the whole game.

## Run it on the Mac

```sh
bun tests/fixtures/moku-game.ts dev --root bench/filters --port 4173
```

Open `http://127.0.0.1:4173/#slope-4`. Change the part after `#` and the scene changes, no reload:

| Address | What it does |
|---|---|
| `#slope-4-mask` | That scene. No token opens `ballast`. |
| `#slope-4&k=12` | The scene with 12 ballast sprites under it. K stays until an address names another. |
| `#glow&n=24` | A scene that takes a count (`glow`, 12 by default). |
| `#arms=slope-0,slope-2&every=2&k=8` | Turns through the scenes, 2 s each, for as long as the page is open. |

From the editor: open this folder as a game. The command `bench.scene` (`{ scene, k? }`) switches the
scene, the sources `bench.scenes` and `bench.readout` list the scenes and the numbers.

## What each scene measures

K and every scene with a uniform keep the frame busy: nothing here waits for a change.

| Scene | What it measures | Stands for |
|---|---|---|
| `ballast` | No filter: K full-screen batched sprites. Runs under any other scene. | The fill that holds the GPU clock up, so `slope-N` is read at a known clock. |
| `slope-N` (0, 1, 2, 4, 8) | N live breakers of 4 × 4 px, `cache: false`, a uniform written each frame, over a full-screen sprite. `canvasPasses` = 1 + N. The slope of GPU ms over N is the price of one break. | One canvas break and nothing else. |
| `slope-N-mask` | The same with a clip mask on screen first: every pass after it keeps the stencil. | A scroll list on a board with live filters. |
| `full` | One full-screen live filter. `canvasPasses` = 2. | A whole-screen grade: the price per Mpx. |
| `fade` | Two roots 390 wide, 40 shadowed items each, a countdown text, an emitter, a 420 ms cross-dissolve on loop. | The fade between two screens. |
| `entry` | 40 items with shadow and outline mounting every 1.5 s. | A board entry. |
| `glow` | N placed glows with breath and glint uniforms under a filtered root. | The ward at idle, ObjectGlow. |
| `sweep` | Blur at quality 4 and a ColorMatrix over the full screen, a 1 s ramp on loop. | The connect sweep. |
| `fog` | Round wipes on 12 tiles and a 2048 × 1024 layer, `cache: false`. | FogWipe and FogDevelop, live. |
| `fog-local` | The same with `cache: "local"`. Half of each turn writes nothing, so the pictures rest. | What keeping the fog would win. |
| `flip` | A perspective flip and fold that reads the canvas origin. | A card flip. |
| `scale` | 40 kept pictures, the page's resolution stepping × 1, 0.85, 0.75, 0.85 every 2 s. Works on a debug or dev page only: a release page does not switch resolution. | The adaptive render scale: what a retake of everything costs. |
| `lens` | A soft round window opening over a picture and a subtree. | LensWindow. |
| `promo` | A perspective map of live text, a time-driven procedural quad, a mirrored column with a gradient, a stroke sweep. | The promo screen. |

Every filter body is the bench's own, shaped like the case, in WGSL. Rendering is WebGPU, so that is
what is measured. `defineFilter` also asks for a GLSL body: all of them share one pass-through, so
a WebGL page draws the scenes without their looks. Do not measure on WebGL.

## Reading the numbers

Everything is on `game.bench` in the page console, or through CDP.

- `game.bench.read()`: the arm that runs now. `summary` has the medians, without the first six
  frames of the arm: `canvasPasses`, `gpuMs`, `workMs`, `frames`, and `partialFrames`, the frames the
  GPU timer lost a pass of. `restarts` counts why canvas passes began (`first`, `filter`, `mask`,
  `depth`, `empty`). `stats` is `renderer.stats()` at that moment.
- `game.bench.rows()`: one such row per finished arm, with `frames`, each drawn frame's `t`, `gpuMs`,
  `workMs` and `canvasPasses`. `origin + t` is the phone's epoch time in ms, the time of the clock
  samples, so frames can be binned by clock.
- The perf log of the monitor (`game.renderer.monitor.stream`, the editor's recorder) carries a mark
  at each arm: `arm slope-2 k=8` when it starts, `arm end slope-2 canvas=3 gpu=1.90` when it ends.
- `game.renderer.sync.debug.why()` says why each filtered view is kept or live.

The first seconds of a page hold the engine's warm-up passes: `restarts.filter` is above 0 even in
`slope-0`, and the first round of a run is not a measurement. Drop it.

**Which page gives what.** The frame ring, the perf log, `why()` and `monitor.setResolution` exist on
a dev or debug page only. A release page (`moku-game build`) gives `stats`: `canvasPasses`,
`canvasPassesMax`, `frameMs`, `fps`, `evicted`, `refused`, and no GPU time. A debug build
(`--debug`) needs `@moku-labs/editor` in the game, and this repo does not have it, so the GPU numbers
come from the dev page, the CPU numbers from the release page.

Release page, served on a port:

```sh
bun tests/fixtures/moku-game.ts build --root bench/filters
bun -e 'Bun.serve({ port: 4173, fetch: request => {
  const path = new URL(request.url).pathname;
  return new Response(Bun.file(`bench/filters/dist/web${path === "/" ? "/index.html" : path}`));
} })'
```

## Run it on the A26

The phone is shared. Ask first, and never run this while another session holds it.

1. On the phone: Chrome with `chrome://flags/#enable-webgpu-developer-features` on, or the GPU times
   are rounded to 0.1 ms. Leave the launcher or Chrome in front.
2. On the Mac, the page: the dev command above, `--port 4173`.
3. On the Mac, the script, with the serial as its argument:

   ```sh
   bun bench/filters/a26.ts R5CY32V0J9M --log /path/to/perf-run.jsonl --port 4173 --k 8
   ```

   It first reads `adb forward --list`, `adb reverse --list` and the app in front. With any port held
   on this phone, another app in front, a locked phone or a dark screen, it says why and exits 1,
   having touched nothing. Otherwise it brings the port to the phone with `adb reverse`, prints the
   address to open and the arms schedule, and samples the clocks at 10 Hz into
   `/path/to/perf-run.clocks.jsonl`. It stops when the schedule ends or on Ctrl+C and removes only
   the port it took.
4. Open the printed address on the phone within a few seconds. The page turns the arms itself, every
   2 s. The schedule plans at least 300 usable frames per arm at `--fps` (30 by default).
5. Check the log header: `gpu.timer` must be `timestamp-query`.
6. Before the end of the run, read the rows over CDP. `adb forward tcp:9333
   localabstract:chrome_devtools_remote`, then `Runtime.evaluate` of
   `JSON.stringify(game.bench.rows())`, then `adb forward --remove tcp:9333`.

Each line of the clocks file is `{ t, gpu, mif, nodes }`: `t` is the phone's epoch ms, `gpu` and `mif`
the clocks as the nodes give them, `nodes` every devfreq node by name. `gpu` is the node named `mali`,
`gpu` or `g3d`; `mif` is the one named `mif`, `ddr` or `dmc`. Without a GPU node it falls back to
`/sys/kernel/gpu/gpu_clock`, which gives MHz. These names were written without the phone at hand:
look at the first line of the first run.
