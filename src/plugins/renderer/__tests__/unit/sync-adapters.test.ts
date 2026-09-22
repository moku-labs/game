import { afterEach, describe, expect, it, vi } from "vitest";
import { component, Layer, Order } from "../../../world/ecs/define";
import type { LayerSort } from "../../../world/types";
import { Shape, Transform } from "../../components";
import type { DisplayAdapter } from "../../sync/types";
import { FakeContainer } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;
const anyEntity = (): boolean => true;
const Label = component("Label", { text: "" });

type LabelValue = { text: string };

/** What the test adapter did, in call order, plus the objects it built. */
type Recorder = {
  adapter: DisplayAdapter<LabelValue>;
  calls: string[];
  objects: FakeContainer[];
};

function recordingAdapter(options: { broken?: boolean } = {}): Recorder {
  const calls: string[] = [];
  const objects: FakeContainer[] = [];
  const adapter: DisplayAdapter<LabelValue> = {
    create: (value, entity) => {
      calls.push(`create ${value.text} #${entity}`);

      if (options.broken === true) return 42;

      const object = new FakeContainer();

      objects.push(object);

      return object;
    },
    update: (_object, previous, next) => {
      calls.push(`update ${previous.text} -> ${next.text}`);
    },
    destroy: object => {
      calls.push("destroy");
      (object as FakeContainer).destroy();
    }
  };

  return { adapter, calls, objects };
}

async function started(
  layers: Array<{ name: string; sort: LayerSort }> = [{ name: "items", sort: "none" }]
): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers(layers);
  mock.modules.sync.pass();

  return mock;
}

describe("sync display adapters", () => {
  it("calls create, update and destroy in that order", async () => {
    const mock = await started();
    const recorder = recordingAdapter();

    mock.api.sync.displays.provide(Label, recorder.adapter);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 40, y: 60 }),
      Label({ text: "hello" })
    ]);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(recorder.calls).toEqual([`create hello #${entity}`]);
    expect(view?.kind).toBe("adapter");
    expect(view?.object).toBe(recorder.objects[0]);
    expect(view?.object.parent).toBe(mock.ctx.state.sync.layers.get("items")?.container);
    expect(view?.object.label).toBe(`Label#${entity}`);
    expect(view?.object.position.x).toBe(40);
    expect(view?.hitBox).toEqual({ x: -50, y: -50, width: 100, height: 100 });

    mock.world.ecs.set(entity, Label, { text: "bye" });
    mock.modules.sync.pass();

    expect(recorder.calls).toEqual([`create hello #${entity}`, "update hello -> bye"]);

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(recorder.calls).toEqual([`create hello #${entity}`, "update hello -> bye", "destroy"]);
    expect(mock.ctx.state.sync.views.has(entity)).toBe(false);
    expect(recorder.objects[0]?.parent).toBeNull();
  });

  it("answers the hit test and takes the sort of its layer, like a sprite", async () => {
    const mock = await started([{ name: "items", sort: "order" }]);
    const recorder = recordingAdapter();

    mock.api.sync.displays.provide(Label, recorder.adapter);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 200, y: 200 }),
      Order({ value: 7 }),
      Label({ text: "hud" })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.object.zIndex).toBe(7);
    expect(mock.api.sync.hitTest(200, 200, anyEntity)).toBe(entity);
    expect(mock.api.sync.hitTest(200, 260, anyEntity)).toBeUndefined();
  });

  it("removes the registration once, and draws nothing for the component after that", async () => {
    const mock = await started();
    const recorder = recordingAdapter();
    const off = mock.api.sync.displays.provide(Label, recorder.adapter);

    expect(mock.ctx.state.sync.adapters).toHaveLength(1);

    off();
    off();

    expect(mock.ctx.state.sync.adapters).toHaveLength(0);

    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Label({ text: "late" })]);
    mock.modules.sync.pass();

    expect(recorder.calls).toEqual([]);
  });

  it("stores the adapter and never calls it while inert", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    const recorder = recordingAdapter();

    mock.api.sync.displays.provide(Label, recorder.adapter);
    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Label({ text: "quiet" })]);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.adapters).toHaveLength(1);
    expect(recorder.calls).toEqual([]);
    expect(mock.ctx.state.sync.added.size).toBe(0);
    expect(mock.ctx.state.sync.views.size).toBe(0);
  });

  it("lets a built-in visual win over an adapter component, and warns once", async () => {
    const mock = await started();
    const recorder = recordingAdapter();

    mock.api.sync.displays.provide(Label, recorder.adapter);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 10, h: 10 }),
      Label({ text: "loser" })
    ]);

    mock.modules.sync.pass();

    const warnings = vi
      .mocked(mock.log.warn)
      .mock.calls.filter(([event]) => event === "renderer: entity has more than one visual");

    expect(mock.ctx.state.sync.views.get(entity)?.kind).toBe("Shape");
    expect(recorder.calls).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.[1]).toEqual(
      expect.objectContaining({ entity, kinds: ["Shape", "Label"] })
    );
  });

  it("reports an adapter that builds no display object", async () => {
    const mock = await started();
    const recorder = recordingAdapter({ broken: true });

    mock.api.sync.displays.provide(Label, recorder.adapter);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Label({ text: "broken" })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.has(entity)).toBe(false);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: adapter built no display object",
      expect.objectContaining({ entity, component: "Label" })
    );
  });

  it("destroys the adapter objects when the renderer stops", async () => {
    const mock = await started();
    const recorder = recordingAdapter();

    mock.api.sync.displays.provide(Label, recorder.adapter);
    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Label({ text: "bye" })]);
    mock.modules.sync.pass();
    mock.stop();

    expect(recorder.calls.at(-1)).toBe("destroy");
    expect(mock.ctx.state.sync.adapters).toHaveLength(0);
    expect(mock.ctx.state.sync.views.size).toBe(0);
  });
});
