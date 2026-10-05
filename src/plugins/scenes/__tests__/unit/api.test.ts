import { describe, expect, it } from "vitest";
import { defineScene } from "../../define";
import { createMockScenes } from "./mock-scenes";

const homeScene = defineScene("home", { bundle: "home", layers: { ui: {} }, projections: [] });

describe("current", () => {
  it("answers undefined before the first switch", () => {
    const mock = createMockScenes();

    expect(mock.api.current()).toBeUndefined();
  });

  it("answers the id of the scene the last switch mounted", async () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "menu", description: { scenes: [homeScene] } });
    mock.start();
    await mock.enter({ scene: "home", rest: true });

    expect(mock.api.current()).toBe("home");
  });

  it("answers undefined again after the app stopped", async () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "menu", description: { scenes: [homeScene] } });
    mock.start();
    await mock.enter({ scene: "home", rest: true });
    mock.stop();

    expect(mock.api.current()).toBeUndefined();
  });
});

describe("expect", () => {
  it("records the scene the next rest node without its own scene mounts", () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "menu", description: { scenes: [homeScene] } });
    mock.start();
    mock.api.expect("home");

    expect(mock.state.pending).toBe("home");
    expect(mock.api.current()).toBeUndefined();
  });

  it("throws for an id no feature declared and records nothing", () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "menu", description: { scenes: [homeScene] } });
    mock.start();

    expect(() => mock.api.expect("hom")).toThrow(
      '[game] Scene "hom" is not registered.\n  List it in the scenes of a feature.'
    );
    expect(mock.state.pending).toBeUndefined();
  });

  it("throws before onStart filled the registry", () => {
    const mock = createMockScenes();

    mock.flow.features.push({ name: "menu", description: { scenes: [homeScene] } });

    expect(() => mock.api.expect("home")).toThrow('[game] Scene "home" is not registered.');
  });
});
