import { afterEach, describe, expect, it, vi } from "vitest";
import type { Descriptor } from "../../../flow/types";
import { removeUnlock } from "../../unlock";
import { createFakeContext, installFakeWindow, keyOf } from "../fake-audio-context";
import { createMockAudio } from "./mock-audio";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Yields the microtask queue, the way a test waits for `resume()` without a timer. */
async function tick(times = 10): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe("installUnlock", () => {
  it("listens once for a pointerdown and a touchend on the window", () => {
    const fakeWindow = installFakeWindow();
    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();

    expect(fakeWindow.listeners.map(entry => entry.type)).toEqual(["pointerdown", "touchend"]);
    expect(fakeWindow.listeners.every(entry => entry.once)).toBe(true);
  });

  it("installs nothing where there is no window", () => {
    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();

    expect(mock.state.unlock).toBeUndefined();
  });

  it("removes both listeners on the first event and resumes the context", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    fakeWindow.dispatch("pointerdown");
    await tick();

    expect(fakeWindow.listeners).toHaveLength(0);
    expect(context.resumes).toBe(1);
    expect(mock.api.unlocked()).toBe(true);
  });

  it("unlocks from a touchend as well", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    fakeWindow.dispatch("touchend");
    await tick();

    expect(context.resumes).toBe(1);
    expect(mock.state.unlocked).toBe(true);
  });

  it("stays locked and listens again when the context did not reach running", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    context.resumeState = "suspended";
    mock.start();
    fakeWindow.dispatch("pointerdown");
    await tick();

    expect(mock.state.unlocked).toBe(false);
    expect(fakeWindow.listeners).toHaveLength(2);
  });

  it("warns and listens again when the browser refused to resume", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    context.resumeFails = true;
    mock.start();
    fakeWindow.dispatch("pointerdown");
    await tick();

    expect(mock.log.warn).toHaveBeenCalledWith("audio: the context did not resume");
    expect(fakeWindow.listeners).toHaveLength(2);
    expect(mock.state.unlocked).toBe(false);
  });

  it("starts the music the scene declared while the context was still locked", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    mock.hooks["scenes:changed"]({ from: undefined, to: "board", music: "board.theme" });
    await tick();

    expect(context.sources).toHaveLength(0);

    fakeWindow.dispatch("pointerdown");
    await tick();

    expect(context.sources).toHaveLength(1);
    expect(mock.state.music?.source).toBeDefined();
  });
});

/** Builds the `sfx` descriptor `anim` hands the handler. */
function sfx(key: string): Descriptor {
  return { kind: "sfx", payload: { key }, cosmetic: true };
}

describe("sounds during the unlock", () => {
  it("marks the context as resuming until the resume settles", async () => {
    const fakeWindow = installFakeWindow();
    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();
    fakeWindow.dispatch("pointerdown");

    expect(mock.state.resuming).toBe(true);

    await tick();

    expect(mock.state.resuming).toBe(false);
  });

  it("plays a sound fired while resume() is pending once the context runs", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    fakeWindow.dispatch("pointerdown");
    const play = mock.fx("sfx", sfx("ui.click"));

    expect([...mock.state.pendingSfx.keys()]).toEqual(["ui.click"]);
    expect(context.sources).toHaveLength(0);

    await play;
    await tick();

    expect(context.sources.map(source => keyOf(source.buffer))).toEqual(["ui.click"]);
    expect(mock.state.pendingSfx.size).toBe(0);
  });

  it("keeps one sound per key while the resume is pending", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    fakeWindow.dispatch("pointerdown");
    const plays = [
      mock.fx("sfx", sfx("ui.click")),
      mock.fx("sfx", sfx("ui.click")),
      mock.fx("sfx", sfx("ui.popup"))
    ];

    expect(mock.state.pendingSfx.size).toBe(2);

    await Promise.all(plays);
    await tick();

    expect(context.sources.map(source => keyOf(source.buffer))).toEqual(["ui.click", "ui.popup"]);
  });

  it("drops the queued sounds when the browser refuses to resume", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    context.resumeFails = true;
    mock.start();
    fakeWindow.dispatch("pointerdown");
    await mock.fx("sfx", sfx("ui.click"));
    await tick();

    expect(context.sources).toHaveLength(0);
    expect(mock.state.pendingSfx.size).toBe(0);
    expect(mock.state.resuming).toBe(false);
  });

  it("drops the queued sounds when the context resumed but does not run", async () => {
    const fakeWindow = installFakeWindow();
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    context.resumeState = "suspended";
    mock.start();
    fakeWindow.dispatch("pointerdown");
    await mock.fx("sfx", sfx("ui.click"));
    await tick();

    expect(context.sources).toHaveLength(0);
    expect(mock.state.pendingSfx.size).toBe(0);
  });

  it("queues nothing before the first gesture", async () => {
    installFakeWindow();
    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();
    await mock.fx("sfx", sfx("ui.click"));

    expect(mock.state.pendingSfx.size).toBe(0);
  });
});

describe("removeUnlock", () => {
  it("takes both listeners off and forgets the remover", () => {
    const fakeWindow = installFakeWindow();
    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();
    removeUnlock(mock.state);

    expect(fakeWindow.listeners).toHaveLength(0);
    expect(mock.state.unlock).toBeUndefined();
  });

  it("does nothing when no listener was installed", () => {
    const mock = createMockAudio();

    expect(() => removeUnlock(mock.state)).not.toThrow();
  });
});
