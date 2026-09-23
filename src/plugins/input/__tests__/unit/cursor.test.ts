import { describe, expect, it } from "vitest";
import { LocalWrite } from "../../../ui/components";
import type { AnyComponentValue } from "../../../world/ecs/types";
import { createInputApi } from "../../api";
import { Draggable, Pressable, Swipeable, Tappable, Touchable } from "../../components";
import { stopInput } from "../../lifecycle";
import { record } from "../../pointer";
import type { Config, RawSample } from "../../types";
import { createMockInput, createStubCanvas, type MockInput, type StubCanvas } from "./mock-input";

const sample = (
  kind: RawSample["kind"],
  pointerType: RawSample["pointerType"],
  clientX: number,
  clientY: number,
  pointerId = 1
): RawSample => ({ kind, pointerType, pointerId, clientX, clientY });

/** A started plugin on a stub canvas whose page cursor is `"crosshair"`, with one view at 0..100. */
function screen(
  values: readonly AnyComponentValue[],
  options: Partial<Config> = {}
): { mock: MockInput; canvas: StubCanvas; entity: number } {
  const mock = createMockInput(options);
  const canvas = createStubCanvas();
  const entity = mock.spawn(values);

  canvas.style.cursor = "crosshair";
  mock.canvas.current = canvas.element;
  mock.boxes.push({ entity, x: 0, y: 0, width: 100, height: 100 });
  mock.start();

  return { mock, canvas, entity };
}

/** Moves the mouse to a point and runs one frame. */
function hover(mock: MockInput, x: number, y: number): void {
  record(mock.state, sample("move", "mouse", x, y));
  mock.frame();
}

describe("the cursor over a control", () => {
  it("shows the control cursor while the mouse rests on a Tappable", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })]);

    hover(mock, 50, 50);

    expect(canvas.style.cursor).toBe("pointer");
    expect(createInputApi(mock.ctx).cursor()).toBe("pointer");
  });

  it.each([
    ["Draggable", [Draggable({})]],
    ["Pressable", [Pressable({ intent: "info" })]],
    ["Swipeable", [Swipeable({ intent: "swap" })]]
  ] as const)("counts a view with %s as a control", (_name, values) => {
    const { mock, canvas } = screen(values);

    hover(mock, 50, 50);

    expect(canvas.style.cursor).toBe("pointer");
  });

  it("counts a view with a component another plugin registered as a control", () => {
    const { mock, canvas } = screen([Touchable(), LocalWrite({ patch: { tab: "audio" } })]);

    createInputApi(mock.ctx).controls.add(LocalWrite);
    hover(mock, 50, 50);

    expect(canvas.style.cursor).toBe("pointer");
  });

  it("does not count a component nobody registered as a control", () => {
    const { mock, canvas } = screen([Touchable(), LocalWrite({ patch: { tab: "audio" } })]);

    hover(mock, 50, 50);

    expect(mock.state.pointerOver).toBeDefined();
    expect(canvas.style.cursor).toBe("crosshair");
  });

  it("stops counting a registered component once its remover ran", () => {
    const { mock, canvas } = screen([Touchable(), LocalWrite({ patch: { tab: "audio" } })]);
    const off = createInputApi(mock.ctx).controls.add(LocalWrite);

    hover(mock, 50, 50);
    off();
    mock.frame();

    expect(canvas.style.cursor).toBe("");
  });

  it("keeps a component registered twice until both removers ran", () => {
    const { mock, canvas } = screen([Touchable(), LocalWrite({ patch: { tab: "audio" } })]);
    const { controls } = createInputApi(mock.ctx);
    const first = controls.add(LocalWrite);
    const second = controls.add(LocalWrite);

    first();
    first();
    hover(mock, 50, 50);

    expect(canvas.style.cursor).toBe("pointer");

    second();
    mock.frame();

    expect(canvas.style.cursor).toBe("");
  });

  it("keeps the page cursor over a view that is only Touchable", () => {
    const { mock, canvas } = screen([Touchable()]);

    hover(mock, 50, 50);

    expect(mock.state.pointerOver).toBeDefined();
    expect(canvas.style.cursor).toBe("crosshair");
    expect(createInputApi(mock.ctx).cursor()).toBe("");
  });

  it("goes back to idle when the hovered button becomes disabled and loses Tappable", () => {
    const { mock, canvas, entity } = screen([Touchable(), Tappable({ intent: "play" })]);

    hover(mock, 50, 50);
    mock.input.deps.world.ecs.remove(entity, Tappable);
    mock.frame();

    expect(canvas.style.cursor).toBe("");
    expect(createInputApi(mock.ctx).cursor()).toBe("");
  });

  it("goes back to idle when the pointer leaves the canvas", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })]);

    hover(mock, 50, 50);
    record(mock.state, sample("leave", "mouse", 50, 50));
    mock.frame();

    expect(canvas.style.cursor).toBe("");
  });

  it("goes back to idle on a touch sample", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })]);

    hover(mock, 50, 50);
    record(mock.state, sample("down", "touch", 900, 900, 2));
    mock.frame();

    expect(canvas.style.cursor).toBe("");
  });

  it("goes back to idle when the mouse moves off every view", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })]);

    hover(mock, 50, 50);
    hover(mock, 500, 500);

    expect(canvas.style.cursor).toBe("");
  });

  it("writes the style only when the cursor changes", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })]);
    const written: string[] = [];
    let current = canvas.style.cursor;

    Object.defineProperty(canvas.style, "cursor", {
      get: () => current,
      set: (value: string) => {
        written.push(value);
        current = value;
      }
    });

    mock.frame();
    hover(mock, 50, 50);
    hover(mock, 60, 60);
    mock.frame();
    hover(mock, 500, 500);
    mock.frame();

    expect(written).toEqual(["pointer", ""]);
  });

  it("uses the cursors of the config", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })], {
      cursor: { control: "grab", idle: "default" }
    });

    expect(createInputApi(mock.ctx).cursor()).toBe("default");

    hover(mock, 50, 50);

    expect(canvas.style.cursor).toBe("grab");

    hover(mock, 500, 500);

    expect(canvas.style.cursor).toBe("default");
  });

  it("goes back to idle when the world pauses", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })]);

    hover(mock, 50, 50);
    mock.world.mode = "paused";
    mock.frame();

    expect(canvas.style.cursor).toBe("");
  });
});

describe("the cursor and the canvas", () => {
  it("restores the page cursor on detach", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })]);

    hover(mock, 50, 50);
    stopInput(mock.state);

    expect(canvas.style.cursor).toBe("crosshair");
    expect(createInputApi(mock.ctx).cursor()).toBe("");
  });

  it("restores the old canvas and writes the new one when the canvas is replaced", () => {
    const { mock, canvas } = screen([Tappable({ intent: "play" })]);
    const next = createStubCanvas();

    hover(mock, 50, 50);
    mock.canvas.current = next.element;
    mock.frame();

    expect(canvas.style.cursor).toBe("crosshair");
    expect(next.style.cursor).toBe("pointer");
  });

  it("answers the idle cursor and writes nothing without a canvas", () => {
    const mock = createMockInput();
    const entity = mock.spawn([Tappable({ intent: "play" })]);

    mock.boxes.push({ entity, x: 0, y: 0, width: 100, height: 100 });
    mock.start();
    mock.frame();

    expect(createInputApi(mock.ctx).cursor()).toBe("");
  });
});
