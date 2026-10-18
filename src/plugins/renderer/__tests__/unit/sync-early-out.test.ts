import { describe, expect, it } from "vitest";
import { component, Layer, Order } from "../../../world/ecs/define";
import { Sprite, Transform } from "../../components";
import { FakeContainer } from "../fake-pixi";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the early out of the sync pass (R4 of change 2026-10-18-cheap-idle-tick). A pass returns before any work when
// nothing changed; a change of any one watched component, alone in its frame, still reaches its view.
// ---------------------------------------------------------------------------

const owner = { kind: "plugin", name: "test" } as const;

/** A component a plugin above draws its own way, as `text` draws `Text`. */
const Label = component("Label", { text: "" });

describe("the sync pass's early out", () => {
  it("lets a frame whose only change is an Order resort the view", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.world.projection.setLayers([{ name: "items", sort: "order" }]);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite(),
      Order({ value: 7 })
    ]);

    mock.modules.sync.pass();
    mock.world.clearChanges();
    mock.world.ecs.set(entity, Order, { value: 2 });
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.object.zIndex).toBe(2);
  });

  it("lets a frame whose only change is an adapter's component update its view", async () => {
    const mock = createMockRenderer();
    const updates: string[] = [];

    await mock.start();
    mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
    mock.api.sync.displays.provide(Label, {
      create: () => new FakeContainer(),
      update: (_object, previous, next) => {
        updates.push(`${previous.text} -> ${next.text}`);
      },
      destroy: () => {}
    });

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Label({ text: "12" })
    ]);

    mock.modules.sync.pass();
    mock.world.clearChanges();
    mock.world.ecs.set(entity, Label, { text: "13" });
    mock.modules.sync.pass();

    expect(updates).toEqual(["12 -> 13"]);
  });
});
