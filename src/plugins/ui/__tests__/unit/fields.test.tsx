import { afterEach, describe, expect, it, vi } from "vitest";
import { Touchable } from "../../../input/components";
import { Shape, Transform } from "../../../renderer/components";
import { Text } from "../../../text/components";
import { Box } from "../../components";
import {
  alphaOf,
  type FieldApp,
  find,
  landBodyFont,
  logged,
  mountScreen,
  nodeOf,
  openRename,
  partsOf,
  settle,
  startFieldApp
} from "../field-app";

// ---------------------------------------------------------------------------
// Unit test: the text field headless — real world, real flow runner, a fake
// text.measure of 10 px per character; `fill` and `pressKey` drive it
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it. */
let running: FieldApp | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
  vi.restoreAllMocks();
});

/**
 * Starts the fixture headless and keeps it for the teardown.
 *
 * @returns The app.
 */
async function start(): Promise<FieldApp> {
  const { app } = await startFieldApp();

  running = app;

  return app;
}

/**
 * The value the snapshot shows for a field.
 *
 * @param app - The running app.
 * @param key - The key of the field.
 * @returns The value.
 */
function shownValue(app: FieldApp, key: string): string | undefined {
  return nodeOf(app.ui.tree(), key)?.value;
}

describe("the input tag", () => {
  it("spawns the field with Touchable, a clipping Shape and four parts", async () => {
    const app = await start();

    mountScreen(app, "profile");

    const field = find(app, "nickField");
    const parts = partsOf(app, field);

    expect(app.world.ecs.has(field, Touchable)).toBe(true);
    expect(app.world.ecs.get(field, Shape)?.clip).toBe(true);
    expect(app.world.ecs.get(field, Box)).toMatchObject({ w: 400, h: 80 });
    expect(parts.all).toHaveLength(4);
    expect([parts.selection, parts.text, parts.caret, parts.composing]).not.toContain(undefined);
    expect(alphaOf(app, parts.caret)).toBe(0);
  });

  it("keeps the parts out of tree() and shows the value on the field node", async () => {
    const app = await start();

    mountScreen(app, "profile");

    const node = nodeOf(app.ui.tree(), "nickField");

    expect(node?.value).toBe("");
    expect(node?.children).toEqual([]);
  });

  it("throws on an input without local, and the other roots stay", async () => {
    const app = await start();
    const error = vi.spyOn(app.log, "error");

    mountScreen(app, "profile");
    mountScreen(app, "bare");

    expect(app.ui.find("bareField")).toBeUndefined();
    expect(app.ui.find("nickField")).toBeDefined();

    const failed = error.mock.calls.find(call => call[0] === "ui:root-failed");

    expect(failed?.[2]?.message).toBe(
      '[game] An input needs a local field.\n  Write <input local="name" />.'
    );
  });

  it("warns once for an input outside every component; it takes the text and keeps none", async () => {
    const app = await start();

    mountScreen(app, "loose");

    expect(logged(app, "ui:input-without-component")).toEqual([
      { key: "looseField" },
      { key: "tinyField" }
    ]);
    expect(app.ui.fill("looseField", "hi")).toBe(true);
    expect(shownValue(app, "looseField")).toBe("hi");

    app.time.step(16);
    app.input.pressKey("Escape");
    app.time.step(16);

    expect(shownValue(app, "looseField")).toBe("");
    expect(logged(app, "ui:input-without-component")).toHaveLength(2);
  });
});

describe("fill", () => {
  it("writes the local, which re-renders the component on the next frame", async () => {
    const app = await start();

    mountScreen(app, "profile");

    expect(app.ui.fill("nickField", "Bob")).toBe(true);

    app.time.step(16);

    expect(app.world.ecs.get(find(app, "nickEcho"), Text)?.content).toBe("nick:Bob");
    expect(shownValue(app, "nickField")).toBe("Bob");
  });

  it("cuts the value to maxLength", async () => {
    const app = await start();

    mountScreen(app, "profile");
    app.ui.fill("nickField", "abcdefghijk");
    app.time.step(16);

    expect(shownValue(app, "nickField")).toBe("abcdefgh");
    expect(app.world.ecs.get(find(app, "nickEcho"), Text)?.content).toBe("nick:abcdefgh");
  });

  it("answers false and warns for a key that is no live input", async () => {
    const app = await start();

    mountScreen(app, "profile");

    expect(app.ui.fill("nothing", "x")).toBe(false);
    expect(app.ui.fill("nickEcho", "x")).toBe(false);
    expect(logged(app, "ui:fill-without-input")).toEqual([{ key: "nothing" }, { key: "nickEcho" }]);
  });

  it("shows the caret after the typed text while the field is edited", async () => {
    const app = await start();

    mountScreen(app, "profile");
    app.ui.fill("nickField", "Bob");
    app.time.step(16);

    const parts = partsOf(app, find(app, "nickField"));

    expect(alphaOf(app, parts.caret)).toBe(1);
    expect(app.world.ecs.get(parts.caret ?? 0, Shape)).toMatchObject({ w: 3, h: 40, fill: 0 });
    expect(app.world.ecs.get(parts.text ?? 0, Text)?.content).toBe("Bob");
  });

  it("measures a still field once: the next frame lays nothing out", async () => {
    const app = await start();

    mountScreen(app, "profile");
    app.ui.fill("nickField", "Bob");
    app.time.step(16);
    app.time.step(16);

    const measure = vi.mocked(app.text.measure);

    measure.mockClear();
    app.time.step(16);

    expect(measure).not.toHaveBeenCalled();

    app.ui.fill("nickField", "Bobby");
    app.time.step(16);

    expect(measure).toHaveBeenCalled();
  });

  it("lays a still field out again on the frame after its font installs", async () => {
    const app = await start();

    mountScreen(app, "profile");
    app.ui.fill("nickField", "Bob");
    app.time.step(16);
    app.time.step(16);

    const caret = partsOf(app, find(app, "nickField")).caret ?? 0;
    const caretX = (): number | undefined => app.world.ecs.get(caret, Transform)?.x;
    const fallbackX = caretX();

    landBodyFont(app);
    app.time.step(16);

    expect(fallbackX).toBe(30);
    expect(caretX()).toBe(60);
  });
});

