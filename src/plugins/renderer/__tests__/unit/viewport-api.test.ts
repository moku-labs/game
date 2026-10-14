import { afterEach, describe, expect, it, vi } from "vitest";
import type { FakeDom } from "../fake-dom";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function started(
  options: Parameters<typeof createMockRenderer>[0] & {
    insets?: Partial<Record<"top" | "right" | "bottom" | "left", number>>;
  }
): Promise<MockRenderer> {
  const mock = createMockRenderer(options);

  Object.assign(mock.dom?.insets ?? {}, options.insets);
  await mock.start();

  return mock;
}

/**
 * The fake DOM of a started mock, and the observer that watches both safe-area probes.
 *
 * @param mock - A started mock renderer.
 * @returns The fake DOM and the probes' observer; the test fails when either is missing.
 */
function probeWatch(mock: MockRenderer): {
  dom: FakeDom;
  observer: FakeDom["observers"][number];
} {
  const { dom } = mock;
  const probes = mock.ctx.state.viewport.probes;

  if (dom === undefined || probes === undefined) throw new Error("the mock made no probes");

  const observer = dom.observers.find(
    each =>
      each.targets.includes(probes.start as never) && each.targets.includes(probes.end as never)
  );

  if (observer === undefined) throw new Error("nothing observes both probes");

  return { dom, observer };
}

describe("viewport size: both sides fit", () => {
  it("grows the reference width of a 768x1024 tablet, so the column keeps its height", async () => {
    const mock = await started({ width: 768, height: 1024 });
    const size = mock.api.viewport.size();

    expect(size.scale).toBeCloseTo(0.5333, 4);
    expect(size.width).toBeCloseTo(1440, 6);
    expect(size.height).toBeCloseTo(1920, 6);
    expect(mock.ctx.state.sync.root?.scale.x).toBeCloseTo(0.5333, 4);
  });

  it("fits the long side inside the safe area, and reports the safe area in the new units", async () => {
    const mock = await started({
      width: 375,
      height: 667,
      referenceLong: 2080,
      insets: { top: 20 }
    });
    const size = mock.api.viewport.size();

    expect(size.scale).toBeCloseTo(0.3111, 4);
    expect(size.width).toBeCloseTo(1205.6, 1);
    expect(size.safeArea.top).toBeCloseTo(64.3, 1);
    // What the layout gets between the insets is exactly the long side it asked for.
    expect(size.height - size.safeArea.top - size.safeArea.bottom).toBeCloseTo(2080, 6);
  });

  it("counts an inset only where it reaches into the frame", async () => {
    // A portrait game in a tall window: the frame starts 240 px down, below the 47 px notch.
    const mock = await started({ width: 1080, height: 3000, insets: { top: 47 } });
    const size = mock.api.viewport.size();

    expect(size.scale).toBe(1);
    expect(size.safeArea.top).toBe(0);
  });

  it("keeps the width of a phone that is narrow for its height", async () => {
    const mock = await started({ width: 390, height: 844 });
    const size = mock.api.viewport.size();

    expect(size.width).toBeCloseTo(1080, 6);
    expect(size.scale).toBeCloseTo(390 / 1080, 6);
  });
});

