import { describe, expect, it } from "vitest";
import { Box } from "../../components";
import { type ExtrasApp, mountScreen, plaquePadding, startExtrasApp } from "../extras-app";

// ---------------------------------------------------------------------------
// A parent sized by a text holds that text inside its padding. "10" in
// `digits` measures 38.4 with no font loaded. Yoga rounds a measured node out
// and its parent from the unrounded sum, so ui hands Yoga whole units.
// ---------------------------------------------------------------------------

/**
 * The rect of a keyed element, in root coordinates.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns Its `Box`.
 */
function rectOf(app: ExtrasApp, key: string) {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key) ?? 0;

  return app.world.ecs.get(entity, Box) ?? { x: 0, y: 0, w: 0, h: 0 };
}

describe("a plaque padded around a text of fractional width", () => {
  it("is as wide and as tall as its title plus the padding", async () => {
    const app = await startExtrasApp();

    mountScreen(app, "plaqueScreen");

    const plaque = rectOf(app, "plaque");
    const title = rectOf(app, "plaqueTitle");

    expect(title.w).toBe(39);
    expect(plaque.w).toBe(title.w + plaquePadding.left + plaquePadding.right);
    expect(plaque.h).toBe(title.h + plaquePadding.top + plaquePadding.bottom);

    await app.stop();
  });

  it("keeps the title inside the content box of the plaque", async () => {
    const app = await startExtrasApp();

    mountScreen(app, "plaqueScreen");

    const plaque = rectOf(app, "plaque");
    const title = rectOf(app, "plaqueTitle");

    expect(title.x).toBeGreaterThanOrEqual(plaque.x + plaquePadding.left);
    expect(title.y).toBeGreaterThanOrEqual(plaque.y + plaquePadding.top);
    expect(title.x + title.w).toBeLessThanOrEqual(plaque.x + plaque.w - plaquePadding.right);
    expect(title.y + title.h).toBeLessThanOrEqual(plaque.y + plaque.h - plaquePadding.bottom);

    await app.stop();
  });
});
