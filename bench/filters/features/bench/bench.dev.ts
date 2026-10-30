/**
 * @file The bench in the editor: a command that switches the scene, and the numbers of the arm that
 * runs. Only the dev page of the editor and a debug page import a `.dev` module.
 */
import { controlRefused, defineCommand } from "../../../../src/control.ts";
import { defineSource } from "../../../../src/inspect.ts";
import type { BenchApi } from "../../plugins/bench/types";

/** What these doors read of the app. */
type BenchApp = { bench: BenchApi };

/** Switches the scene, K with it when given. */
export const benchScene = defineCommand({
  id: "bench.scene",
  title: "Bench scene",
  input: { scene: "string", k: "number?" },
  effect: "cosmetic",
  run: (app: BenchApp, input) => {
    if (
      (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) &&
      (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)
    ) {
      throw controlRefused();
    }

    app.bench.show(input.scene, input.k === undefined ? {} : { k: input.k });

    return app.bench.current();
  }
});

/** Every scene with the line of what it stands for. */
export const benchScenes = defineSource({
  id: "bench.scenes",
  title: "Bench scenes",
  input: {},
  changes: "edge",
  read: (app: BenchApp) =>
    app.bench.names().map(name => ({ name, stands: app.bench.stands(name) ?? "" }))
});

/** The numbers of the arm that runs, when asked: a read walks the ring, so it never runs per frame. */
export const benchReadout = defineSource({
  id: "bench.readout",
  title: "Bench readout",
  input: {},
  changes: "edge",
  read: (app: BenchApp) => app.bench.read().summary
});

export const commands = [benchScene];

export const sources = [benchScenes, benchReadout];
