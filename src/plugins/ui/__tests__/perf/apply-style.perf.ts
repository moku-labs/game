import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { FULL_STYLE, NARROW_STYLE, startStyleFixture, WIDER_STYLE } from "./apply-style.fixture";
import { NOISE_BYTES } from "./budgets";

// ---------------------------------------------------------------------------
// Change 2026-11-24-f230-hot-path, U1. A write of `FULL_STYLE` onto a column inside a stack, measured on the code
// before the change (Node 24.21, warm `alloc`):
//   unchanged write   14 571 B and 27 Yoga setters per write (each setter of Yoga's wrapper copies its arguments;
//                     three enum tables and an edge array per write)
//   bench, mean       9.1 µs unchanged, 11.8 µs with one field changed
// Now a setter is called only for a value that differs from the node's kept record: 0 B and no setter unchanged;
// bench mean 0.19 µs unchanged, 0.46 µs with one field changed. A read of a fractional style field at a site that
// has seen many style shapes boxes it (16 B), as it does for any reader of the style; a site that saw one shape
// does not.
// ---------------------------------------------------------------------------

describe("Yoga style write: heap and setters per write", () => {
  it("an unchanged write allocates nothing and calls no setter", async ({ annotate }) => {
    const fixture = await startStyleFixture();

    fixture.write(FULL_STYLE);

    const bytes = alloc(() => fixture.write(FULL_STYLE));
    const before = fixture.setters();

    fixture.writeCounted(FULL_STYLE);

    const setters = fixture.setters() - before;

    await annotate(`unchanged write: ${bytes} B, ${setters} setters`);
    expect(bytes).toBeLessThanOrEqual(NOISE_BYTES);
    expect(setters).toBe(0);
  });

  it("a write with one changed field calls exactly one setter", async () => {
    const fixture = await startStyleFixture();

    fixture.writeCounted(NARROW_STYLE);

    const first = fixture.setters();

    fixture.writeCounted(WIDER_STYLE);

    const second = fixture.setters();

    fixture.writeCounted(NARROW_STYLE);

    expect(second - first).toBe(1);
    expect(fixture.setters() - second).toBe(1);
  });
});
