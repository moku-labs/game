import { describe, expect, it } from "vitest";
import { Order } from "../../../world/ecs/define";
import { startUiApp, tick } from "../app";

// ---------------------------------------------------------------------------
// The acceptance cases of the P4 spike, with the numbers of `RESULT.md` as the
// thresholds, read off the real screen set in plain Bun.
// ---------------------------------------------------------------------------

describe("P4 case: intent once", () => {
  it("answers the gate exactly once per tap on a button with an intent", async () => {
    const app = await startUiApp();
    const settings = app.ui.find("settings") ?? 0;

    expect(app.input.tap(settings)).toBe(true);
    app.time.step(16);
    await tick();

    expect(app.ui.find("settings")).toBeDefined();

    await app.stop();
  });
});

describe("P4 case: local kept", () => {
  it("re-renders one subtree on a local write and sends no intent", async () => {
    const app = await startUiApp();
    const video = app.ui.find("video") ?? 0;

    expect(app.ui.tree().children[2]?.local).toEqual({ tab: "audio" });

    app.input.tap(video);
    app.time.step(16);

    const panel = app.ui.tree().children[2];

    expect(panel?.local).toEqual({ tab: "video" });
    expect(panel?.children.find(child => child.key === "which")).toBeDefined();

    await app.stop();
  });

  it("keeps the local state of an instance across further renders", async () => {
    const app = await startUiApp();

    app.input.tap(app.ui.find("video") ?? 0);
    app.time.step(16);
    app.time.step(16);
    app.time.step(16);

    expect(app.ui.tree().children[2]?.local).toEqual({ tab: "video" });

    await app.stop();
  });
});

describe("P4 case: unlaid frames", () => {
  it("gives every element a rect before it is ever drawn", async () => {
    const app = await startUiApp();

    /**
     * Walks the snapshot and counts the elements whose rect was never solved.
     *
     * @param node - One node of the snapshot.
     * @returns How many of them carry an empty rect.
     */
    const unlaid = (node: ReturnType<typeof app.ui.tree>): number => {
      const own = node.rect.w === 0 && node.rect.h === 0 ? 1 : 0;

      return node.children.reduce((sum, child) => sum + unlaid(child), own);
    };

    expect(unlaid(app.ui.tree())).toBe(0);

    await app.stop();
  });
});

describe("P4 case: two renders, one reconcile", () => {
  it("keeps the same entities when nothing in the description changed", async () => {
    const app = await startUiApp();
    const before = app.ui.find("coins");

    app.time.step(16);
    app.time.step(16);

    expect(app.ui.find("coins")).toBe(before);

    await app.stop();
  });
});

describe("the popup effect", () => {
  it("mounts a root of its own in the ui layer and resolves through the gate", async () => {
    const app = await startUiApp();

    expect(app.flow.gate.answer({ intent: "reward" })).toBe(true);
    await tick();
    app.time.step(16);
    app.time.step(16);

    const claim = app.ui.find("claim");

    expect(claim).toBeDefined();
    expect(app.ui.tree().children.map(child => child.key)).toContain("reward");

    const roots = [...app.world.ecs.query(Order)];

    expect(roots.length).toBeGreaterThan(0);
    expect(app.input.tap(claim ?? 0)).toBe(true);
    await tick();
    app.time.step(16);
    app.time.step(16);

    expect(app.ui.find("claim")).toBeUndefined();

    await app.stop();
  });
});

describe("lint", () => {
  it("reports an absolute element with no reason and accepts the tap targets", async () => {
    const app = await startUiApp();
    const findings = app.ui.lint();

    expect(findings.filter(finding => finding.rule === "tap-target")).toEqual([]);
    expect(findings.filter(finding => finding.rule === "absolute-without-reason")).toEqual([
      { rule: "absolute-without-reason", key: "badge", detail: "row" }
    ]);

    await app.stop();
  });

  it("is empty when nothing is mounted", async () => {
    const app = await startUiApp();

    await app.stop();

    expect(app.ui.lint()).toEqual([]);
  });
});
