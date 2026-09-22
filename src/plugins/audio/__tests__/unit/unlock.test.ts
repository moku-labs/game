import { afterEach, describe, expect, it, vi } from "vitest";
import { removeUnlock } from "../../unlock";
import { createFakeContext, installFakeWindow } from "../fake-audio-context";
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
