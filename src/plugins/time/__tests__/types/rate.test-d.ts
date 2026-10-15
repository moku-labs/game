import { expectTypeOf } from "vitest";
import { createPlugin, timePlugin } from "../../../../index";
import type { Api, Config, RateChange, TimeCtx } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It guards what a game can get wrong about the adaptive frame
// rate of spec 21: the choices of `setRate`, the shape of `adaptive`, the
// payload of `time:rate`.
// ---------------------------------------------------------------------------

declare const time: Api;

time.setRate("auto");
time.setRate(60);
// @ts-expect-error — 90 is not a rate the engine forces
time.setRate(90);
// @ts-expect-error — "max" is not a choice
time.setRate("max");

expectTypeOf<Config["adaptive"]>().toEqualTypeOf<false | { floor: 30 | 60 }>();

// @ts-expect-error — a floor of 45 is not a floor
const wrongFloor: Config["adaptive"] = { floor: 45 };

declare const timeCtx: TimeCtx;

expectTypeOf(timeCtx.emit).parameter(0).toEqualTypeOf<"time:thermal" | "time:rate">();

// @ts-expect-error — a rate change carries its evidence
timeCtx.emit("time:rate", { from: 120, to: 60 });

createPlugin("rateLabel", {
  depends: [timePlugin],
  hooks: () => ({
    "time:rate": change => {
      expectTypeOf(change).toEqualTypeOf<RateChange>();
    }
  })
});

export { wrongFloor };
