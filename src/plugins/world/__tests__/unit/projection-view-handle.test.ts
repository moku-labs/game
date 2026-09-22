import { describe, expect, it, vi } from "vitest";
import { component, tag } from "../../ecs/define";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec, Motion, MotionHandle, ViewHandle } from "../../projection/types";
import type { MockWorld } from "./mock-world";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the ViewHandle a motion hook is given, over a projection whose view
// mixes numeric fields, a text field and a tag.
// ---------------------------------------------------------------------------

type Item = { id: string; x: number; text: string };

const Transform = component("Transform", { x: 0, y: 0, scale: 1 });
const Label = component("Label", { text: "", size: 12 });
const Glow = tag("Glow");

const PROBE = "probe.items";
const OWNER = { kind: "plugin", name: "test" } as const;

/** What the current test wants the `change.Transform` hook to do. */
type Hook = (view: ViewHandle<Item>) => Motion;

/**
 * Mounts one item with a hook the test can swap between commits.
 *
 * @param world - The mock world.
 * @returns The entity of the item and a setter for the hook.
 */
function mountProbe(world: MockWorld): {
  entity: number;
  onChange: (hook: Hook) => void;
  commit: (x: number, text?: string) => void;
} {
  let hook: Hook | undefined;

  world.model.player = { items: [{ id: "a", x: 0, text: "one" }] };
  world.api.projection.setLayers([
    { name: "items", sort: "y" },
    { name: "lifted", sort: "none" }
  ]);
  world.api.projection.register(
    projection({
      name: PROBE,
      layer: "items",
      lift: "lifted",
      from: (player: { items: Item[] }) => player.items,
      key: (item: Item) => item.id,
      view: (item: Item) => [
        Transform({ x: item.x, y: 0, scale: 1 }),
        Label({ text: item.text, size: 12 }),
        Glow()
      ],
      motion: { change: { Transform: view => hook?.(view) } }
    }) as AnyProjectionSpec
  );
  world.start();
  world.api.projection.mount([PROBE], OWNER);

  return {
    entity: world.api.projection.entityOf(PROBE, "a") ?? 0,
    onChange: (next: Hook): void => {
      hook = next;
    },
    commit: (x: number, text = "one"): void => {
      world.model.player = { items: [{ id: "a", x, text }] };
      world.commit();
    }
  };
}

