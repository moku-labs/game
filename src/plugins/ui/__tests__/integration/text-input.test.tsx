import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../flow/doors/run";
import { keyCommand } from "../../../input/control";
import { UiCounters } from "../../components";
import { fillCommand } from "../../control";
import { find, openRename, settle, startFieldApp } from "../field-app";

// ---------------------------------------------------------------------------
// Integration: the Rename popup end to end, headless — fill, Enter, the gate
// answer closes the popup, and nothing of it is left after
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Rename popup", () => {
  it("saves the typed name through Enter and leaves no node behind", async () => {
    const { app } = await startFieldApp();

    await openRename(app);

    expect(find(app, "nameField")).toBeGreaterThan(0);
    expect(app.ui.fill("nameField", "Alex")).toBe(true);

    app.time.step(16);

    expect(app.input.pressKey("Enter")).toBe(true);

    await settle(app, 6);

    expect(app.model.store.snapshot().player).toEqual({ name: "Alex", saves: 1 });
    expect(app.ui.find("nameField")).toBeUndefined();
    expect(app.ui.find("renamePanel")).toBeUndefined();
    expect(app.world.ecs.resource(UiCounters).nodes).toBe(0);

    await app.stop();
  });

  it("keeps the local when Escape ends the editing, and the button saves it", async () => {
    const { app } = await startFieldApp();

    await openRename(app);
    app.ui.fill("nameField", "Mia");
    app.time.step(16);

    expect(app.input.pressKey("Escape")).toBe(true);

    app.time.step(16);

    expect(app.input.tap(find(app, "ok"))).toBe(true);

    await settle(app, 6);

    expect(app.model.store.snapshot().player).toMatchObject({ name: "Mia" });

    await app.stop();
  });

  it("takes the name through the fill and key commands of the door", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const { app } = await startFieldApp();

    await openRename(app);

    const answer = vi.spyOn(app.flow.gate, "answer");

    const filled = await run(app, fillCommand, { key: "nameField", value: "Alex" });

    expect(filled.value).toBe(true);

    app.time.step(16);

    const pressed = await run(app, keyCommand, { key: "Enter" });

    expect(pressed.value).toBe(true);
    expect(answer).toHaveBeenCalledWith({ intent: "save", payload: { name: "Alex" } });

    await app.stop();
  });
});
