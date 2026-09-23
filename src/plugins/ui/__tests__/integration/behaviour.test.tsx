import { describe, expect, it } from "vitest";
import { Pointer, Pressed, Tappable, Touchable } from "../../../input/components";
import { NineSlice, Parent, Shape, Sprite, Transform } from "../../../renderer/components";
import { Text } from "../../../text/components";
import { Exiting, Layer, Order } from "../../../world/ecs/define";
import { Box, Scroll, UiCounters } from "../../components";
import { enterOffset, startUiApp, tick } from "../app";

// ---------------------------------------------------------------------------
// The behaviours that need the whole screen set: scroll, motion, the errors of
// two tags, a duplicate key, a throwing view and a type change at one key.
// ---------------------------------------------------------------------------

/**
 * Mounts one more projection on the running app and gives it two frames.
 *
 * @param app - What `startUiApp` returned.
 * @param name - The projection to mount.
 */
function mount(app: Awaited<ReturnType<typeof startUiApp>>, name: string): void {
  app.world.projection.mount(["hud", name], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
}

describe("scroll", () => {
  it("moves the content with the finger, clamps it and never solves", async () => {
    const app = await startUiApp();

    mount(app, "list");

    const container = app.ui.find("listBox") ?? 0;
    const rows = app.ui.find("content") ?? 0;
    const content = app.world.ecs.get(rows, Parent)?.entity ?? 0;

    expect(content).not.toBe(container);
    expect(app.world.ecs.get(content, Parent)?.entity).toBe(container);
    const pointer = app.world.ecs.resource(Pointer);
    const solvesBefore = app.world.ecs.resource(UiCounters).solves;

    expect(app.world.ecs.has(container, Touchable)).toBe(true);
    expect(app.world.ecs.get(container, Shape)?.clip).toBe(true);
    expect(app.world.ecs.get(container, Scroll)).toEqual({ axis: "y", offset: 0, min: 0 });

    pointer.y = 500;
    app.world.ecs.tag(container, Pressed);
    app.time.step(16);

    pointer.y = 300;
    app.time.step(16);

    expect(app.world.ecs.get(container, Scroll)?.offset).toBe(-200);
    expect(app.world.ecs.get(content, Transform)?.y).toBe(-200);

    pointer.y = -5000;
    app.time.step(16);

    const min = app.world.ecs.get(container, Scroll)?.min ?? 0;

    expect(min).toBe(200 - 8 * 80);
    expect(app.world.ecs.get(container, Scroll)?.offset).toBe(min);

    pointer.y = 5000;
    app.time.step(16);

    expect(app.world.ecs.get(container, Scroll)?.offset).toBe(0);
    expect(app.world.ecs.resource(UiCounters).solves).toBe(solvesBefore);

    app.world.ecs.untag(container, Pressed);
    app.time.step(16);

    expect(app.world.ecs.resource(UiCounters).solves).toBe(solvesBefore);

    await app.stop();
  });
});

describe("element motion", () => {
  it("plays the enter hook off the rest pose and lands on it", async () => {
    const app = await startUiApp();

    mount(app, "moved");

    const mover = app.ui.find("mover") ?? 0;

    const rest = app.world.projection.restOf(mover, Transform)?.y ?? 0;

    // The rest lands the centre pivot (delta 4): the top of the rect plus half its height.
    expect(rest).toBe((app.world.ecs.get(mover, Box)?.y ?? 0) + 50);
    expect(app.world.ecs.get(mover, Transform)?.y).toBeGreaterThanOrEqual(enterOffset);
    expect(app.world.ecs.get(mover, Transform)?.y).toBeLessThan(rest);

    for (let frame = 0; frame < 40; frame += 1) app.time.step(16);

    expect(app.world.ecs.get(mover, Transform)?.y).toBe(
      app.world.projection.restOf(mover, Transform)?.y
    );

    await app.stop();
  });

  it("keeps the element when an enter hook throws", async () => {
    const app = await startUiApp();

    mount(app, "moved");

    expect(app.ui.find("thrower")).toBeDefined();

    await app.stop();
  });

  it("tags an exiting element and despawns it when its motion finished", async () => {
    const app = await startUiApp();

    mount(app, "moved");

    const mover = app.ui.find("mover") ?? 0;

    app.world.projection.unmount(["moved"]);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.has(mover, Exiting)).toBe(true);
    expect(app.ui.find("mover")).toBeUndefined();

    for (let frame = 0; frame < 60; frame += 1) app.time.step(16);

    expect(app.world.ecs.get(mover, Box)).toBeUndefined();

    await app.stop();
  });
});

