import { describe, expect, it } from "vitest";
import { component } from "../../ecs/define";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec, MotionHandle } from "../../projection/types";
import type { Item, Player } from "./board";
import {
  BOARD,
  commitItems,
  expectConverged,
  LAYERS,
  Level,
  MOUNT_OWNER,
  mountBoard,
  restOfName,
  settleFrames,
  storedOf,
  Transform
} from "./board";
import { createMockWorld } from "./mock-world";

describe("projection motions — the spike cases", () => {
  it("retarget: a second move cancels the running motion and starts from the current values", () => {
    const world = createMockWorld();
    const starts: number[] = [];
    const handles: MotionHandle[] = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => {
          starts.push(view.get(Transform)?.x ?? -1);

          const handle = view.toRest(Transform, { ms: 350, ease: "linear" });

          handles.push(handle);

          return handle;
        }
      }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);
    world.frame(16);
    world.frame(100);

    const midway = world.api.ecs.get(entity, Transform)?.x ?? -1;

    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(100);

    commitItems(world, [{ id: "a", level: 1, x: 200, y: 0 }]);
    world.frame(16);

    expect(starts[1]).toBe(midway);
    expect(handles[0]?.active()).toBe(false);

    settleFrames(world);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 200, y: 0, scale: 1 });
    expectConverged(world, "a");
  });

  it("retarget: a component the new hooks do not drive is brought home by settle", () => {
    const world = createMockWorld();
    const settled: string[][] = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Level: view => {
          view.set(Transform, { scale: 1.4 });

          return view.toRest(Level, { ms: 50, ease: "linear" });
        }
      },
      settle: (view, components) => {
        settled.push([...components]);

        return view.all(components.map(name => restOfName(view, name)));
      }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame(16);

    expect(settled.at(-1)).toEqual(["Transform"]);

    settleFrames(world);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
    expectConverged(world, "a");
  });

  it("settle: a drop with no commit sends the view home", () => {
    const world = createMockWorld();
    const settled: string[][] = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      settle: (view, components) => {
        settled.push([...components]);

        return view.toRest(Transform, { ms: 200, ease: "linear" });
      }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.ecs.set(entity, Transform, { x: 77, y: 33 });
    world.api.projection.settle(entity);

    expect(settled).toEqual([["Transform"]]);

    settleFrames(world);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
    expectConverged(world, "a");
  });

  it("settle: the built-in default brings every loose component home", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.ecs.set(entity, Transform, { x: 77 });
    world.api.projection.settle(entity);
    settleFrames(world);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
    expectConverged(world, "a");
  });

  it("settle: a paused world writes the rest pose at once", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.ecs.setMode("paused");
    world.api.ecs.set(entity, Transform, { x: 77 });
    world.api.projection.settle(entity);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("settle: a paused world keeps a view the finger still holds lifted", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    world.api.ecs.setMode("paused");
    world.api.ecs.set(entity, Transform, { x: 77 });
    world.api.projection.settle(entity);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("settle: a paused world applies a lift(false) that was waiting for the last motion", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.toRest(Transform, { ms: 400 }) }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame(16);
    world.api.projection.lift(entity, false);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    world.api.ecs.setMode("paused");
    world.api.projection.settle(entity);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
  });

  it("settle: an entity that is not a live view is a no-op", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    expect(() => world.api.projection.settle(999)).not.toThrow();
  });

  it("exit target gone: peer answers from the old state and never with an entity", () => {
    const world = createMockWorld();
    const targets: Array<number | undefined> = [];

    mountBoard(
      world,
      [
        { id: "a", level: 1, x: 0, y: 0 },
        { id: "b", level: 1, x: 80, y: 0 }
      ],
      {
        exit: (view, _item, hint) => {
          const into = (hint?.payload as { into?: string } | undefined)?.into ?? "";
          const peer = view.peer(into) as Item | undefined;

          targets.push(peer?.x);

          return view.tween(Transform, { x: peer?.x ?? 0 }, { ms: 100, ease: "linear" });
        }
      }
    );

    world.release({ kind: "merged", payload: { from: "b", into: "ghost" }, hint: true });
    world.release({ kind: "merged", payload: { from: "a", into: "b" }, hint: true });
    commitItems(world, []);
    world.frame(16);

    expect(targets).toEqual([80, undefined]);

    settleFrames(world);

    expect(
      world.api.projection.keyOf(world.api.projection.entityOf(BOARD, "a") ?? 0)
    ).toBeUndefined();
  });

  it("lost hint: an entry without a hint plays the default motion and still converges", () => {
    const world = createMockWorld();
    const hints: Array<string | undefined> = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: (view, _previous, _next, hint) => {
          hints.push(hint?.kind);

          return view.toRest(Transform, { ms: 100, ease: "linear" });
        }
      }
    });

    commitItems(world, [{ id: "a", level: 1, x: 120, y: 0 }]);
    settleFrames(world);

    expect(hints).toEqual([undefined]);
    expect(world.api.ecs.get(world.api.projection.entityOf(BOARD, "a") ?? 0, Transform)).toEqual({
      x: 120,
      y: 0,
      scale: 1
    });
    expectConverged(world, "a");
  });

  it("logs a throwing hook and writes the diff directly instead", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: () => {
          throw new Error("boom");
        }
      }
    });

    commitItems(world, [{ id: "a", level: 1, x: 42, y: 0 }]);
    world.frame(16);

    expect(world.log.error).toHaveBeenCalled();
    expect(world.api.ecs.get(world.api.projection.entityOf(BOARD, "a") ?? 0, Transform)).toEqual({
      x: 42,
      y: 0,
      scale: 1
    });
    expectConverged(world, "a");
  });

  it("corrects a view whose rest pose was never reached and warns", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Level: view => view.tween(Level, { level: 5 }, { ms: 50, ease: "linear" }) }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    settleFrames(world);

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 2 });
    expect(world.log.warn).toHaveBeenCalledWith(
      "world:view-corrected",
      expect.objectContaining({ projection: BOARD, key: "a", component: "Level" })
    );
  });

  it("leaves a field another plugin owns when a view comes to rest or changes", () => {
    const world = createMockWorld();
    // `shown` is written by the plugin that draws the caption, never by a view.
    const Caption = component("Caption", { text: "", shown: "" }, { owned: ["shown"] });

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] } as unknown as Player &
      Record<string, never>;
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(
      projection({
        name: "captions",
        layer: "board",
        from: (player: Player) => player.items,
        key: (item: Item) => item.id,
        view: (item: Item) => [Caption({ text: String(item.level) }), Level({ level: item.level })],
        motion: {
          change: { Level: view => view.tween(Level, { level: 5 }, { ms: 50, ease: "linear" }) }
        }
      }) as AnyProjectionSpec
    );
    world.start();
    world.api.projection.mount(["captions"], MOUNT_OWNER);

    const entity = world.api.projection.entityOf("captions", "a") ?? 0;

    world.api.ecs.set(entity, Caption, { shown: "one" });
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    settleFrames(world);

    expect(world.api.ecs.get(entity, Caption)).toEqual({ text: "2", shown: "one" });
    expect(world.log.warn).not.toHaveBeenCalledWith(
      "world:view-corrected",
      expect.objectContaining({ component: "Caption" })
    );
  });
});
