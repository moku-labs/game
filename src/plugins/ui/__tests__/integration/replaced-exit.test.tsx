import { describe, expect, it } from "vitest";
import { Alpha } from "../../../../index";
import { Exiting } from "../../../world/ecs/define";
import { answerNext, EXIT_MS, exits, frames, startExits } from "../exits-app";

// ---------------------------------------------------------------------------
// Integration: an element a render replaces leaves the way a removed one does. A root whose key
// changed (F83) and a card replaced under a live parent (F84) play their exits, and so does
// everything under them; the replaced elements drop out of `find` at once, and the new ones take
// their keys. Real flow, world and anim; plain Bun, inert renderer, real Yoga.
// ---------------------------------------------------------------------------

/** The frames an exit of the fixture takes, and two more for the sweep. */
const EXIT_FRAMES = Math.ceil(EXIT_MS / 16) + 2;

describe("a root whose key changes (F83)", () => {
  // Bug: the old root stayed live and found by `find` while `tree()` showed the new one, and played no exit.
  it("exits the old root and its children with the cause change, out of find at once, the new root entered", async () => {
    const app = await startExits("exits.ward");
    const oldRoot = app.ui.find("wardWait") ?? 0;
    const oldCard = app.ui.find("waitCard") ?? 0;
    const oldButton = app.ui.find("wardNext") ?? 0;

    await answerNext(app, "wardNext");

    expect(app.ui.tree().key).toBe("wardReady");
    expect(app.ui.find("wardWait")).toBeUndefined();
    expect(app.ui.find("waitCard")).toBeUndefined();
    expect(app.ui.find("wardReady")).toBeDefined();
    expect(exits).toEqual([
      { key: "wardWait", cause: "change" },
      { key: "waitCard", cause: "change" }
    ]);
    expect(app.world.ecs.has(oldRoot, Exiting)).toBe(true);

    // The fade starts at the next frame step.
    frames(app, 1);

    expect(app.world.ecs.get(oldRoot, Alpha)?.alpha).toBeLessThan(1);
    expect(app.world.ecs.get(oldCard, Alpha)?.alpha).toBeLessThan(1);

    // The new root's button takes the key both trees give it: find answers the live one.
    const newButton = app.ui.find("wardNext");

    expect(newButton).toBeDefined();
    expect(newButton).not.toBe(oldButton);
    expect(app.ui.tree().children.map(node => node.key)).toEqual(["wardNext"]);

    // The exit ends: the old root and its children are gone.
    frames(app, EXIT_FRAMES);

    expect(app.world.ecs.ownerOf(oldRoot)).toBeUndefined();
    expect(app.world.ecs.ownerOf(oldCard)).toBeUndefined();
    expect(app.ui.find("wardNext")).toBe(newButton);

    await app.stop();
  });
});

describe("a component whose view returns another key (F83)", () => {
  // Bug: the element was patched under its old key, so `find` and `tree()` named a row that was gone.
  it("replaces the element its view returned, and the component keeps its local state", async () => {
    const app = await startExits("exits.swap");
    const shut = app.ui.find("swapShut") ?? 0;

    app.input.tap(app.ui.find("swapOpener") ?? 0);
    frames(app, 2);

    expect(app.ui.tree().key).toBe("swapOpen");
    expect(app.ui.find("swapShut")).toBeUndefined();
    expect(exits).toEqual([{ key: "swapShut", cause: "change" }]);
    expect(app.world.ecs.has(shut, Exiting)).toBe(true);

    // The next render keeps the sheet open: its local state stayed with the component.
    const open = app.ui.find("swapOpen");

    await answerNext(app, "swapNext");
    frames(app, 1);

    expect(app.ui.tree().local).toEqual({ open: true });
    expect(app.ui.find("swapOpen")).toBe(open);
    expect(app.ui.tree().children.map(node => node.content)).toEqual([undefined, "1"]);

    await app.stop();
  });
});

describe("a subtree replaced under a live parent (F84)", () => {
  // Bug: the replaced card played its own exit, and the elements under it played none.
  it("plays the exit of every element under a card of another key, and of a child whose tag changed", async () => {
    const app = await startExits("exits.list");
    const deep = app.ui.find("cardADeep") ?? 0;
    const inner = app.ui.find("cardInner") ?? 0;

    await answerNext(app, "listNext");

    expect(exits).toEqual([
      { key: "cardA", cause: "change" },
      { key: "cardAInner", cause: "change" },
      { key: "cardADeep", cause: "change" },
      { key: "slot", cause: "change" },
      { key: "slotInner", cause: "change" }
    ]);

    // The fade starts at the next frame step.
    frames(app, 1);

    expect(app.world.ecs.get(deep, Alpha)?.alpha).toBeLessThan(1);

    // The new card's child takes the key of the old card's child.
    const replaced = app.ui.find("cardInner");

    expect(replaced).toBeDefined();
    expect(replaced).not.toBe(inner);

    frames(app, EXIT_FRAMES);

    expect(app.world.ecs.ownerOf(deep)).toBeUndefined();
    expect(app.ui.find("cardInner")).toBe(replaced);

    await app.stop();
  });
});