describe("the two tags that are not in V3", () => {
  it("refuses an input tag and keeps the other roots alive", async () => {
    const app = await startUiApp();

    mount(app, "inputScreen");

    expect(app.ui.find("field")).toBeUndefined();
    expect(app.ui.find("coins")).toBeDefined();

    await app.stop();
  });

  it("refuses a horizontal scroll", async () => {
    const app = await startUiApp();

    mount(app, "sideways");

    expect(app.ui.find("sidewaysBox")).toBeUndefined();
    expect(app.ui.find("coins")).toBeDefined();

    await app.stop();
  });
});

describe("the odd screen", () => {
  it("keeps the first element of a duplicate key", async () => {
    const app = await startUiApp();

    mount(app, "odd");

    const twin = app.ui.find("twin") ?? 0;

    expect(app.world.ecs.get(twin, Box)?.h).toBe(40);
    expect(app.ui.tree().children.some(child => child.key === "oddRoot")).toBe(true);

    await app.stop();
  });

  it("exits the old element and enters a new one when the type at a key changes", async () => {
    const app = await startUiApp();

    mount(app, "odd");

    const before = app.ui.find("swap") ?? 0;

    expect(app.world.ecs.has(before, Touchable)).toBe(true);

    app.input.tap(before);
    app.time.step(16);
    app.time.step(16);

    const after = app.ui.find("swap") ?? 0;

    expect(after).not.toBe(before);
    expect(app.world.ecs.has(after, Touchable)).toBe(false);

    await app.stop();
  });

  it("keeps the old subtree when a component view throws", async () => {
    const app = await startUiApp();

    mount(app, "odd");

    const boom = app.ui.find("boom") ?? 0;

    app.input.tap(boom);
    app.time.step(16);
    app.time.step(16);

    expect(app.ui.find("boom")).toBe(boom);
    expect(app.ui.find("swap")).toBeDefined();

    await app.stop();
  });
});

describe("the counters the acceptance cases read", () => {
  it("counts one solve per change and none while the screen is idle", async () => {
    const app = await startUiApp();
    const counters = app.world.ecs.resource(UiCounters);
    const solves = counters.solves;

    expect(counters.nodes).toBeGreaterThan(0);

    for (let frame = 0; frame < 180; frame += 1) app.time.step(16);

    expect(counters.solves).toBe(solves);

    app.world.projection.unmount(["hud"]);

    for (let frame = 0; frame < 60; frame += 1) app.time.step(16);

    expect(counters.nodes).toBe(0);

    await app.stop();
    await tick();
  });
});

describe("the guide visual", () => {
  it("cuts four dimmed rectangles around the target and drops them on abort", async () => {
    const app = await startUiApp();

    expect(app.flow.gate.answer({ intent: "teach" })).toBe(true);
    await tick();
    app.time.step(16);

    const dims = [...app.world.ecs.query(Shape)].filter(([, shape]) => shape.alpha === 0.6);

    expect(dims).toHaveLength(4);

    expect(app.flow.gate.answer({ intent: "ok" })).toBe(true);
    await tick();
    app.time.step(16);

    expect([...app.world.ecs.query(Shape)].filter(([, shape]) => shape.alpha === 0.6)).toEqual([]);

    await app.stop();
  });

  it("dims the whole screen with no hole when the guide names no target", async () => {
    const app = await startUiApp();

    expect(app.flow.gate.answer({ intent: "teachBlind" })).toBe(true);
    await tick();
    app.time.step(16);

    const dims = [...app.world.ecs.query(Shape)].filter(([, shape]) => shape.alpha === 0.6);

    expect(dims).toHaveLength(1);

    expect(app.flow.gate.answer({ intent: "ok" })).toBe(true);
    await tick();

    await app.stop();
  });
});

