# Stress bench

A small game with the heaviest screens of a real game («A Memory Missing») at its real scale and beyond, each
walking by itself, to measure what a frame costs the engine and Pixi on the Mac and on the A26. It is a normal
Layer-3 game: `defineGameApp`, a flow of one rest node and five commits, one driver plugin. It imports the engine
from `../../src/`. It is not published. Change `2026-11-26-hot-path-research`.

## Scenes

The address picks the scene, read once at load.

| Address | What stands and what the driver does |
|---|---|
| `#album&sets=15` | The album sheet on a set page: the overview kept mounted at alpha 0, a strip of two pages, the dots. 570 elements with 15 sets (the game's size), about 1 000 with 40, about 1 600 with 72. Every walk: a peek (mounts a page), a drag of the strip, a turn, a slide, a rest. |
| `#scroll&sets=72` | The overview alone, its scroll moved every frame. |
| `#popup` | An event popup of about 250 elements over a dim (`Overlay`), opened and closed every walk; a second one over it on every other walk. `&glass=1` makes its panel frosted glass over a `Source`. |
| `#board&items=63` | The board as world projections: a cell, a shadow, a picture and a ring per item, a sparkle emitter per eighth item, the HUD. Every item moves in every frame; a merge every walk. |
| `#worst` | The board, the album and a popup together. |

`&cycle=N` sets the frames of one walk: 30 by default (two flips a second at 60 fps), 15 to 18 for a fast finger.

## Run it

```sh
bun bench/stress/build.ts
bun bench/stress/run.ts --profile --out /path/to/results
bun bench/stress/run.ts --throttle 4 --out /path/to/results-4x
```

`build.ts` makes a release build and bundles its script again with the dev flag `false` and the agent flag `true`:
the frame costs are a release build's, and the monitor keeps its frame ring. `run.ts` opens each scene in headless
Chromium on WebGPU and writes, per scene, `<scene>.json` (the frames grouped by what the walk did in them: work,
GPU, phases, world systems, draws, rebuilds; the heap growth a frame; the collections of a trace; the fill estimate)
and `<scene>.rows.json` (every frame). `--profile` adds a CPU profile and an allocation profile. Run nothing else
on the Mac meanwhile.

## On the A26

The phone is shared: ask first.

```sh
bun bench/stress/a26.ts R5CY32V0J9M --out /path/to/results-a26
```

It refuses a phone with a held port, a locked screen or another app in front, having touched nothing. It takes
ports 4184 (the page) and 9444 (DevTools), opens the page in the phone's Chrome, wakes the screen every two minutes
and gives both ports back. Chrome and the game's WebView share one engine, but the numbers are the browser's.

## Reading a row

`game.stress.drain()` gives rows of numbers: frame, kind, start ms, work ms, the six phases (input, animate, layout,
sync, signals, render), GPU ms, draws, rebuilds, passes, filter Mpx, heap MB, then five pairs of world system index
and ms. A commit (peek, turn, open, close, merge) is read as the slowest of its marked frame and the two after it.
`game.stress.fill()` estimates the pixels a frame fills by the bounding boxes of the visible leaves: an upper
estimate of the overdraw.
