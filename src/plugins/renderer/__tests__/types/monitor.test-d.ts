import { expectTypeOf } from "vitest";
import { createPlugin } from "../../../../config";
import { frameAt, type PERF_GAP_BUCKETS, type PERF_LOG_VERSION } from "../../../../index";
import { timePlugin } from "../../../time";
import type { ThermalReading } from "../../../time/types";
import type {
  Api,
  Config,
  FrameRecord,
  MonitorConfig,
  PerfEventName,
  PerfLogLine
} from "../../types";

// ---------------------------------------------------------------------------
// Type-level only (spec 11 "Type-level"): what a game or the editor can get
// wrong about the performance monitor. `tsc --noEmit` is the runner.
// ---------------------------------------------------------------------------

declare const app: { renderer: Api };

// ─── event names ──────────────────────────────────────────────

// @ts-expect-error — "scenes" is not an event name: the log says "scene"
app.renderer.monitor.event("scenes", {});

app.renderer.monitor.event("rate", {});
app.renderer.monitor.event("devtools", { mode: "card", tab: "frames" });
app.renderer.monitor.event("command", { id: "game.filter", input: { kind: "glow" } });

expectTypeOf<"devtools" | "command" | "recorder" | "rate">().toMatchTypeOf<PerfEventName>();

// @ts-expect-error — `thermal` is a line kind of its own, not an event name
app.renderer.monitor.event("thermal", {});

// ─── a line narrows by its kind ───────────────────────────────

declare const line: PerfLogLine;

if (line.kind === "sample") expectTypeOf(line.workMs.p90).toEqualTypeOf<number>();
if (line.kind === "spike") expectTypeOf(line.frame).toEqualTypeOf<FrameRecord>();

expectTypeOf<typeof PERF_LOG_VERSION>().toEqualTypeOf<1>();
expectTypeOf<typeof PERF_GAP_BUCKETS>().toEqualTypeOf<81>();
expectTypeOf(frameAt(app.renderer.monitor.frames(), 0)).toEqualTypeOf<FrameRecord | undefined>();

// ─── the config: maxResolution is a number, budgetMs a number or "rate" ──

expectTypeOf<Config["maxResolution"]>().toEqualTypeOf<number>();
expectTypeOf<MonitorConfig["budgetMs"]>().toEqualTypeOf<number | "rate">();

const rate: MonitorConfig = { budgetMs: "rate", frames: 1024 };
const fixed: MonitorConfig = { budgetMs: 16.7, frames: 2048 };

// @ts-expect-error — the budget is milliseconds or "rate", never another word
const fast: MonitorConfig = { budgetMs: "fast", frames: 1024 };

// @ts-expect-error — a player's quality is applied by monitor.setResolution, not by a function
const quality: Config["maxResolution"] = () => 1.5;

expectTypeOf([rate, fixed, fast]).toBeArray();
expectTypeOf(quality).toBeNumber();

// ─── setResolution answers the resolution of the next frame ───

expectTypeOf(app.renderer.monitor.setResolution).toEqualTypeOf<
  (resolution: number | undefined) => number
>();

// ─── the time:thermal hook carries the shell's reading ────────

createPlugin("heatProbe", {
  depends: [timePlugin],
  hooks: () => ({
    "time:thermal": reading => {
      expectTypeOf(reading).toEqualTypeOf<ThermalReading>();
    }
  })
});