describe("the rich screen", () => {
  it("measures an auto-sized text once and gives it a rect", async () => {
    const app = await startUiApp();
    const before = app.world.ecs.resource(UiCounters).measured;

    mount(app, "rich");

    const auto = app.ui.find("auto") ?? 0;

    expect(app.world.ecs.get(auto, Box)?.w).toBeGreaterThan(0);
    expect(app.world.ecs.resource(UiCounters).measured).toBeGreaterThan(before);

    await app.stop();
  });

  it("writes every visual the vocabulary names", async () => {
    const app = await startUiApp();

    mount(app, "rich");

    expect(app.world.ecs.get(app.ui.find("richRoot") ?? 0, Shape)?.radius).toBe(8);
    expect(app.world.ecs.get(app.ui.find("pic") ?? 0, Sprite)?.texture).toBe("ui.coin");
    expect(app.world.ecs.get(app.ui.find("ic") ?? 0, Sprite)?.texture).toBe("ui.gear");
    expect(app.world.ecs.get(app.ui.find("pan") ?? 0, NineSlice)?.texture).toBe("ui.panel");
    expect(app.world.ecs.has(app.ui.find("off") ?? 0, Touchable)).toBe(true);
    expect(app.world.ecs.get(app.ui.find("off") ?? 0, Tappable)).toBeUndefined();

    await app.stop();
  });

  it("reports a small tap target and a text that overflows in a loaded locale, and skips the rest", async () => {
    const app = await startUiApp();

    mount(app, "rich");

    const findings = app.ui.lint();

    expect(findings.some(finding => finding.rule === "tap-target" && finding.key === "small")).toBe(
      true
    );
    expect(
      findings.some(finding => finding.rule === "text-overflow" && finding.key === "tiny")
    ).toBe(true);
    expect(findings.some(finding => finding.key === "pinned")).toBe(false);

    await app.stop();
  });
});

describe("the pressed variant", () => {
  it("re-resolves the style of an element the pointer is on", async () => {
    const app = await startUiApp();

    mount(app, "rich");

    const held = app.ui.find("held") ?? 0;

    expect(app.world.ecs.get(held, Shape)?.fill).toBe(0x01_01_01);

    app.world.ecs.tag(held, Pressed);
    app.time.step(16);

    expect(app.world.ecs.get(held, Shape)?.fill).toBe(0x99_00_00);

    app.world.ecs.untag(held, Pressed);
    app.time.step(16);

    expect(app.world.ecs.get(held, Shape)?.fill).toBe(0x01_01_01);

    await app.stop();
  });
});

describe("the rest pose of the visual", () => {
  it("records the component the element is actually drawn with", async () => {
    const app = await startUiApp();

    mount(app, "rich");

    const projection = app.world.projection;

    expect(projection.restOf(app.ui.find("pic") ?? 0, Sprite)?.texture).toBe("ui.coin");
    expect(projection.restOf(app.ui.find("pan") ?? 0, NineSlice)?.width).toBe(40);
    expect(projection.restOf(app.ui.find("richRoot") ?? 0, Shape)?.radius).toBe(8);
    expect(projection.restOf(app.ui.find("richRoot") ?? 0, Sprite)).toBeUndefined();

    await app.stop();
  });

  it("gives a container a visible shape for a stroke and an invisible one when it names neither", async () => {
    const app = await startUiApp();

    mount(app, "rich");

    expect(app.world.ecs.get(app.ui.find("strokeOnly") ?? 0, Shape)?.stroke).toBe(0x44_44_44);
    // The renderer hangs children under the display object of their parent, so a container
    // with nothing to draw still carries a shape: sized to its rect, never drawn.
    expect(app.world.ecs.get(app.ui.find("pinned") ?? 0, Shape)).toMatchObject({ alpha: 0 });

    await app.stop();
  });

  it("sizes an icon with no style to the line height of the text next to it", async () => {
    const app = await startUiApp();

    mount(app, "rich");

    const box = app.world.ecs.get(app.ui.find("autoIcon") ?? 0, Box);

    expect(box?.w).toBeGreaterThan(0);
    expect(box?.w).toBe(box?.h);

    await app.stop();
  });
});

