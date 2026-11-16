import * as pixi from "pixi.js";
import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { destroyWhole, releaseBindGroups } from "../../sources";
import { liveCase, rebind } from "./sources-fixtures";

const EMPTY = pixi.Texture.EMPTY.source;
const live = liveCase();

/** Groups already on EMPTY, as a game with about 600 drawn batches leaves them: a dead group's lists to compact. */
const LIVE_GROUPS = 600;

for (let index = 0; index < LIVE_GROUPS; index++) liveCase();

describe("the release of a source from its bind groups", () => {
  bench(
    "one release from a group that still binds a live texture",
    () => {
      releaseBindGroups(live.gone, EMPTY);
      rebind(live);
    },
    BENCH_OPTIONS
  );

  bench(
    "one destroy of a texture whose group dies, 600 live groups on EMPTY",
    () => {
      const texture = new pixi.Texture({ source: new pixi.TextureSource({ width: 4, height: 4 }) });

      pixi.getTextureBatchBindGroup([texture.source], 1, 16);
      destroyWhole(texture);
    },
    BENCH_OPTIONS
  );
});