describe("Enter, Escape and the end of the editing", () => {
  it("answers the gate once with { name } on Enter when the field names submit", async () => {
    const app = await start();

    await openRename(app);

    const answer = vi.spyOn(app.flow.gate, "answer");

    expect(app.ui.fill("nameField", "Alex")).toBe(true);
    app.time.step(16);

    expect(app.input.pressKey("Enter")).toBe(true);
    expect(answer).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenCalledWith({ intent: "save", payload: { name: "Alex" } });

    await settle(app);

    expect(app.model.store.snapshot().player).toEqual({ name: "Alex", saves: 1 });
  });

  it("answers nothing on Enter when the field names no submit", async () => {
    const app = await start();

    await openRename(app);

    const answer = vi.spyOn(app.flow.gate, "answer");

    app.ui.fill("noteField", "a@b.c");
    app.time.step(16);

    expect(app.input.pressKey("Enter")).toBe(false);
    expect(answer).not.toHaveBeenCalled();
  });

  it("ends the editing on Escape; the local keeps the value", async () => {
    const app = await start();

    mountScreen(app, "profile");
    app.ui.fill("nickField", "Bob");
    app.time.step(16);

    expect(app.input.pressKey("Escape")).toBe(true);

    app.time.step(16);

    const parts = partsOf(app, find(app, "nickField"));

    expect(alphaOf(app, parts.caret)).toBe(0);
    expect(shownValue(app, "nickField")).toBe("Bob");
    expect(app.input.pressKey("Escape")).toBe(false);
  });

  it("ends the editing when another button is tapped", async () => {
    const app = await start();

    mountScreen(app, "profile");
    app.ui.fill("nickField", "Bob");
    app.time.step(16);
    app.input.tap(find(app, "other"));
    app.time.step(16);

    expect(alphaOf(app, partsOf(app, find(app, "nickField")).caret)).toBe(0);
    expect(app.input.pressKey("Enter")).toBe(false);
  });

  it("starts the editing on a tap on the field", async () => {
    const app = await start();

    mountScreen(app, "profile");
    app.input.tap(find(app, "nickField"));
    app.time.step(16);

    expect(alphaOf(app, partsOf(app, find(app, "nickField")).caret)).toBe(1);
  });

  it("ends the editing when its popup is covered", async () => {
    const app = await start();

    await openRename(app);
    app.ui.fill("nameField", "Al");
    app.time.step(16);
    app.flow.gate.answer({ intent: "confirm" });
    await settle(app, 3);

    const field = find(app, "nameField");

    expect(alphaOf(app, partsOf(app, field).caret)).toBe(0);
    expect(shownValue(app, "nameField")).toBe("Al");
  });

  it("despawns the parts with the field", async () => {
    const app = await start();

    await openRename(app);

    const field = find(app, "nameField");
    const parts = partsOf(app, field).all;

    expect(parts).toHaveLength(4);

    app.flow.gate.answer({ intent: "close" });
    await settle(app, 4);

    expect(app.ui.find("nameField")).toBeUndefined();
    expect(
      parts.map(part => app.world.ecs.has(part, Shape) || app.world.ecs.has(part, Text))
    ).toEqual([false, false, false, false]);
  });

  it("draws the placeholder while the value is empty", async () => {
    const app = await start();

    await openRename(app);

    const text = partsOf(app, find(app, "nameField")).text ?? 0;

    expect(app.world.ecs.get(text, Text)?.content).toEqual(
      expect.objectContaining({ key: "rename.hint" })
    );
  });

  it("draws the placeholder at half alpha and the value at full alpha", async () => {
    const app = await start();

    await openRename(app);

    const text = partsOf(app, find(app, "nameField")).text ?? 0;

    expect(app.world.ecs.get(text, Text)?.alpha).toBe(0.5);

    app.ui.fill("nameField", "Alex");
    app.time.step(16);

    expect(app.world.ecs.get(text, Text)).toMatchObject({ content: "Alex", alpha: 1 });

    app.ui.fill("nameField", "");
    app.time.step(16);

    expect(app.world.ecs.get(text, Text)?.alpha).toBe(0.5);
  });
});

describe("the keyboard focus", () => {
  it("makes a field the one being edited when Tab lands on it, ring shown", async () => {
    const app = await start();

    mountScreen(app, "profile");

    expect(app.input.pressKey("Tab")).toBe(true);

    app.time.step(16);

    const field = find(app, "nickField");

    expect(nodeOf(app.ui.tree(), "nickField")?.state.focus).toBe(true);
    expect(alphaOf(app, partsOf(app, field).caret)).toBe(1);

    expect(app.input.pressKey("Tab")).toBe(true);

    app.time.step(16);

    expect(alphaOf(app, partsOf(app, field).caret)).toBe(0);
  });

  it("counts a field as a control of lint's tap target, never its parts", async () => {
    const app = await start();

    mountScreen(app, "loose");

    expect(app.ui.lint()).toEqual([{ rule: "tap-target", key: "tinyField", detail: "30 x 30 pt" }]);
  });
});
