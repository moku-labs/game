import { describe, expect, it } from "vitest";
import { Parent } from "../../../renderer/components";
import type {
  AnyComponentType,
  AnyComponentValue,
  Entity,
  Api as WorldApi
} from "../../../world/types";
import { hostViews, trackHost } from "../../jsx/hosts";
import { createJsxState } from "../../jsx/state";
import type { Element, JsxState } from "../../jsx/types";
import type { UiCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit: a view is hung under the live host that names its projection, not under
// whichever host the set holds first (change 2026-11-24-f230-hot-path, U3: the
// walk over the host set is a callback made once, which reads the name it is
// asked about from the walk).
// ---------------------------------------------------------------------------

/** The host of the pieces and the host of the strip, in the order the set holds them. */
const PIECES_HOST = 10;
const STRIP_HOST = 11;

/** The projections they host, and the views of each. */
const PIECES = "board.pieces";
const STRIP = "board.strip";
const VIEWS: Readonly<Record<string, readonly Entity[]>> = { [PIECES]: [1, 2], [STRIP]: [3] };

/**
 * A live host element that names one projection.
 *
 * @param entity - The host's entity.
 * @param hosts - The projection it names.
 * @returns The element.
 */
function hostElement(entity: Entity, hosts: string): Element {
  return {
    entity,
    identity: `0|slot${entity}@0|stack`,
    type: "stack",
    key: `slot${entity}`,
    parentType: undefined,
    root: 1,
    node: { type: "stack", props: { hosts: [hosts] }, children: [] },
    style: {},
    rect: { x: 0, y: 0, w: 100, h: 100 },
    children: [],
    live: true,
    entered: true
  } as unknown as Element;
}

/**
 * A world of maps with two projections and the two hosts that name them, one each.
 *
 * @returns The ui context, the jsx state and the parents of the views.
 */
function harness(): { ctx: UiCtx; state: JsxState; parents: Map<Entity, Entity> } {
  const parents = new Map<Entity, Entity>();
  const world = {
    ecs: {
      has: (entity: Entity, type: AnyComponentType): boolean =>
        type === Parent && parents.has(entity),
      get: (entity: Entity) => {
        const parent = parents.get(entity);

        return parent === undefined ? undefined : { entity: parent };
      },
      add: (entity: Entity, value: AnyComponentValue): void => {
        parents.set(entity, (value.value as { entity: Entity }).entity);
      },
      remove: (entity: Entity): void => {
        parents.delete(entity);
      }
    },
    projection: {
      entitiesOf: (name: string): readonly Entity[] => VIEWS[name] ?? [],
      keyOf: (view: Entity) => {
        const name = Object.keys(VIEWS).find(each => VIEWS[each]?.includes(view));

        return name === undefined ? undefined : { projection: name, key: String(view) };
      },
      membershipVersion: (): number => 0,
      isBuilding: (): boolean => false
    }
  } as unknown as WorldApi;
  const state = createJsxState();
  const ctx = { deps: { world }, state: { jsx: state } } as unknown as UiCtx;

  for (const [entity, hosts] of [
    [PIECES_HOST, PIECES],
    [STRIP_HOST, STRIP]
  ] as const) {
    const element = hostElement(entity, hosts);

    state.elements.set(entity, element);
    trackHost(state, element);
  }

  return { ctx, state, parents };
}

describe("hostViews with two hosts", () => {
  it("hangs the views of each projection under the host that names it", () => {
    // Bug caught: the walk over the host set takes the first live host whatever the projection,
    // so the strip's view hangs under the pieces' host and the strip's host hosts nothing.
    const h = harness();

    hostViews(h.ctx, h.state);

    expect([h.parents.get(1), h.parents.get(2), h.parents.get(3)]).toEqual([
      PIECES_HOST,
      PIECES_HOST,
      STRIP_HOST
    ]);
  });
});
