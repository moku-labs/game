# Stress bench

Two things live here, both for measuring what a frame costs on the Mac and on the A26:

- **The stress game** (`index.ts`, `features/`, `plugins/`): the heaviest screens of a real game («A Memory
  Missing») at its real scale and beyond, each walking by itself. A normal Layer-3 game: `defineGameApp`, a flow of
  one rest node and five commits, one driver plugin. It imports the engine from `../../src/`. Not published.
- **The real-game pass** (`game/`): the real game built with this checkout's engine under its own app id, walked by
  a script through its heaviest moments while every frame is recorded. This is the "check in the game" of a
  performance change.

Nothing here changes the engine. The research that made it is change `2026-11-26-hot-path-research`.

## The stress game

The address picks the scene, read once at load.

| Address | What stands and what the driver does |
|---|---|
| `#album&sets=15` | The album sheet on a set page: the overview kept mounted at alpha 0, a strip of two pages, the dots. 570 entities with 15 sets (the game's size), about 1 060 with 40, about 1 620 with 72. Every walk: a peek (mounts a page), a drag of the strip, a turn, a slide, a rest. |
| `#scroll&sets=72` | The overview alone, its scroll moved every frame. |
| `#popup` | An event popup of about 250 elements over a dim (`Overlay`), opened and closed every walk; a second one over it on every other walk. `&glass=1` makes its panel frosted glass over a `Source`. |
| `#board&items=63` | The board as world projections: a cell, a shadow, a picture and a ring per item, a sparkle emitter per eighth item, the HUD. Every item moves in every frame; a merge every walk. |
| `#worst` | The board, the album and a popup together. |

`&cycle=N` sets the frames of one walk: 30 by default (two flips a second at 60 fps), 15 to 18 for a fast finger.

### The Mac pass

```sh
bun bench/stress/build.ts
bun bench/stress/run.ts --profile --out /path/to/results
bun bench/stress/run.ts --throttle 4 --out /path/to/results-4x
bun bench/stress/summary.ts /path/to/results
```

`build.ts` makes a release build and bundles its script again with the dev flag `false` and the agent flag `true`:
the frame costs are a release build's, and the monitor keeps its frame ring. The script is not minified, so a profile
reads as the source does. `run.ts` opens each scene in headless Chromium on WebGPU. Run nothing else on the Mac
meanwhile: a lint or a test run beside it shows in the numbers. Mac numbers are a bench, never a fact about the phone.

### The A26 pass

The phone is shared: ask for it first.

```sh
bun bench/stress/build.ts
bun bench/stress/a26.ts R5CY32V0J9M --profile --out /path/to/results-a26
bun bench/stress/summary.ts /path/to/results-a26
```

It refuses a phone with a held port, a locked screen or another app in front, having touched nothing
(`--front <app id>` names an app the phone's holder allowed in front). It takes ports 4184 (the page) and 9444
(DevTools), opens each scene in the phone's Chrome, wakes the screen every minute and gives both ports back. Chrome
and the game's WebView share one engine, but the numbers are the browser's. Thirteen scenes with profiles take about
nine minutes and warm the phone: read the thermal status before and after
(`adb shell dumpsys thermalservice`), and do not trust scenes run at status 1.

### What a run writes

Per scene, in the results folder:

- `<scene>.json`: the frames grouped by what the walk did in them (work, GPU, phases, world systems, draws,
  rebuilds), the collections of a trace, the fill estimate, the JS heap in use at the end, `renderer.stats()`.
- `<scene>.rows.json`: every frame. A row is: frame, kind, start ms, work ms, the six phases (input, animate,
  layout, sync, signals, render), GPU ms, draws, rebuilds, passes, filter Mpx, heap MB, five pairs of world system
  index and ms, then the monitor's cause bits (`PERF_CAUSES`), the demand reason (`DEMAND_REASONS`), uploads,
  compiles and the agent's ms.
- `<scene>.stream.jsonl`: the raw log of `renderer.monitor.stream()`: the header (which GPU timer runs), the
  per-second samples, the spikes, the marks (one per commit of the walk), the events.
- With `--profile`: `<scene>.cpuprofile` and `<scene>.heapprofile`.

`summary.ts <dir>` prints, per scene and kind of frame, the frame's own time (the sum of its phases: the wait for the
frame's start left out), the phases, the systems, the GPU time, and the cause bits of the frames over 16.7 ms. A
commit (peek, turn, open, close, merge) is read as the slowest of its marked frame and the two after it.

`profile.ts <file> [top]` reads a profile: self time and the time under the engine's and Pixi's frame steps;
`--under <fn>` who called a function; `--callees <fn>` what it spends its time in; `--owners <bundle.js>` the
profile summed by package (engine, Pixi, Yoga, the game's folders), from the `// <module>` lines Bun writes into an
unminified bundle.

## The real-game pass

### Build the game under its own app id

```sh
bun bench/stress/game/build.ts --game /path/to/memory_missing --work /path/to/scratch
bun bench/stress/game/build.ts --game /path/to/memory_missing --work /path/to/scratch --names
```

It never writes into the game's repo. It copies the game into the scratch folder, pins `@moku-labs/game` to a
tarball of this checkout, renames the app to `<identifier>.hotpath` (the debug app is then
`studio.kitto.memorymissing.hotpath.debug`, beside the game's own apps and with its own save), builds the Android
debug app for arm64 only, keeps `scratch/keep/game-hotpath.apk` and `scratch/keep/web-hotpath/`, and removes the
copy. `--id <name>` gives a lane an app of its own. Needs the Android toolchain the game's own
`native build android` needs, about 5 GB of free disk while it runs, and about eight minutes from cold.

- **Build A** (no flag): the game's normal debug build, minified. Every timing comes from this one.
- **Build B** (`--names`): the same code not minified, `game-hotpath-names.apk`. Only for CPU and allocation
  profiles: with a profiler attached a walk has many more long frames, so its timings are not a measurement.

A debug build carries the monitor and the dev checks; a release build has neither, so its frames are a little
shorter. There is no frame ring in a release build to measure it with.

### Walk it on the A26

The phone is shared: ask for it first, and read the thermal status before and after.

```sh
adb -s R5CY32V0J9M install -r /path/to/scratch/keep/game-hotpath.apk
GAME_DIR=/path/to/memory_missing bun bench/stress/game/walk.ts phone /path/to/results-game
GAME_DIR=/path/to/memory_missing bun bench/stress/game/walk.ts phone /path/to/results-overdraw --only ov-album,ov-events,ov-board
bun bench/stress/game/peaks.ts /path/to/results-game
bun bench/stress/game/overdraw.ts /path/to/results-overdraw
```

`walk.ts` checks forwards, reverses and the keyguard and stops on a taken phone. It starts only its own app, uses
DevTools port 9352, wakes the screen every two minutes, gives its port back and stops its app. It reads the saves
from the game's `tests/scenarios` (read only). The walks, about three and a half minutes of recording:

| Walk | Save | What it does |
|---|---|---|
| `album` | `album-live` | Open the album; 8 flings of the overview; open a set; 10 page swipes 300 ms apart and 8 swipes 100 ms apart (real touches); 6 arrow turns; a card zoom; the store; a box and its reveal; close. |
| `reveal` | `album-live` | Enter the board, take two packs from the reward stack, step and skip their reveals. |
| `board` | `worst-ward` | The fullest field: merges 900 ms and 150 ms apart, generator taps, finger drags and taps, the shop, the storage, the level sheet, three ward ↔ board switches. |
| `pass` | `pass-sheet-claimable` | Open the pass, 12 flings of the track, claim a level, close. |
| `events` | `maint-stress-events` | Vitrine, offer, goals, colleagues, album, daily, shop, settings: open, stand, close; then two rounds as fast as the gates take it. |

For the same walks with named profiles, install `game-hotpath-names.apk` and add `--profile`.

Per walk it writes `<walk>.json` (every frame of the ring with all its columns, the marks, the exact JS heap at each
mark, `dumpsys meminfo` before and after, the GPU clock, the trace's collections), `<walk>.stream.jsonl` (the raw
monitor log) and, with `--profile`, the two profiles.

`peaks.ts <dir>` lists every frame whose phases sum over 16.7 ms, and every frame held more than 16.7 ms before its
first phase, grouped by the last action of the walk before it: phases, slowest systems, GPU ms, texture uploads,
cause bits, demand reason, the collections that overlap it, and the heap a gesture took. `--json` gives all of it.
`overdraw.ts <dir>` turns the heat-map pictures into layers per pixel and megapixels filled per frame.

Three things to know before reading a result:

- The game runs at 120 Hz on the A26 (budget 8.3 ms, ladder 120 → 60): the stream's header says so.
- A debug build plays a test season of the album that starts at its first launch, so the walk sets the save's
  album mark to the device's now; and windows that open by themselves on the ward's tick are closed before a walk.
- One pass per walk. A second pass only when the first is unclear; a walk run on a phone at thermal status 1 is
  suspect.

### A dry run on the Mac

```sh
bun bench/stress/game/desktop.ts /path/to/scratch/keep/web-hotpath
GAME_DIR=/path/to/memory_missing bun bench/stress/game/walk.ts desktop /path/to/results-dry --only album
```

`desktop.ts` serves the debug web build in headless Chromium with DevTools on port 9353 and stays up until killed.
The same walk then runs with mouse drags in place of touches. Use it to check a walk after the game changed its
intents or keys, never for numbers. `HOOKS=1` on a desktop walk counts what made Pixi rebuild its draw list.