describe("viewport toScreen: reference units to client CSS pixels", () => {
  it("scales a point of a 390x844 phone into the page", async () => {
    const mock = await started({ width: 390, height: 844 });
    const point = mock.api.viewport.toScreen({ x: 540, y: 960 });

    expect(point.x).toBeCloseTo(195, 6);
    expect(point.y).toBeCloseTo(346.6667, 4);
  });

  it("adds the frame offset of the bars and the place of the canvas on the page", async () => {
    // A portrait game in a 1920x1080 window: an 810x1080 frame, 555 px of bar on the left.
    const mock = await started({ width: 1920, height: 1080 });

    mock.pixi.last().canvas.rect = { left: 10, top: 20, width: 1920, height: 1080 };

    expect(mock.api.viewport.toScreen({ x: 0, y: 0 })).toEqual({ x: 565, y: 20 });
    expect(mock.api.viewport.toScreen({ x: 720, y: 960 })).toEqual({ x: 970, y: 560 });
  });

  it("is the inverse of toReference", async () => {
    const mock = await started({ width: 1920, height: 1080 });

    mock.pixi.last().canvas.rect = { left: 10, top: 20, width: 1920, height: 1080 };

    const screen = mock.api.viewport.toScreen({ x: 312, y: 1480 });
    const back = mock.api.viewport.toReference(screen.x, screen.y);

    expect(back.x).toBeCloseTo(312, 9);
    expect(back.y).toBeCloseTo(1480, 9);
  });

  it("is the identity over reference units while inert, as a fresh object", () => {
    const mock = createMockRenderer({ dom: false });
    const point = { x: 120, y: 340 };
    const screen = mock.api.viewport.toScreen(point);

    expect(screen).toEqual({ x: 120, y: 340 });
    expect(screen).not.toBe(point);
  });
});

describe("viewport safe area: the probes are watched", () => {
  // A 1080x2400 phone: the frame is the whole mount and the scale stays 1 with a 47 px notch.
  const phone = { width: 1080, height: 2400 };

  it("an inset that arrives after start is laid out at the next frame", async () => {
    const mock = await started(phone);
    const { dom, observer } = probeWatch(mock);

    dom.insets.top = 47;
    observer.fire();

    expect(mock.modules.viewport.applyPending()).toBe(true);
    expect(mock.api.viewport.size().scale).toBe(1);
    expect(mock.api.viewport.size().safeArea.top).toBe(47);
  });

  it("a left and right swap with the same container size is laid out", async () => {
    const mock = await started({ ...phone, insets: { left: 47 } });
    const { dom, observer } = probeWatch(mock);

    expect(mock.api.viewport.size().safeArea).toMatchObject({ left: 47, right: 0 });

    Object.assign(dom.insets, { left: 0, right: 47 });
    observer.fire();
    mock.modules.viewport.applyPending();

    expect(mock.api.viewport.size().safeArea).toMatchObject({ left: 0, right: 47 });
  });

  it("the probes' observer only raises the flag: nothing is laid out before applyPending", async () => {
    const mock = await started(phone);
    const { dom, observer } = probeWatch(mock);
    const resizes = mock.pixi.last().renderer.resizes.length;

    dom.insets.top = 47;
    observer.fire();

    expect(mock.api.viewport.size().safeArea.top).toBe(0);
    expect(mock.pixi.last().renderer.resizes).toHaveLength(resizes);
  });

  it("a moku-native:insets event raises the flag and the next applyPending reads the probes; after stop it does nothing", async () => {
    const mock = await started(phone);
    const { dom } = probeWatch(mock);

    dom.insets.bottom = 34;
    dom.window.dispatch("moku-native:insets", { detail: { top: 999 } });

    expect(mock.modules.viewport.applyPending()).toBe(true);
    expect(mock.api.viewport.size().safeArea).toMatchObject({ top: 0, bottom: 34 });

    mock.stop();
    dom.window.dispatch("moku-native:insets", { detail: {} });

    expect(mock.modules.viewport.applyPending()).toBe(false);
  });

  it("stop removes both probes from the body and disconnects their observer", async () => {
    const mock = await started(phone);
    const { dom, observer } = probeWatch(mock);
    const probes = mock.ctx.state.viewport.probes;
    const body = dom.document.body.children as unknown[];

    expect(body).toEqual(expect.arrayContaining([probes?.start, probes?.end]));

    mock.stop();

    expect(body).not.toContain(probes?.start);
    expect(body).not.toContain(probes?.end);
    expect(observer.disconnected).toBe(true);
    expect(mock.ctx.state.viewport.probes).toBeUndefined();
  });
});
