import { afterEach, describe, expect, it, vi } from "vitest";
import { showUnsupported } from "../../host/unsupported";
import { withDeps } from "../../lifecycle";
import { createMockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host init", () => {
  it("stays inert without a document and says so in the log", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    expect(mock.api.host.ready()).toBe(false);
    expect(mock.api.host.kind()).toBe("none");
    expect(mock.api.host.canvas()).toBeUndefined();
    expect(mock.pixi.applications).toHaveLength(0);
    expect(mock.log.debug).toHaveBeenCalled();
  });

  it("stays inert with a document but no mount, and warns", async () => {
    const mock = createMockRenderer({ config: { mount: undefined } });

    await mock.start();

    expect(mock.api.host.ready()).toBe(false);
    expect(mock.pixi.applications).toHaveLength(0);
    expect(mock.log.warn).toHaveBeenCalled();
  });

  it("throws a two-line error when the selector matches no element", async () => {
    const mock = createMockRenderer({ config: { mount: "#nope" } });

    await expect(mock.start()).rejects.toThrow(
      '[game] renderer.mount "#nope" matches no element.\n' +
        '  Add <div id="game"></div> to the page or pass the element.'
    );
  });

  it("accepts an element as the mount", async () => {
    const mock = createMockRenderer({ mountElement: true });

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.dom?.mount.children).toContain(mock.pixi.last().canvas);
  });

  it("asks Pixi for the configured options and caps the resolution", async () => {
    const mock = createMockRenderer();

    vi.stubGlobal("devicePixelRatio", 3);
    await mock.start();

    expect(mock.pixi.last().initOptions).toMatchObject({
      preference: "webgpu",
      background: 0x00_00_00,
      antialias: false,
      resolution: 2,
      autoDensity: true,
      autoStart: false,
      sharedTicker: false
    });
  });

  it("appends the canvas to the mount and reports the backend Pixi chose", async () => {
    const mock = createMockRenderer({ kind: "webgl" });

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.api.host.kind()).toBe("webgl");
    expect(mock.dom?.mount.children).toContain(mock.pixi.last().canvas);
    expect(mock.api.host.canvas()).toBe(mock.pixi.last().canvas);
  });

  it("shows the unsupported-device screen when init rejects", async () => {
    const mock = createMockRenderer({ failInit: true });

    await mock.start();

    expect(mock.api.host.ready()).toBe(false);
    expect(mock.api.host.kind()).toBe("none");
    expect(mock.api.host.canvas()).toBeUndefined();

    const alert = mock.dom?.mount.children.find(child => child.attributes.role === "alert");

    expect(alert?.textContent).toBe("This device cannot run the game.");
    expect(mock.log.error).toHaveBeenCalled();
  });

  it("shows the unsupported screen when the Pixi module itself cannot be loaded", async () => {
    const mock = createMockRenderer({
      config: { loadPixi: () => Promise.reject(new Error("no module")) }
    });

    await mock.start();

    expect(mock.api.host.ready()).toBe(false);
    expect(mock.dom?.mount.children.some(child => child.attributes.role === "alert")).toBe(true);
  });

  it("shows the unsupported screen once, however often it is asked", async () => {
    const mock = createMockRenderer({ failInit: true });

    await mock.start();

    const mount = mock.dom?.mount;

    if (mount === undefined) throw new Error("the fake dom is missing");

    showUnsupported(withDeps(mock.ctx), mount as unknown as HTMLElement, new Error("again"));

    expect(mount.children.filter(child => child.attributes.role === "alert")).toHaveLength(1);
  });

  it("draws only while it is ready", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.runPhase("render");
    expect(mock.pixi.last().renderer.renders).toBe(1);

    mock.ctx.state.host.ready = false;
    mock.runPhase("render");
    expect(mock.pixi.last().renderer.renders).toBe(1);
  });

  it("registers no render callback while inert", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    expect(mock.frames).toHaveLength(0);
  });
});
