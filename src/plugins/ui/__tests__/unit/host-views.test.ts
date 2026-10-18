import { describe, expect, it, vi } from "vitest";
import { Parent } from "../../../renderer/components";
import type {
  AnyComponentType,
  AnyComponentValue,
  Entity,
  Api as WorldApi
} from "../../../world/types";
import { hostsMoved, hostViews, trackHost } from "../../jsx/hosts";
import { createJsxState } from "../../jsx/state";
import type { Element, JsxState } from "../../jsx/types";
import type { UiCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit: the full hosting step runs again only when a host or a projection's
// membership moved (change 2026-10-18-cheap-idle-tick, U1). An idle frame walks
// neither the hosted views nor the projections the hosts name.
// ---------------------------------------------------------------------------

/** The host element of every test. */
const HOST = 10;

/** The projection it hosts. */
const PIECES = "board.pieces";

/**
 * Builds a live host element that names one projection.
 *
 * @returns The element.
 */
function hostElement(): Element {
  return {
    entity: HOST,
    identity: "0|slot@0|stack",
    type: "stack",
    key: "slot",
    parentType: undefined,
    root: 1,
    node: { type: "stack", props: { hosts: [PIECES] }, children: [] },
    style: {},
    is: {
      pressed: false,
      hover: false,
      focus: false,
      disabled: false,
      active: false,
      selected: false,
      covered: false
    },
    rect: { x: 0, y: 0, w: 100, h: 100 },
    previous: { x: 0, y: 0, w: 0, h: 0 },
    moved: false,
    fit: 1,
    rest: { x: 0, y: 0, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } },
    handles: [],
    loop: undefined,
    motion: undefined,
    parent: undefined,
    children: [],
    instance: undefined,
    live: true,
    entered: true,
    dropKey: undefined,
    extras: new Map(),
    extraHandles: new Map(),
    warnedOwned: new Set(),
    warned: new Set(),
    index: 0,
    cause: "change",
    rebuilds: 0,
    scrolledIn: false
  };
}

/**
 * A world of maps: the parents of the views, the views of the hosted projection, and the
 * membership version the world counts.
 *
 * @returns The ui context, the jsx state, the views, their parents, the membership, and the two
 *   readers spied.
 */
function harness() {
  const parents = new Map<Entity, Entity>();
  // The membership version the world counts: a test moves it as the world would.
  const membership = { version: 0 };
  const views: Entity[] = [];
  const entitiesOf = vi.fn((name: string): readonly Entity[] => (name === PIECES ? views : []));
  const keyOf = vi.fn((view: Entity) =>
    views.includes(view) ? { projection: PIECES, key: String(view) } : undefined
  );
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
    projection: { entitiesOf, keyOf, membershipVersion: (): number => membership.version }
  } as unknown as WorldApi;
  const state: JsxState = createJsxState();
  const ctx = { deps: { world }, state: { jsx: state } } as unknown as UiCtx;

  state.elements.set(HOST, hostElement());
  trackHost(state, hostElement());

  return { ctx, state, views, parents, membership, entitiesOf, keyOf };
}

describe("hostViews", () => {
  it("walks nothing on a frame where no host and no view moved", () => {
    const h = harness();

    h.views.push(1, 2);
    hostViews(h.ctx, h.state);

    expect(h.parents.get(1)).toBe(HOST);

    h.entitiesOf.mockClear();
    h.keyOf.mockClear();
    hostViews(h.ctx, h.state);

    expect(h.entitiesOf).not.toHaveBeenCalled();
    expect(h.keyOf).not.toHaveBeenCalled();
  });

  it("hosts a view that came once the world's membership moved", () => {
    const h = harness();

    hostViews(h.ctx, h.state);
    h.views.push(3);
    hostViews(h.ctx, h.state);

    // The world has not counted the view yet: nothing is walked.
    expect(h.parents.has(3)).toBe(false);

    h.membership.version += 1;
    hostViews(h.ctx, h.state);

    expect(h.parents.get(3)).toBe(HOST);
  });

  it("walks again once a host moved, and hosts a view that lost its parent", () => {
    const h = harness();

    h.views.push(4);
    hostViews(h.ctx, h.state);
    h.parents.delete(4);
    hostViews(h.ctx, h.state);

    expect(h.parents.has(4)).toBe(false);

    hostsMoved(h.state);
    hostViews(h.ctx, h.state);

    expect(h.parents.get(4)).toBe(HOST);
  });

  it("releases a view once its host stops naming its projection", () => {
    const h = harness();

    h.views.push(5);
    hostViews(h.ctx, h.state);

    const renamed = hostElement();

    renamed.node = { type: "stack", props: { hosts: ["other"] }, children: [] };
    h.state.elements.set(HOST, renamed);
    trackHost(h.state, renamed);
    hostViews(h.ctx, h.state);

    expect(h.parents.has(5)).toBe(false);
    expect(h.state.hosted.has(5)).toBe(false);
  });
});
