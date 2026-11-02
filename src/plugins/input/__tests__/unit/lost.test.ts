import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Parent, Transform } from "../../../renderer/components";
import { Pressed, Scrollable, Swipeable, Tappable, Touchable } from "../../components";
import { record } from "../../pointer";
import type { RawSample } from "../../types";
import { createMockInput, type MockInput } from "./mock-input";

// ---------------------------------------------------------------------------
// Unit: the dev log of a press that wore the press look and did not become a
// tap (F122), one test per reason, over the mock kernel.
// ---------------------------------------------------------------------------

const KEY = { projection: "menu.buttons", key: "play" };
const LINE = "input: pressed, but the tap was not counted";

const at = (kind: RawSample["kind"], clientX: number, clientY = 50, pointerId = 1): RawSample => ({
  kind,
  pointerType: "touch",
  pointerId,
  clientX,
  clientY
});

/**
 * Spawns the play button at (0..200, 0..200), starts the plugin and presses it at (50, 50).
 *
 * @param mock - The mock input plugin.
 * @param extra - More components of the button.
 * @returns The button.
 */
function pressButton(mock: MockInput, extra: Parameters<MockInput["spawn"]>[0] = []): number {
  const button = mock.spawn(
    [Transform({ x: 0, y: 0 }), Tappable({ intent: "play" }), ...extra],
    KEY
  );

  mock.boxes.push({ entity: button, x: 0, y: 0, width: 200, height: 200 });
  mock.start();
  record(mock.state, at("down", 50));
  mock.frame();
  expect(mock.has(button, Pressed)).toBe(true);

  return button;
}

/**
 * The reasons of every lost-press line the plugin wrote.
 *
 * @param mock - The mock input plugin.
 * @returns The reasons, in order.
 */
function reasons(mock: MockInput): unknown[] {
  return vi
    .mocked(mock.log.warn)
    .mock.calls.filter(([event]) => event === LINE)
    .map(([, data]) => data);
}

describe("a press that wore the press look and was not counted, in a dev build", () => {
  beforeEach(() => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Bug caught: a good tap warns, so the log cries wolf on every button.
  it("logs nothing for a tap released inside the slop", () => {
    const mock = createMockInput();

    pressButton(mock);
    record(mock.state, at("up", 52));
    mock.frame();

    expect(mock.answers).toEqual([{ intent: "play", payload: {} }]);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  // Bug caught: a finger that slid off the button loses the tap silently.
  it("warns moved-off for a release past the tap slop", () => {
    const mock = createMockInput();

    pressButton(mock);
    record(mock.state, at("move", 70));
    record(mock.state, at("up", 70));
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "moved-off" }]);
  });

  // Bug caught: a swipeable button that swiped is reported as lost.
  it("logs nothing when the press past the slop answers its swipe", () => {
    const mock = createMockInput();

    pressButton(mock, [Swipeable({ intent: "swap" })]);
    record(mock.state, at("move", 120));
    record(mock.state, at("up", 120));
    mock.frame();

    expect(mock.answers).toHaveLength(1);
    expect(reasons(mock)).toEqual([]);
  });

  // Bug caught: a button in a scroll strip loses its tap to the pan without a word.
  it("warns scroll when the press goes to the scroll it pans", () => {
    const mock = createMockInput();
    const strip = mock.spawn([Touchable(), Scrollable({ axis: "x" })]);

    mock.boxes.push({ entity: strip, x: 0, y: 0, width: 400, height: 200 });
    pressButton(mock, [Parent({ entity: strip })]);
    record(mock.state, at("move", 80));
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "scroll" }]);
  });

  // Bug caught: a press the browser took away is lost silently.
  it("warns cancelled for a pointercancel", () => {
    const mock = createMockInput();

    pressButton(mock);
    record(mock.state, at("cancel", 50));
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "cancelled" }]);
  });

  // Bug caught: a press whose capture the browser took away is lost silently.
  it("warns capture-lost for a lost capture", () => {
    const mock = createMockInput();

    pressButton(mock);
    record(mock.state, at("lost", 50));
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "capture-lost" }]);
  });

  // Bug caught: a resting thumb's press, taken over by another finger, vanishes silently.
  it("warns other-finger when a second finger takes the resting press over", () => {
    const mock = createMockInput();

    pressButton(mock);
    record(mock.state, at("down", 300, 300, 2));
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "other-finger" }]);
  });

  // Bug caught: a world that pauses under the finger drops the press silently, or warns every frame.
  it("warns paused once when the world pauses", () => {
    const mock = createMockInput();

    pressButton(mock);
    mock.world.mode = "paused";
    mock.frame();
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "paused" }]);
  });

  // Bug caught: a world that turns fast under the finger drops the press silently.
  it("warns fast when the world turns fast", () => {
    const mock = createMockInput();

    pressButton(mock);
    mock.world.mode = "fast";
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "fast" }]);
  });

  // Bug caught: a button that left the world under the finger (a scene switch) is lost silently.
  it("warns view-gone when the pressed view left before the release", () => {
    const mock = createMockInput();
    const button = pressButton(mock);

    mock.kill(button);
    record(mock.state, at("up", 50));
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "view-gone" }]);
  });

  // Bug caught: a view without a tap (a plain Touchable) is reported as a lost button.
  it("logs nothing for a press on a view that answers no tap", () => {
    const mock = createMockInput();
    const panel = mock.spawn([Transform({ x: 0, y: 0 }), Touchable()], KEY);

    mock.boxes.push({ entity: panel, x: 0, y: 0, width: 200, height: 200 });
    mock.start();
    record(mock.state, at("down", 50));
    record(mock.state, at("move", 90));
    record(mock.state, at("up", 90));
    mock.frame();

    expect(reasons(mock)).toEqual([]);
  });
});

describe("a lost press in an agent debug build", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Bug caught: the phone debug build (agent flag only) is silent exactly where taps are lost.
  it("warns with __MOKU_GAME_AGENT__ alone", () => {
    const mock = createMockInput();

    // Set after the start: the agent flag also turns on monitor counters the mock has no renderer for.
    pressButton(mock);
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    record(mock.state, at("move", 70));
    record(mock.state, at("up", 70));
    mock.frame();

    expect(reasons(mock)).toEqual([{ view: KEY, reason: "moved-off" }]);
  });
});

describe("a lost press outside a dev build", () => {
  // Bug caught: a release build pays for the log, or prints it to the player.
  it("logs nothing", () => {
    const mock = createMockInput();

    pressButton(mock);
    record(mock.state, at("move", 70));
    record(mock.state, at("up", 70));
    mock.frame();

    expect(reasons(mock)).toEqual([]);
  });
});
