/**
 * @file renderer — the fixture of the close perf test and bench (F195): a window's root with its children leaves among
 * many other views, as an album closes over the ward. Not a test file.
 */
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Parent, Sprite, Transform } from "../../components";
import { createMockRenderer } from "../mock-renderer";

const owner = { kind: "plugin", name: "perf" } as const;

/**
 * Starts a renderer with `others` views on stage and hands back one close of a window: a root, `panels` panels under
 * it and three leaves under each panel spawn and are drawn, then the whole window leaves in one pass, as a close
 * despawns it. Every root and panel is a parent with a host, so each one's leave detaches its children.
 *
 * @param others - Views of the scene under the window.
 * @param panels - Panels of the window, each with three leaves.
 * @returns The close, a call.
 */
export async function closingWindow(others: number, panels: number): Promise<() => void> {
  const mock = createMockRenderer();
  const ecs = mock.world.ecs;

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  for (let at = 0; at < others; at += 1) {
    ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);
  }

  mock.modules.sync.pass();

  const window: Entity[] = [];

  return () => {
    const root = ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    window.push(root);
    for (let at = 0; at < panels; at += 1) {
      const panel = ecs.spawn(owner, [Transform(), Sprite(), Parent({ entity: root })]);

      window.push(panel);
      for (let leaf = 0; leaf < 3; leaf += 1) {
        window.push(ecs.spawn(owner, [Transform(), Sprite(), Parent({ entity: panel })]));
      }
    }
    mock.modules.sync.pass();
    while (window.length > 0) {
      const entity = window.pop();

      if (entity !== undefined) ecs.despawn(entity);
    }
    mock.modules.sync.pass();
  };
}
