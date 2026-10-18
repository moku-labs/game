import { describe, expect, it, vi } from "vitest";
import { createApp, defineGame, projection, Sprite, Transform, type } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { Parent } from "../../../renderer/components";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import { Tree } from "../../../world/ecs/define";
import { uiPlugin } from "../../index";
import type { DescriptionNode } from "../../jsx/types";

// ---------------------------------------------------------------------------
// Integration: the hosting step runs only when a host or a projection's
// membership moved (change 2026-10-18-cheap-idle-tick, U1). A host that a
// remount drops is such a move, also when it is a root element with no child
// and no parent, whose despawn no `Parent` removal announces.
// ---------------------------------------------------------------------------

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** One view of the hosted projection. */
type Token = { id: string };

/** Two sprites, hosted by the lone root while it names them. */
const pawns = projection({
  name: "pawns",
  layer: "board",
  from: (): Token[] => [{ id: "a" }, { id: "b" }],
  key: (item: Token) => item.id,
  view: () => [Sprite({ texture: "ui.coin" }), Transform({ x: 0, y: 0 })]
});

/** A screen that is one element: the host itself, with no child. */
const lone = projection({
  name: "lone",
  layer: "ui",
  from: (): Token => ({ id: "lone" }),
  view: () => <stack key="loneHost" hosts={["pawns"]} style={{ width: 300, height: 300 }} />
});

const home = defineNode({ rest: true, outcomes: { go: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { go: "home" } }
});

const loneFeature = defineFeature("lone", { flows: [main], projections: [pawns, lone] });

describe("a host a remount drops", () => {
  it("gives its views their layer back, when the rebuilt root hosts nothing", async () => {
    const app = createApp({
      plugins: [
        worldPlugin,
        rendererPlugin,
        inputPlugin,
        assetsPlugin,
        scenesPlugin,
        animPlugin,
        i18nPlugin,
        textPlugin,
        uiPlugin,
        loneFeature
      ],
      pluginConfigs: {
        flow: { mainFlow: main },
        i18n: { locale: "en", fallback: "en" },
        model: { initialPlayer: {}, initialSession: {}, seed: 1 }
      }
    });
    const listeners: Array<() => void> = [];
    const onConverged = app.world.projection.onConverged;

    // The listener ui opens: what the world calls after a restore or a load.
    vi.spyOn(app.world.projection, "onConverged").mockImplementation(listener => {
      listeners.push(listener);

      return onConverged(listener);
    });
    await app.start();
    vi.restoreAllMocks();
    app.world.projection.setLayers([
      { name: "board", sort: "order" },
      { name: "ui", sort: "order" }
    ]);
    app.world.projection.mount(["pawns", "lone"], { kind: "plugin", name: "test" });
    app.time.step(16);
    app.time.step(16);

    const host = app.ui.find("loneHost");
    const views = app.world.projection.entitiesOf("pawns");
    const parents = (): Array<number | undefined> =>
      views.map(view => app.world.ecs.get(view, Parent)?.entity);

    expect(parents()).toEqual([host, host]);

    // A restore converged, and the screen it brings back names no projection.
    const root = app.world.projection.entityOf("lone", "lone") ?? -1;
    const bare: DescriptionNode = {
      type: "stack",
      key: "loneHost",
      props: { style: { width: 300, height: 300 } },
      children: []
    };

    for (const listener of listeners) listener();
    app.world.ecs.set(root, Tree, { node: bare });
    app.time.step(16);
    app.time.step(16);

    expect(app.ui.find("loneHost")).not.toBe(host);
    expect(parents()).toEqual([undefined, undefined]);

    await app.stop();
  });
});
