import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { Sprite } from "../../components";
import { startSprites, storedSprite } from "./fixtures";

const { mock, entities } = await startSprites(20);
const entity = entities[10] ?? 0;

mock.api.sync.filters.area(entity, [0, 0, 64, 64]);
mock.modules.sync.pass();
mock.world.ecs.set(entity, Sprite, { alpha: 0.5 });

const sprite = storedSprite(mock, entity);

describe("a sprite's alpha tween", () => {
  bench(
    "one frame of the tween, the sprite carrying a filter area",
    () => {
      sprite.alpha = sprite.alpha === 0.5 ? 0.6 : 0.5;
      mock.modules.sync.pass();
    },
    BENCH_OPTIONS
  );
});
