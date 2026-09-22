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
