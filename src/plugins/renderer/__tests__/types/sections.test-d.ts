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
// @ts-expect-error — `draws` is a count of the `passes` section, not a section
app.renderer.monitor.sections({ draws: false });
// @ts-expect-error — the heap read is the `memory` section
app.renderer.monitor.sections({ heap: false });
// @ts-expect-error — a section is switched with a boolean
app.renderer.monitor.sections({ memory: "off" });

expectTypeOf(app.renderer.monitor.sections()).toEqualTypeOf<Readonly<MonitorSections>>();

// The root list names exactly the keys of the switches, so the editor can draw one switch per name.
expectTypeOf<(typeof MONITOR_SECTIONS)[number]>().toEqualTypeOf<keyof MonitorSections>();

// The header carries the sections as `sections()` answers them; the sample's cost has every section and `base`.
expectTypeOf<NonNullable<PerfHeaderLine["sections"]>>().toEqualTypeOf<Readonly<MonitorSections>>();
expectTypeOf<keyof NonNullable<PerfSampleLine["sectionsMs"]>>().toEqualTypeOf<
  keyof MonitorSections | "base"
>();
