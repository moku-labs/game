import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { Parent, Transform } from "../../components";
import { rootPoseInto, rootPoseOf } from "../../sync/pose";
import type { AxisPose } from "../../sync/types";
import { createMockRenderer } from "../mock-renderer";

const mock = createMockRenderer({ dom: false });
const ecs = mock.world.ecs;
const owner = { kind: "plugin", name: "perf" } as const;
const a = ecs.spawn(owner, [Transform({ x: 100, y: 50, rotation: 0.5, scale: 2 })]);
const b = ecs.spawn(owner, [Transform({ x: 20, y: 0, scale: 0.5 }), Parent({ entity: a })]);
const c = ecs.spawn(owner, [Transform({ x: 0, y: 40 }), Parent({ entity: b })]);
// The same chain stretched per axis on every link (F179).
const sa = ecs.spawn(owner, [
  Transform({ x: 100, y: 50, rotation: 0.5, scale: 2, scaleX: 1.5, scaleY: 0.75 })
]);
const sb = ecs.spawn(owner, [
  Transform({ x: 20, y: 0, scale: 0.5, scaleX: 1.5, scaleY: 0.75 }),
  Parent({ entity: sa })
]);
const sc = ecs.spawn(owner, [
  Transform({ x: 0, y: 40, scaleX: 1.5, scaleY: 0.75 }),
  Parent({ entity: sb })
]);
const out: AxisPose = {
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  pivot: { x: 0, y: 0 }
};

describe("the root pose through a chain of three", () => {
  bench("rootPoseOf, a fresh pose", () => void rootPoseOf(ecs, c), BENCH_OPTIONS);
  bench("rootPoseInto, the caller's pose", () => void rootPoseInto(ecs, c, out), BENCH_OPTIONS);
  bench(
    "rootPoseInto, a chain stretched per axis",
    () => void rootPoseInto(ecs, sc, out),
    BENCH_OPTIONS
  );
});
