import { expectTypeOf } from "vitest";
import type { MONITOR_SECTIONS, MonitorSections } from "../../../../index";
import type { Api, PerfHeaderLine, PerfSampleLine } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only (spec 11 R14): what the editor can get wrong about the sections of the monitor. `tsc --noEmit` is
// the runner.
// ---------------------------------------------------------------------------

declare const app: { renderer: Api };

// A switch names sections the monitor has, with booleans.
app.renderer.monitor.sections({ systems: false });
// @ts-expect-error — `draws` is a count of the `counts` section, not a section
app.renderer.monitor.sections({ draws: false });
// @ts-expect-error — a section is switched with a boolean
app.renderer.monitor.sections({ heap: "off" });

expectTypeOf(app.renderer.monitor.sections()).toEqualTypeOf<Readonly<MonitorSections>>();

// The root list names exactly the keys of the switches, so the editor can draw one switch per name.
expectTypeOf<(typeof MONITOR_SECTIONS)[number]>().toEqualTypeOf<keyof MonitorSections>();

// The header lists the sections on and off; the sample's cost has every section and `base`.
expectTypeOf<NonNullable<PerfHeaderLine["sections"]>["off"]>().toEqualTypeOf<
  readonly (keyof MonitorSections)[]
>();
expectTypeOf<keyof NonNullable<PerfSampleLine["sectionsMs"]>>().toEqualTypeOf<
  keyof MonitorSections | "base"
>();
