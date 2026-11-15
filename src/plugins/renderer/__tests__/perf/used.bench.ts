import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startSprites } from "./fixtures";

const { mock } = await startSprites(20);
const { used } = mock.api.sync.textures;
const misses: readonly string[] = Array.from({ length: 40 }, (_, index) => `other.key-${index}`);
const hits: readonly string[] = [...misses.slice(1), "board.cell"];

describe("textures.used over 40 keys", () => {
  bench("a hit: the drawn key last", () => void used(hits), BENCH_OPTIONS);
  bench("a miss: no key drawn", () => void used(misses), BENCH_OPTIONS);
});
