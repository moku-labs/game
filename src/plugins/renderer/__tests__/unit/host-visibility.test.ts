import { afterEach, describe, expect, it, vi } from "vitest";
import { watchVisibility } from "../../host/visibility";
import { withDeps } from "../../lifecycle";
import { createMockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host visibility", () => {
  it("pauses on a hidden tab and resumes when it is visible again", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const dom = mock.dom;

    if (dom === undefined) throw new Error("the fake dom is missing");

    dom.document.hidden = true;
    dom.document.dispatch("visibilitychange");
    expect(mock.pauses).toEqual([{ action: "push", reason: "background" }]);

    dom.document.hidden = false;
    dom.document.dispatch("visibilitychange");
    expect(mock.pauses.at(-1)).toEqual({ action: "pop", reason: "background" });
  });

  it("listens to nothing while inert", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    expect(mock.pauses).toHaveLength(0);
  });

  it("attaches nothing where there is no document", () => {
    const mock = createMockRenderer({ dom: false });

    watchVisibility(withDeps(mock.ctx));

    expect(mock.ctx.state.host.cleanups).toHaveLength(0);
    expect(mock.pauses).toHaveLength(0);
  });

  it("removes its listener on stop", async () => {
    const mock = createMockRenderer();

    await mock.start();
    const before = mock.dom?.documentListeners() ?? 0;

    mock.stop();

    expect(before).toBeGreaterThan(0);
    expect(mock.dom?.documentListeners()).toBe(0);
  });
});
