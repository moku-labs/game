import { afterEach, describe, expect, it, vi } from "vitest";
import { Transform } from "../../../renderer/components";
import { Text } from "../../../text/components";
import { HIDDEN_STYLE } from "../../jsx/dom-input";
import type { FakeInput } from "../fake-dom";
import {
  alphaOf,
  type FieldApp,
  type FieldPage,
  find,
  mountScreen,
  nodeOf,
  openRename,
  partsOf,
  startFieldApp
} from "../field-app";

// ---------------------------------------------------------------------------
// Unit test: the text field with a page — the renderer hands out a canvas of
// a fake document, so ui makes its one hidden input there; the inert viewport
// maps reference units to CSS px one to one
// ---------------------------------------------------------------------------

/** The app of the running test, stopped after it unless the test stopped it. */
let running: FieldApp | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
  vi.restoreAllMocks();
});

/**
 * Starts the fixture on a fake page with the profile screen mounted.
 *
 * @param innerHeight - The window height in CSS px.
 * @returns The app, its page and the hidden input.
 */
async function start(
  innerHeight = 1440
): Promise<{ app: FieldApp; page: FieldPage; input: FakeInput }> {
  const { app, page } = await startFieldApp({ dom: true, innerHeight });
  const input = page?.dom.inputs[0];

  running = app;

  if (page === undefined || input === undefined) throw new Error("no hidden input was made");

  mountScreen(app, "profile");

  return { app, page, input };
}

/**
 * Lifts a finger on the nick field the way the browser does: a down and an up on the canvas.
 * The inert renderer hit-tests nothing, so the tap the frame step would resolve is made through
 * `app.input.tap`.
 *
 * @param app - The running app.
 * @param page - The fake page.
 */
function tapNick(app: FieldApp, page: FieldPage): void {
  page.canvas.pointer("pointerdown", 100, 40);
  page.canvas.pointer("pointerup", 100, 40);
  app.input.tap(find(app, "nickField"));
}

describe("the hidden input", () => {
  it("is made once in onStart with a page and taken off it in onStop", async () => {
    const { app, page, input } = await start();

    expect(page.dom.inputs).toHaveLength(1);
    expect(page.dom.body()).toEqual([input.element]);
    expect(input.style.cssText).toBe(HIDDEN_STYLE);
    expect(input.listeners()).toHaveLength(5);

    await app.stop();
    running = undefined;

    expect(input.removed()).toBe(true);
    expect(input.listeners()).toEqual([]);
  });

  it("is not made without a canvas", async () => {
    const { app, page } = await startFieldApp();

    running = app;

    expect(page).toBeUndefined();
  });
});

describe("the pointer door", () => {
  it("focuses the input with preventScroll inside the DOM pointerup on a field", async () => {
    const { page, input } = await start();

    page.canvas.pointer("pointerdown", 100, 40);

    expect(input.focusCalls).toEqual([]);

    page.canvas.pointer("pointerup", 100, 40);

    expect(input.focusCalls).toEqual([{ preventScroll: true }]);
    expect(page.dom.active()).toBe(input.element);
  });

  it("blurs the input on a finger down outside every field", async () => {
    const { app, page, input } = await start();

    tapNick(app, page);
    app.time.step(16);
    page.canvas.pointer("pointerdown", 900, 700);

    expect(page.dom.active()).toBeUndefined();

    app.time.step(16);

    expect(alphaOf(app, partsOf(app, find(app, "nickField")).caret)).toBe(0);
    expect(input.element.value).toBe("");
  });

  it("blurs a focus no tap resolved on at the next frame step", async () => {
    const { app, page, input } = await start();

    page.canvas.pointer("pointerup", 100, 40);
    app.time.step(16);

    expect(page.dom.active()).toBeUndefined();
    expect(input.blurCalls()).toBe(1);
  });
});

