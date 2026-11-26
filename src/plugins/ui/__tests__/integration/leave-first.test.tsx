import { describe, expect, it } from "vitest";
import { answerNext, EXIT_MS, exits, frames, startExits } from "../exits-app";

// ---------------------------------------------------------------------------
// Integration: an old child the render leaves out leaves before a kept sibling is patched (F84, F244 slice 2). The
// diff skips its `leaveOut` while every child keeps its place and none is left over; a column that loses its last
// child while a kept sibling takes a key of that child's subtree is the case where the order is seen: the new
// element holds the key, and the old one's drop does not take it. Real flow, world and anim; inert renderer.
// ---------------------------------------------------------------------------

/** The frames an exit of the fixture takes, and two more for the sweep. */
const EXIT_FRAMES = Math.ceil(EXIT_MS / 16) + 2;

describe("a column that loses its last child while a kept sibling takes a key of its subtree", () => {
  // Bug: the kept sibling is patched while the leaving child still holds the key: the new element enters under a key
  // another live element has, and `find` answers the one that is leaving, or nothing once its drop is done.
  it("leaves the old child first, so the new element holds the key through the whole exit", async () => {
    const app = await startExits("exits.move");
    const old = app.ui.find("moveKept") ?? 0;

    await answerNext(app, "moveNext");

    expect(exits).toEqual([{ key: "moveKept", cause: "change" }]);
    expect(app.ui.find("moveLast")).toBeUndefined();

    const entered = app.ui.find("moveKept");

    expect(entered).toBeDefined();
    expect(entered).not.toBe(old);

    // The exit plays, ends, and the old element is dropped: the key stays with the new one.
    frames(app, EXIT_FRAMES);

    expect(app.world.ecs.ownerOf(old)).toBeUndefined();
    expect(app.ui.find("moveKept")).toBe(entered);

    await app.stop();
  });
});
