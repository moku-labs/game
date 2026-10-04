import { describe, expect, it } from "vitest";
import {
  type ExtrasApp,
  hintCalls,
  Mark,
  mountScreen,
  settle,
  startExtrasApp
} from "../extras-app";

// ---------------------------------------------------------------------------
// Integration: a released hint reaches the change hooks of a keyed element on
// the reconcile of the commit's frame (14-ui Delta 10 Part A, rule 4). Real
// flow, world and anim; plain Bun, inert renderer, real Yoga.
// ---------------------------------------------------------------------------

/**
 * Starts the extras app with the hint screen and the hinted world view mounted, the calls
 * cleared.
 *
 * @returns The running app.
 */
async function startHinted(): Promise<ExtrasApp> {
  const app = await startExtrasApp();

  mountScreen(app, "hintScreen");
  mountScreen(app, "hintViews");
  hintCalls.length = 0;

  return app;
}

/**
 * Answers the gate on Home and steps the frame the commit lands in.
 *
 * @param app - The running app.
 * @param intent - `grant` (two hints) or `bump` (none).
 */
async function commit(app: ExtrasApp, intent: "grant" | "bump"): Promise<void> {
  expect(app.flow.gate.answer({ intent })).toBe(true);
  await settle(app, 1);
}

describe("hint routing to ui elements", () => {
  it("hands the hint of a commit to the extra's change hook and to change.Box on the same frame", async () => {
    const app = await startHinted();
    const text = app.ui.find("coinPillText") ?? 0;

    await commit(app, "grant");

    const fly = {
      kind: "coins.fly",
      payload: { projection: "hintScreen", key: "coinPillText", ms: 400 },
      hint: true
    };

    expect(app.world.ecs.get(text, Mark)).toEqual({ level: 2 });
    expect(hintCalls.filter(call => call.hook === "Mark")).toEqual([{ hook: "Mark", hint: fly }]);
    expect(hintCalls.filter(call => call.hook === "Box")).toEqual([{ hook: "Box", hint: fly }]);

    await app.stop();
  });

  it("empties the buffer every frame: the next commit without a hint hands none", async () => {
    const app = await startHinted();

    await commit(app, "grant");
    app.time.step(16);
    hintCalls.length = 0;
    await commit(app, "bump");

    expect(hintCalls.filter(call => call.hook !== "view.Mark")).toEqual([
      { hook: "Mark", hint: undefined },
      { hook: "Box", hint: undefined }
    ]);

    await app.stop();
  });

  it("leaves the world's own routing as it was: a projection view still gets its hint", async () => {
    const app = await startHinted();

    await commit(app, "grant");

    expect(hintCalls.filter(call => call.hook === "view.Mark")).toEqual([
      {
        hook: "view.Mark",
        hint: { kind: "view.bump", payload: { projection: "hintViews", key: "v1" }, hint: true }
      }
    ]);

    await app.stop();
  });
});
