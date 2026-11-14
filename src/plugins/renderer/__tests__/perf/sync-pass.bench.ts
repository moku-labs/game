import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { Transform } from "../../components";
import { startSprites, storedTransform } from "./fixtures";

const still = await startSprites(300);
const moving = await startSprites(300);
const entity = moving.entities[150] ?? 0;

moving.mock.world.ecs.set(entity, Transform, { x: 1 });

const moved = storedTransform(moving.mock, entity);

const stretched = await startSprites(300);
const stretchedEntity = stretched.entities[150] ?? 0;

// The moved view stretched per axis (F179): the sync writes `scale·scaleX`, `scale·scaleY`.
stretched.mock.world.ecs.set(stretchedEntity, Transform, { x: 1, scaleX: 0.5, scaleY: 2 });

const movedStretched = storedTransform(stretched.mock, stretchedEntity);

describe("the sync pass over 300 views", () => {
  bench("a still pass", () => still.mock.modules.sync.pass(), BENCH_OPTIONS);

  bench(
    "a pass that moves one view",
    () => {
      moved.x = moved.x === 1 ? 2 : 1;
      moving.mock.modules.sync.pass();
    },
    BENCH_OPTIONS
  );

  bench(
    "a pass that moves one view stretched per axis",
    () => {
      movedStretched.x = movedStretched.x === 1 ? 2 : 1;
      stretched.mock.modules.sync.pass();
    },
    BENCH_OPTIONS
  );
});
