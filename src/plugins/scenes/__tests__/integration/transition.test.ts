import { describe, expect, it } from "vitest";
import { createApp, screen } from "../../../../index";

// ---------------------------------------------------------------------------
// Integration: the real kernel, headless. A transition a game wrote in the config of `scenes` is checked where the app
// is made (spec 36), before any scene is switched.
// ---------------------------------------------------------------------------

describe("config.leave.transition at createApp", () => {
  // Bug: a wrong transition of the config reaches the first switch (or the renderer) instead of the line that wrote it.
  it("throws on a transition out of range, naming the field", () => {
    expect(() =>
      createApp({
        plugins: [...screen],
        pluginConfigs: { scenes: { leave: { transition: { kind: "fade", ms: 5001 } } } }
      })
    ).toThrow("[game] scenes.leave.transition.ms is 5001.");
  });

  // Bug: a field of another kind in the config passes in silence.
  it("throws on a field the kind does not take", () => {
    expect(() =>
      createApp({
        plugins: [...screen],
        pluginConfigs: {
          scenes: { leave: { transition: { kind: "slide", soft: 0.2 } as never } }
        }
      })
    ).toThrow('A "slide" transition takes kind, ms, ease, reduced and to');
  });

  // Bug: a good transition, `false` included, is refused at the door.
  it.each([
    { kind: "wipe", angle: Math.PI, soft: 0.1 },
    { kind: "dissolve" },
    false
  ] as const)("takes %j", transition => {
    expect(() =>
      createApp({ plugins: [...screen], pluginConfigs: { scenes: { leave: { transition } } } })
    ).not.toThrow();
  });
});