describe("typing", () => {
  it("writes the local and re-renders the component in the same frame", async () => {
    const { app, page, input } = await start();

    tapNick(app, page);
    input.type("Al");
    app.time.step(16);

    expect(app.world.ecs.get(find(app, "nickEcho"), Text)?.content).toBe("nick:Al");
    expect(nodeOf(app.ui.tree(), "nickField")?.value).toBe("Al");
  });

  it("keeps no more than maxLength", async () => {
    const { app, page, input } = await start();

    tapNick(app, page);
    input.type("abcdefghijk");
    app.time.step(16);

    expect(app.world.ecs.get(find(app, "nickEcho"), Text)?.content).toBe("nick:abcdefgh");
  });

  it("draws the selection and the composing range from the input", async () => {
    const { app, page, input } = await start();

    tapNick(app, page);
    input.type("Alex", 1, 3, "forward");
    app.time.step(16);

    const parts = partsOf(app, find(app, "nickField"));

    expect(alphaOf(app, parts.selection)).toBe(0.35);
    expect(app.world.ecs.get(parts.caret ?? 0, Transform)?.x).toBe(30);

    input.dispatch("compositionstart");
    input.dispatch("compositionupdate", { data: "xy" });
    app.time.step(16);

    expect(alphaOf(app, parts.selection)).toBe(0);
    expect(alphaOf(app, parts.composing)).toBe(1);

    input.dispatch("compositionend");
    app.time.step(16);

    expect(alphaOf(app, parts.composing)).toBe(0);
  });

  it("ends the editing on blur, which never submits", async () => {
    const { app, page, input } = await start();
    const answer = vi.spyOn(app.flow.gate, "answer");

    tapNick(app, page);
    input.type("Bob");
    app.time.step(16);
    input.element.blur();
    app.time.step(16);

    expect(alphaOf(app, partsOf(app, find(app, "nickField")).caret)).toBe(0);
    expect(input.element.value).toBe("");
    expect(nodeOf(app.ui.tree(), "nickField")?.value).toBe("Bob");
    expect(answer).not.toHaveBeenCalled();
  });

  it("places the input over the drawn field", async () => {
    const { app, page, input } = await start();

    tapNick(app, page);
    app.time.step(16);

    expect([input.style.left, input.style.top, input.style.width, input.style.height]).toEqual([
      "0px",
      "0px",
      "400px",
      "80px"
    ]);
  });
});

describe("the keyboard lift", () => {
  it("lifts the root above the keyboard while the field is edited, and drops it at done", async () => {
    const { app, page, input } = await start();
    const field = find(app, "lowField");
    const root = find(app, "profile");
    const rest = app.world.ecs.get(root, Transform)?.y ?? 0;

    app.input.tap(field);
    app.time.step(16);
    // The keyboard covers 540 px of the 1440 px window: 1380 + 16 − 900 = 496.
    page.dom.viewport.resize(900);
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(root, Transform)?.y).toBe(rest - 496);
    expect(input.style.top).toBe(`${1300 - 496}px`);

    input.element.blur();
    app.time.step(16);
    app.time.step(16);

    expect(app.world.ecs.get(root, Transform)?.y).toBe(rest);
    expect(page.dom.viewport.listeners()).toEqual([]);
  });
});

describe("more than one field", () => {
  it("moves the editing to another field and keeps the keyboard", async () => {
    const { app, page, input } = await start();

    tapNick(app, page);
    input.type("Al");
    app.time.step(16);
    app.input.tap(find(app, "lowField"));
    app.time.step(16);

    expect(page.dom.active()).toBe(input.element);
    expect(input.element.value).toBe("");
    expect(input.blurCalls()).toBe(0);
    expect(nodeOf(app.ui.tree(), "nickField")?.value).toBe("Al");
    expect(alphaOf(app, partsOf(app, find(app, "lowField")).caret)).toBe(1);
  });

  it("keeps editing a field tapped twice", async () => {
    const { app, page, input } = await start();

    tapNick(app, page);
    app.input.tap(find(app, "nickField"));
    app.time.step(16);

    expect(input.focusCalls.length).toBeGreaterThan(1);
    expect(alphaOf(app, partsOf(app, find(app, "nickField")).caret)).toBe(1);
  });

  it("sets the input up again when the field's props change while it is edited", async () => {
    const { app, input } = await start();

    app.input.tap(find(app, "lowField"));
    app.time.step(16);

    expect(input.attributes.get("aria-label")).toBe("Low");

    input.type("x");
    app.time.step(16);

    expect(input.attributes.get("aria-label")).toBe("Low (typed)");
  });

  it("finds no field of a root under the top one", async () => {
    const { app, page, input } = await start();

    await openRename(app);
    page.canvas.pointer("pointerup", 100, 1340);

    expect(input.focusCalls).toEqual([]);

    page.canvas.pointer("pointerup", 100, 40);

    expect(input.focusCalls).toEqual([{ preventScroll: true }]);
    expect(input.attributes.get("aria-label")).toBe("Your name");
    expect(input.attributes.get("maxlength")).toBe("16");
  });
});

describe("Enter and fill with a page", () => {
  it("submits the text the input holds now, typed in this very frame", async () => {
    const { app, page, input } = await start();

    await openRename(app);

    const answer = vi.spyOn(app.flow.gate, "answer");

    page.canvas.pointer("pointerup", 100, 40);
    app.input.tap(find(app, "nameField"));
    input.type("Zoe");

    expect(app.input.pressKey("Enter")).toBe(true);
    expect(answer).toHaveBeenCalledWith({ intent: "save", payload: { name: "Zoe" } });
  });

  it("writes the filled text into the input and focuses it", async () => {
    const { app, input } = await start();

    expect(app.ui.fill("nickField", "Bob")).toBe(true);
    expect(input.element.value).toBe("Bob");
    expect(input.element.selectionStart).toBe(3);
    expect(input.focusCalls.at(-1)).toEqual({ preventScroll: true });
  });
});