describe("ViewHandle", () => {
  it("reads the current value with get and the rest pose with rest", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);
    const seen: Array<Record<string, unknown> | undefined> = [];

    probe.onChange(view => {
      view.set(Transform, { x: 5 });
      // Copies: `get` and `rest` answer with the live objects, which the settle moves afterwards.
      seen.push({ ...view.get(Transform) }, { ...view.rest(Transform) }, { ...view.rest(Label) });
    });
    probe.commit(40);
    world.frame(16);

    expect(seen[0]).toEqual({ x: 5, y: 0, scale: 1 });
    expect(seen[1]).toEqual({ x: 40, y: 0, scale: 1 });
    expect(seen[2]).toEqual({ text: "one", size: 12 });
  });

  it("answers undefined from rest for a component the view never returned", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);
    const Missing = component("Missing", { value: 0 });
    const seen: Array<unknown> = [];

    probe.onChange(view => {
      seen.push(view.rest(Missing), view.get(Missing));
    });
    probe.commit(40);
    world.frame(16);

    expect(seen).toEqual([undefined, undefined]);
  });

  it("set writes only the fields no other writer owns", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);

    const seen: Array<Record<string, unknown>> = [];

    world.api.projection.mute(probe.entity, Transform, ["x"]);
    probe.onChange(view => {
      view.set(Transform, { x: 900, y: 7 });
      seen.push({ ...view.get(Transform) });
    });
    probe.commit(40);
    world.frame(16);

    expect(seen[0]).toMatchObject({ x: 0, y: 7 });
  });

  it("set writes nothing when every field is owned by another writer", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);

    world.api.projection.mute(probe.entity, Transform, ["x", "y", "scale"]);
    probe.onChange(view => {
      view.set(Transform, { x: 900, y: 900 });
    });
    probe.commit(40);
    world.frame(16);

    expect(world.api.ecs.get(probe.entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("toRest tweens the numeric fields and writes the other fields at once", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);

    world.api.ecs.set(probe.entity, Label, { text: "stale", size: 40 });
    probe.onChange(view => view.toRest(Label, { ms: 100, ease: "linear" }));
    probe.commit(40);
    world.frame(16);

    expect(world.api.ecs.get(probe.entity, Label)?.text).toBe("one");
    expect(world.api.ecs.get(probe.entity, Label)?.size).toBeGreaterThan(12);

    world.frame(100);
    expect(world.api.ecs.get(probe.entity, Label)).toEqual({ text: "one", size: 12 });
  });

  it("toRest skips a text field another writer owns", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);

    world.api.ecs.set(probe.entity, Label, { text: "mine" });
    world.api.projection.mute(probe.entity, Label, ["text"]);
    probe.onChange(view => view.toRest(Label, { ms: 100, ease: "linear" }));
    probe.commit(40, "two");
    world.frame(16);

    expect(world.api.ecs.get(probe.entity, Label)?.text).toBe("mine");
  });

  it("toRest hands back an inert handle for a component that has no rest pose", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);
    const Missing = component("Missing2", { value: 0 });
    const handles: MotionHandle[] = [];

    probe.onChange(view => {
      handles.push(view.toRest(Missing), view.tween(Missing, {}, { ms: 100 }));

      return handles[0];
    });
    probe.commit(40);
    world.frame(16);

    for (const handle of handles) {
      expect(handle.active()).toBe(false);
      expect(() => handle.finish()).not.toThrow();
      expect(() => handle.cancel()).not.toThrow();
    }

    expect(handles).toHaveLength(2);
  });

  it("tween with no easing and no delay eases out from now", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);

    probe.onChange(view => view.tween(Transform, { x: 100 }, { ms: 100 }));
    probe.commit(100);
    world.frame(50);

    const halfway = world.api.ecs.get(probe.entity, Transform)?.x ?? 0;

    expect(halfway).toBeGreaterThan(50);
    expect(halfway).toBeLessThan(100);
  });

  it("tween with an empty target and a zero duration is already done", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);
    const handles: MotionHandle[] = [];

    probe.onChange(view => {
      handles.push(view.tween(Transform, {}, { ms: 100 }));

      return view.tween(Transform, { x: 100 }, { ms: 0 });
    });
    probe.commit(100);
    world.frame(16);

    expect(handles[0]?.active()).toBe(false);
    expect(world.api.ecs.get(probe.entity, Transform)?.x).toBe(100);
  });

  it("tween keeps the target of a field the component does not carry", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);

    probe.onChange(view =>
      // A game can hand a loose object in: a field the component has no number for starts at its
      // own target, so the track writes that value and converges.
      view.tween(Transform, { ghost: 9, label: "wide", x: 60 } as unknown as { x: number }, {
        ms: 100,
        ease: "linear"
      })
    );
    probe.commit(60);
    world.frame(100);

    expect(world.api.ecs.get(probe.entity, Transform)?.x).toBe(60);
  });

  it("tween writes nothing while every field is owned by another writer", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);

    world.api.projection.mute(probe.entity, Transform, ["x"]);
    probe.onChange(view => view.tween(Transform, { x: 100 }, { ms: 100, ease: "linear" }));
    probe.commit(100);
    world.frame(50);

    expect(world.api.ecs.get(probe.entity, Transform)?.x).toBe(0);
  });

  it("all finishes, cancels and reports every motion it was given", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);
    const groups: MotionHandle[] = [];

    probe.onChange(view => {
      const group = view.all([
        view.tween(Transform, { x: 100 }, { ms: 400, ease: "linear" }),
        view.tween(Transform, { y: 40 }, { ms: 400, ease: "linear" }),
        undefined
      ]);

      groups.push(group);

      return group;
    });
    probe.commit(100);
    world.frame(16);

    expect(groups[0]?.active()).toBe(true);

    groups[0]?.finish();

    expect(groups[0]?.active()).toBe(false);
    expect(world.api.ecs.get(probe.entity, Transform)).toMatchObject({ x: 100, y: 40 });

    groups[0]?.cancel();
    expect(groups[0]?.active()).toBe(false);
  });

  it("writes every rest component and skips the tag when a paused view settles", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);

    world.api.ecs.set(probe.entity, Transform, { x: 77 });
    world.api.ecs.set(probe.entity, Label, { text: "stale", size: 40 });
    world.api.ecs.setMode("paused");
    world.api.projection.settle(probe.entity);

    expect(world.api.ecs.get(probe.entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
    expect(world.api.ecs.get(probe.entity, Label)).toEqual({ text: "one", size: 12 });
    expect(world.api.ecs.has(probe.entity, Glow)).toBe(true);
  });

  it("peer answers from the new state, then from the old one, then undefined", () => {
    const world = createMockWorld();
    const probe = mountProbe(world);
    const seen: Array<Item | undefined> = [];

    probe.onChange(view => {
      seen.push(view.peer("a") as Item | undefined, view.peer("ghost") as Item | undefined);
    });
    probe.commit(40, "two");
    world.frame(16);

    expect(seen[0]).toEqual({ id: "a", x: 40, text: "two" });
    expect(seen[1]).toBeUndefined();
  });

  it("writes the rest pose directly when a settle hook throws", () => {
    const world = createMockWorld();
    let settle: (() => Motion) | undefined;

    world.model.player = { items: [{ id: "a", x: 0, text: "one" }] };
    world.api.projection.setLayers([{ name: "items", sort: "y" }]);
    world.api.projection.register(
      projection({
        name: PROBE,
        layer: "items",
        from: (player: { items: Item[] }) => player.items,
        key: (item: Item) => item.id,
        view: (item: Item) => [Transform({ x: item.x, y: 0, scale: 1 }), Glow()],
        motion: { settle: () => settle?.() }
      }) as AnyProjectionSpec
    );
    world.start();
    world.api.projection.mount([PROBE], OWNER);

    const entity = world.api.projection.entityOf(PROBE, "a") ?? 0;

    settle = vi.fn(() => {
      throw new Error("boom");
    });
    world.api.ecs.set(entity, Transform, { x: 77 });
    world.api.projection.settle(entity);

    expect(world.log.error).toHaveBeenCalled();
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });

    settle = (): Motion => undefined;
    world.api.ecs.set(entity, Transform, { x: 55 });
    world.api.projection.settle(entity);

    expect(world.api.ecs.get(entity, Transform)?.x).toBe(55);
  });
});
