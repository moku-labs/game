import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { Parent, Transform, type TransformValue } from "../../components";
import { rootPoseInto, rootPoseOf } from "../../sync/pose";
import { createMockRenderer } from "../mock-renderer";

const mock = createMockRenderer({ dom: false });
const ecs = mock.world.ecs;
const owner = { kind: "plugin", name: "perf" } as const;
const a = ecs.spawn(owner, [Transform({ x: 100, y: 50, rotation: 0.5, scale: 2 })]);
const b = ecs.spawn(owner, [Transform({ x: 20, y: 0, scale: 0.5 }), Parent({ entity: a })]);
const c = ecs.spawn(owner, [Transform({ x: 0, y: 40 }), Parent({ entity: b })]);
const out: TransformValue = { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } };

describe("the root pose through a chain of three", () => {
  bench("rootPoseOf, a fresh pose", () => void rootPoseOf(ecs, c), BENCH_OPTIONS);
  bench("rootPoseInto, the caller's pose", () => void rootPoseInto(ecs, c, out), BENCH_OPTIONS);
});
