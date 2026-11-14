import { expectTypeOf } from "vitest";
import type { TransformValue } from "../../../renderer/components";
import type { NumericFields } from "../../projection/types";

// An optional numeric field counts as numeric (F179): `view.tween(Transform, { scaleX: 1 })` type-checks, the key is
// required in the mapped type and its type is a plain `number`, and a string field stays out.
expectTypeOf<NumericFields<TransformValue>>().toEqualTypeOf<{
  x: number;
  y: number;
  rotation: number;
  scale: number;
  scaleX: number;
  scaleY: number;
}>();
expectTypeOf<NumericFields<{ x: number; label?: string }>>().toEqualTypeOf<{ x: number }>();

// A target may leave the field out, but never names it as `undefined`.
const unfurl: Partial<NumericFields<TransformValue>> = { scaleX: 1 };
// @ts-expect-error -- `undefined` is no number to tween to.
const blank: Partial<NumericFields<TransformValue>> = { scaleX: undefined };

expectTypeOf(unfurl).not.toBeAny();
expectTypeOf(blank).not.toBeAny();
