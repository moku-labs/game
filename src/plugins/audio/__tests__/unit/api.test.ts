import { describe, expect, it } from "vitest";
import type { Bus } from "../../types";
import { createFakeContext } from "../fake-audio-context";
import { createMockAudio } from "./mock-audio";

describe("setVolume", () => {
  it("stores the value and schedules it on the bus gain", () => {
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    mock.api.setVolume("music", 0.25);

    expect(mock.api.volume("music")).toBe(0.25);
    expect(context.gains[1]?.gain.ramps.at(-1)).toEqual([0.25, 0]);
  });

  it("clamps above one, below zero, and turns NaN into zero", () => {
    const mock = createMockAudio();

    mock.api.setVolume("master", 2);
    expect(mock.api.volume("master")).toBe(1);

    mock.api.setVolume("master", -1);
    expect(mock.api.volume("master")).toBe(0);

    mock.api.setVolume("master", Number.NaN);
    expect(mock.api.volume("master")).toBe(0);
  });

  it("throws the two-line message for a bus that does not exist", () => {
    const mock = createMockAudio();

    expect(() => mock.api.setVolume("voice" as Bus, 1)).toThrow(
      '[game] Audio bus "voice" does not exist.\n  Use "master", "music" or "sfx".'
    );
  });

  it("keeps the value headless, where there is no gain to schedule", () => {
    const mock = createMockAudio();

    mock.start();
    mock.api.setVolume("sfx", 0.5);

    expect(mock.api.volume("sfx")).toBe(0.5);
    expect(mock.state.context).toBeUndefined();
  });
});

describe("volume", () => {
  it("answers the configured start volume", () => {
    const mock = createMockAudio();

    expect(mock.api.volume("music")).toBe(0.6);
  });

  it("answers the stored value of a muted bus, not its live gain", () => {
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    mock.api.mute("music", true);

    expect(mock.api.volume("music")).toBe(0.6);
    expect(context.gains[1]?.gain.ramps.at(-1)).toEqual([0, 0]);
  });

  it("throws for a bus that does not exist", () => {
    const mock = createMockAudio();

    expect(() => mock.api.volume("voice" as Bus)).toThrow("does not exist");
  });
});

describe("mute", () => {
  it("schedules zero and puts the volume back when it is unmuted", () => {
    const context = createFakeContext();
    const mock = createMockAudio({ context });

    mock.start();
    mock.api.mute("sfx", true);
    mock.api.mute("sfx", false);

    expect(context.gains[2]?.gain.ramps.slice(-2)).toEqual([
      [0, 0],
      [1, 0]
    ]);
  });

  it("throws for a bus that does not exist", () => {
    const mock = createMockAudio();

    expect(() => mock.api.mute("voice" as Bus, true)).toThrow("does not exist");
  });
});

describe("unlocked", () => {
  it("is false before the first pointer event and headless", () => {
    const mock = createMockAudio();

    mock.start();

    expect(mock.api.unlocked()).toBe(false);
  });

  it("is true once the context is running", () => {
    const mock = createMockAudio({ context: createFakeContext() });

    mock.start();
    mock.state.unlocked = true;

    expect(mock.api.unlocked()).toBe(true);
  });
});