describe("root order", () => {
  it("lets a popup key shadow the same key of a screen, in find and in tree", async () => {
    const app = await startUiApp();
    const hudCoins = app.ui.find("coins");

    expect(app.flow.gate.answer({ intent: "reward" })).toBe(true);
    await tick();
    app.time.step(16);
    app.time.step(16);

    expect(app.ui.find("coins")).not.toBe(hudCoins);
    expect(app.ui.tree().children[0]?.key).toBe("reward");

    expect(app.input.tap(app.ui.find("claim") ?? 0)).toBe(true);
    await tick();
    app.time.step(16);
    app.time.step(16);

    expect(app.ui.find("coins")).toBe(hudCoins);

    await app.stop();
  });

  it("puts a root element in the layer of its root, and only the root element", async () => {
    const app = await startUiApp();
    const bar = app.world.projection.entityOf("hud", app.ui.tree().key ?? "") ?? 0;
    const coins = app.ui.find("coins") ?? 0;

    expect(app.world.ecs.get(bar, Layer)).toEqual({ name: "ui" });
    expect(app.world.ecs.get(bar, Parent)).toBeUndefined();
    expect(app.world.ecs.get(coins, Layer)).toBeUndefined();
    expect(app.world.ecs.get(coins, Parent)).toEqual({ entity: bar });

    await app.stop();
  });

  it("draws a popup root element above the screen roots", async () => {
    const app = await startUiApp();

    expect(app.flow.gate.answer({ intent: "reward" })).toBe(true);
    await tick();
    app.time.step(16);
    app.time.step(16);

    const reward = app.world.projection.entityOf(
      "RewardPopup",
      app.ui.tree().children[0]?.key ?? ""
    );
    const bar = app.world.projection.entityOf("hud", app.ui.tree().children[1]?.key ?? "");

    expect(app.world.ecs.get(reward ?? 0, Layer)).toEqual({ name: "ui" });
    expect(app.world.ecs.get(reward ?? 0, Order)?.value).toBeGreaterThan(
      app.world.ecs.get(bar ?? 0, Order)?.value ?? 0
    );

    await app.stop();
  });
});

describe("what the frame ignores", () => {
  it("survives a Pressed tag on an entity it does not own and a second unmount", async () => {
    const app = await startUiApp();
    const foreign = app.world.ecs.spawn({ kind: "plugin", name: "test" }, [Transform({ x: 0 })]);

    app.world.ecs.tag(foreign, Pressed);
    app.world.ecs.add(foreign, Box({ x: 0, y: 0, w: 1, h: 1 }));
    app.time.step(16);
    app.world.ecs.untag(foreign, Pressed);
    app.time.step(16);

    expect(app.ui.find("coins")).toBeDefined();

    app.world.projection.unmount(["hud"]);
    app.world.projection.unmount(["hud"]);
    app.time.step(16);
    app.time.step(16);

    expect(app.ui.find("coins")).toBeUndefined();
    expect(app.ui.find("nothing")).toBeUndefined();

    await app.stop();
  });
});

describe("a text with a style key and a button that names nothing", () => {
  it("draws the text in that style and makes the button take the press only", async () => {
    const app = await startUiApp();

    mount(app, "rich");

    const styled = app.ui.find("styled") ?? 0;
    const plain = app.ui.find("plain") ?? 0;

    expect(app.world.ecs.get(styled, Text)?.style).toBe("body");
    expect(app.world.ecs.get(styled, Box)?.w).toBeGreaterThan(0);
    expect(app.world.ecs.has(plain, Touchable)).toBe(true);
    expect(app.world.ecs.get(plain, Tappable)).toBeUndefined();

    await app.stop();
  });
});

describe("a motion written with defineMotion", () => {
  it("runs on the entity once its spawn applied, instead of failing on a missing Transform", async () => {
    const app = await startUiApp();

    mount(app, "moved");

    const animated = app.ui.find("animated") ?? 0;

    expect(app.world.ecs.get(animated, Transform)?.scale).toBeLessThan(1);
    expect(app.world.ecs.get(animated, Transform)?.scale).toBeGreaterThanOrEqual(0.8);

    for (let frame = 0; frame < 40; frame += 1) app.time.step(16);

    expect(app.world.ecs.get(animated, Transform)?.scale).toBe(1);

    await app.stop();
  });
});
