// Spike P4. Pure TypeScript, no Pixi, no Yoga. The keyed reconcile, the despawn queue, a tiny tween
// with the P5 retarget policy, the motion hooks and the Layout interface both adapters implement.

import { resolve, type FlatStyle, type Style, type Viewport } from "./styles";
import type { DescriptionNode, LocalPatch, StateFlags } from "./ui/node";

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { width: number; height: number };
export type Pose = { x: number; y: number; scale: number; alpha: number };
export type PoseField = keyof Pose;

export type Entity = {
  id: number;
  key: string;
  type: string;
  props: Record<string, unknown>;
  parent: number;
  children: number[];
  local: Record<string, unknown> | undefined;
  exiting: boolean;
  exitHandle: MotionHandle | undefined;
  flat: FlatStyle;
  /** Rect relative to the parent, as the adapter reported it. */
  rect: Rect;
  /** Rect in root coordinates, list scroll applied. */
  abs: Rect;
  hasRect: boolean;
  /** Whether the adapter still lays this entity out. False for an exiting entity under policy "leave". */
  inLayout: boolean;
  rest: Pose;
  pose: Pose;
  scroll: number;
  bornFrame: number;
};

export type MotionHandle = { finish(): void; cancel(): void; active(): boolean };
export type Motion = MotionHandle | undefined;

export type ViewHandle = {
  readonly rest: Readonly<Pose>;
  readonly pose: Readonly<Pose>;
  set(partial: Partial<Pose>): void;
  tween(target: Partial<Pose>, ms: number): MotionHandle;
  toRest(fields?: readonly PoseField[], options?: { ms?: number }): MotionHandle;
};

export type Hooks = {
  enter(view: ViewHandle, props: Record<string, unknown>): Motion;
  exit(view: ViewHandle, props: Record<string, unknown>): Motion;
  change: Partial<Record<"Rect", (view: ViewHandle, prev: Rect, next: Rect) => Motion>>;
  settle(view: ViewHandle, fields: readonly PoseField[]): Motion;
};

export type MeasureFn = (content: string, style: FlatStyle) => Size;

/** What a layout adapter implements. Rects are relative to the parent. */
export interface Layout {
  readonly name: "A" | "B";
  readonly initMs: number;
  attach(entity: Entity): void;
  detach(entity: Entity): void;
  /** Re-parents the children of `parent` in this order. Called only when the order changed. */
  place(parent: Entity, children: readonly Entity[]): void;
  style(entity: Entity, flat: FlatStyle): void;
  measure(entity: Entity, fn: (() => Size) | null): void;
  /** The measured content changed: the node must be measured again at the next solve. */
  invalidate(entity: Entity): void;
  solve(root: Entity, viewport: Viewport): Map<number, Rect>;
  /** Live layout nodes. `undefined` when the engine gives no count. */
  nodeCount(): number | undefined;
  /** Calls of the measure function by the engine. */
  readonly measureCalls: number;
}

export type Intent = { name: string; payload: Record<string, unknown> | undefined };
export type LocalReader = <T>(key: string, initial: T) => T;
export type Screen = (local: LocalReader, viewport: Viewport) => DescriptionNode;
export type ExitFlow = "leave" | "stay";

export type Stats = {
  frame: number;
  reconciles: number;
  solves: number;
  solveMs: number[];
  lastSolveMs: number;
  intents: number;
  localWrites: number;
  unlaidFrames: number;
  earlyDespawns: number;
  despawned: number;
  entered: number;
  exited: number;
  scrolls: number;
};

type Tween = { field: PoseField; from: number; to: number; elapsed: number; duration: number; owner: number };

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const ROOT_ID = 1;
const POSE_FIELDS: readonly PoseField[] = ["x", "y", "scale", "alpha"];

const sameFlat = (a: FlatStyle, b: FlatStyle): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof FlatStyle>;
  for (const key of keys) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  return true;
};
const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Default motions: enter grows in, exit shrinks out, a rect change slides. */
export const defaultHooks: Hooks = {
  enter: view => {
    view.set({ scale: 0.6, alpha: 0 });
    return view.toRest(["scale", "alpha"], { ms: 250 });
  },
  exit: view => view.tween({ scale: 0.8, alpha: 0 }, 300),
  change: { Rect: view => view.toRest(["x", "y"], { ms: 200 }) },
  settle: (view, fields) => view.toRest(fields, { ms: 120 })
};

export type Core = ReturnType<typeof createCore>;

export function createCore(options: { layout: Layout; hooks?: Hooks; gate: (intent: Intent) => void; exitFlow?: ExitFlow; measure: MeasureFn }) {
  const { layout, gate, measure } = options;
  const hooks = options.hooks ?? defaultHooks;
  const exitFlow: ExitFlow = options.exitFlow ?? "leave";

  const entities = new Map<number, Entity>();
  const tweens = new Map<number, Tween[]>();
  const measured = new Map<number, string>();
  /** The children each parent currently has in the layout, in order. Placed once per reconcile. */
  const placed = new Map<number, number[]>();
  /** Boxes that declare `local`, by key. Keys of such boxes are unique in the spike. */
  const localOwners = new Map<string, Entity>();
  let nextId = ROOT_ID;
  let nextOwner = 1;
  let screen: Screen | undefined;
  let viewport: Viewport = { width: 1080, height: 1920, landscape: false };
  let treeDirty = false;
  let layoutDirty = false;
  const stats: Stats = { frame: 0, reconciles: 0, solves: 0, solveMs: [], lastSolveMs: 0, intents: 0, localWrites: 0, unlaidFrames: 0, earlyDespawns: 0, despawned: 0, entered: 0, exited: 0, scrolls: 0 };

  const zero = (): Rect => ({ x: 0, y: 0, w: 0, h: 0 });
  const createEntity = (type: string, key: string, parent: number, props: Record<string, unknown>): Entity => {
    const entity: Entity = {
      id: nextId++, key, type, props, parent, children: [], local: undefined, exiting: false, exitHandle: undefined,
      flat: {}, rect: zero(), abs: zero(), hasRect: false, inLayout: true,
      rest: { x: 0, y: 0, scale: 1, alpha: 1 }, pose: { x: 0, y: 0, scale: 1, alpha: 1 }, scroll: 0, bornFrame: stats.frame
    };
    entities.set(entity.id, entity);
    layout.attach(entity);
    return entity;
  };

  const root = createEntity("root", "root", 0, { style: {} });
  root.hasRect = true;

  // ---- tweens and views

  const tweensOf = (id: number): Tween[] => {
    let list = tweens.get(id);
    if (!list) {
      list = [];
      tweens.set(id, list);
    }
    return list;
  };

  const startTween = (entity: Entity, field: PoseField, to: number, ms: number, owner: number): void => {
    const list = tweensOf(entity.id);
    const index = list.findIndex(t => t.field === field);
    // Retarget (P5 policy B): the running motion is cancelled, the new one starts from the current value.
    if (index >= 0) list.splice(index, 1);
    if (ms <= 0) {
      entity.pose[field] = to;
      return;
    }
    list.push({ field, from: entity.pose[field], to, elapsed: 0, duration: ms, owner });
  };

  const handleFor = (entity: Entity, owner: number): MotionHandle => ({
    active: () => tweensOf(entity.id).some(t => t.owner === owner),
    finish: () => {
      const list = tweensOf(entity.id);
      for (const t of list.filter(t => t.owner === owner)) {
        entity.pose[t.field] = t.to;
        list.splice(list.indexOf(t), 1);
      }
    },
    cancel: () => {
      const list = tweensOf(entity.id);
      for (const t of list.filter(t => t.owner === owner)) list.splice(list.indexOf(t), 1);
    }
  });

  const viewOf = (entity: Entity): ViewHandle => ({
    rest: entity.rest,
    pose: entity.pose,
    set: partial => Object.assign(entity.pose, partial),
    tween: (target, ms) => {
      const owner = nextOwner++;
      for (const field of POSE_FIELDS) {
        const value = target[field];
        if (value !== undefined) startTween(entity, field, value, ms, owner);
      }
      return handleFor(entity, owner);
    },
    toRest: (fields = POSE_FIELDS, opts = {}) => {
      const owner = nextOwner++;
      for (const field of fields) startTween(entity, field, entity.rest[field], opts.ms ?? 200, owner);
      return handleFor(entity, owner);
    }
  });

  const tick = (dt: number): void => {
    for (const [id, list] of tweens) {
      const entity = entities.get(id);
      if (!entity) {
        tweens.delete(id);
        continue;
      }
      for (let index = list.length - 1; index >= 0; index--) {
        const t = list[index] as Tween;
        t.elapsed += dt;
        const progress = Math.min(1, t.elapsed / t.duration);
        entity.pose[t.field] = t.from + (t.to - t.from) * easeOutCubic(progress);
        if (progress >= 1) {
          entity.pose[t.field] = t.to;
          list.splice(index, 1);
        }
      }
    }
  };

  // ---- reconcile

  const flagsOf = (props: Record<string, unknown>): Partial<Record<"active" | "disabled" | "selected", boolean>> => {
    const state = props.state as StateFlags | undefined;
    return { active: state?.active ?? false, disabled: state?.disabled ?? false, selected: state?.selected ?? false };
  };

  const applyStyle = (entity: Entity): void => {
    const style = (entity.props.style ?? {}) as Style;
    const flat = resolve(style, flagsOf(entity.props), viewport);
    if (sameFlat(flat, entity.flat) && entity.hasRect) return;
    entity.flat = flat;
    layout.style(entity, flat);
    layoutDirty = true;
  };

  const applyMeasure = (entity: Entity): void => {
    if (entity.type !== "text") return;
    const content = String(entity.props.content ?? "");
    const intrinsic = entity.flat.width === undefined || entity.flat.width === "auto";
    const signature = intrinsic ? `${content}|${JSON.stringify(entity.flat)}` : "";
    const previous = measured.get(entity.id);
    if (previous === signature) return;
    measured.set(entity.id, signature);
    if (!intrinsic) {
      if (previous !== undefined && previous !== "") layout.measure(entity, null);
      return;
    }
    if (previous === undefined || previous === "") layout.measure(entity, () => measure(content, entity.flat));
    else {
      layout.measure(entity, () => measure(content, entity.flat));
      layout.invalidate(entity);
    }
    layoutDirty = true;
  };

  const startExit = (entity: Entity): void => {
    entity.exiting = true;
    stats.exited++;
    // Under "leave" the exiting entity keeps its last rect and leaves the flow; the parent is re-placed
    // once at the end of its reconcile, not per exit.
    if (exitFlow === "leave") entity.inLayout = false;
    entity.exitHandle = hooks.exit(viewOf(entity), entity.props);
  };

  const reconcileChildren = (parent: Entity, nodes: readonly DescriptionNode[]): void => {
    const previous = parent.children.map(id => entities.get(id) as Entity);
    const byKey = new Map<string, Entity>();
    for (const entity of previous) if (!entity.exiting) byKey.set(entity.key, entity);

    const live: Entity[] = [];
    nodes.forEach((node, index) => {
      const key = node.key ?? `${node.type}@${index}`;
      const existing = byKey.get(key);
      byKey.delete(key);
      let entity: Entity;
      if (existing && existing.type === node.type) {
        entity = existing;
        entity.props = node.props;
      } else {
        if (existing) startExit(existing);
        entity = createEntity(node.type, key, parent.id, node.props);
        if (node.props.local !== undefined && node.type === "box") {
          entity.local = { ...(node.props.local as LocalPatch) };
          localOwners.set(key, entity);
        }
        stats.entered++;
      }
      live.push(entity);
      applyStyle(entity);
      applyMeasure(entity);
      reconcileChildren(entity, node.children);
    });
    for (const gone of byKey.values()) startExit(gone);

    // Order: live entities in tree order; exiting ones keep their old index where possible.
    const exiting = previous.filter(e => e.exiting);
    const next = [...live];
    for (const entity of exiting) next.splice(Math.min(previous.indexOf(entity), next.length), 0, entity);
    parent.children = next.map(e => e.id);
    placeChildren(parent);
  };

  /** Re-places the in-layout children of `parent` when that list changed. */
  const placeChildren = (parent: Entity): void => {
    const inLayout = parent.children.map(id => entities.get(id) as Entity).filter(e => e.inLayout);
    const ids = inLayout.map(e => e.id);
    const before = placed.get(parent.id);
    const same = before !== undefined && before.length === ids.length && before.every((id, i) => id === ids[i]);
    if (same) return;
    placed.set(parent.id, ids);
    layout.place(parent, inLayout);
    layoutDirty = true;
  };

  const localReader: LocalReader = (key, initial) => {
    const owner = localOwners.get(key);
    return owner?.local !== undefined && !owner.exiting ? (owner.local as typeof initial) : initial;
  };

  const reconcile = (): void => {
    if (!screen) return;
    const tree = screen(localReader, viewport);
    root.props = { style: { width: viewport.width, height: viewport.height } };
    applyStyle(root);
    reconcileChildren(root, tree.type === "fragment" ? tree.children : [tree]);
    stats.reconciles++;
  };

  // ---- solve and poses

  const walk = (entity: Entity, visit: (e: Entity, parent: Entity | undefined) => void, parent?: Entity): void => {
    visit(entity, parent);
    for (const id of entity.children) {
      const child = entities.get(id);
      if (child) walk(child, visit, entity);
    }
  };

  const placeAbs = (entity: Entity, parent: Entity | undefined): void => {
    const scrollsX = parent?.type === "list" && parent.flat.direction === "row";
    const scrollsY = parent?.type === "list" && !scrollsX;
    const px = parent ? parent.abs.x - (scrollsX ? parent.scroll : 0) : 0;
    const py = parent ? parent.abs.y - (scrollsY ? parent.scroll : 0) : 0;
    entity.abs = { x: px + entity.rect.x, y: py + entity.rect.y, w: entity.rect.w, h: entity.rect.h };
  };

  const solve = (): void => {
    const t0 = performance.now();
    const rects = layout.solve(root, viewport);
    const ms = performance.now() - t0;
    stats.solves++;
    stats.solveMs.push(ms);
    stats.lastSolveMs = ms;

    walk(root, (entity, parent) => {
      const rect = rects.get(entity.id);
      if (rect && entity.inLayout) entity.rect = rect;
      const before = entity.abs;
      placeAbs(entity, parent);
      if (entity === root) return;
      const fresh = !entity.hasRect;
      entity.hasRect = entity.hasRect || rect !== undefined;
      const next: Pose = { x: entity.abs.x, y: entity.abs.y, scale: 1, alpha: 1 };
      if (fresh) {
        entity.rest = next;
        entity.pose = { ...next };
        const motion = hooks.enter(viewOf(entity), entity.props);
        if (motion === undefined) Object.assign(entity.pose, entity.rest);
      } else if (!sameRect(before, entity.abs) && !entity.exiting) {
        entity.rest = next;
        const change = hooks.change.Rect;
        const motion = change ? change(viewOf(entity), before, entity.abs) : undefined;
        if (motion === undefined) hooks.settle(viewOf(entity), ["x", "y"]);
      }
    });
  };

  const despawn = (): void => {
    const touched = new Set<Entity>();
    for (const entity of [...entities.values()]) {
      if (!entity.exiting || entity.parent === 0) continue;
      const handle = entity.exitHandle;
      if (handle?.active()) continue;
      const parent = entities.get(entity.parent);
      if (parent) parent.children = parent.children.filter(id => id !== entity.id);
      walk(entity, e => {
        layout.detach(e);
        entities.delete(e.id);
        tweens.delete(e.id);
        measured.delete(e.id);
        placed.delete(e.id);
        if (localOwners.get(e.key) === e) localOwners.delete(e.key);
        stats.despawned++;
      });
      if (parent) touched.add(parent);
    }
    for (const parent of touched) if (entities.has(parent.id)) placeChildren(parent);
  };

  const countUnlaid = (): void => {
    let missing = 0;
    walk(root, entity => {
      if (entity === root) return;
      if (!entity.hasRect || (entity.abs.w === 0 && entity.abs.h === 0 && entity.type !== "list")) missing++;
    });
    if (missing > 0) stats.unlaidFrames++;
  };

  // ---- draw order and hit test

  const drawOrder = (): Entity[] => {
    const out: Entity[] = [];
    walk(root, entity => {
      if (entity !== root) out.push(entity);
    });
    return out;
  };

  const contains = (rect: Rect, x: number, y: number): boolean => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;

  const nearestLocal = (entity: Entity): Entity | undefined => {
    let cursor: Entity | undefined = entities.get(entity.parent);
    while (cursor) {
      if (cursor.local !== undefined) return cursor;
      cursor = entities.get(cursor.parent);
    }
    return undefined;
  };

  return {
    stats,
    root,
    viewportNow: () => viewport,
    entities: (): Entity[] => [...entities.values()].filter(e => e !== root),
    get: (id: number): Entity | undefined => entities.get(id),
    drawOrder,
    byKey: (key: string): Entity | undefined => [...entities.values()].find(e => e.key === key && !e.exiting),
    localReader,

    render(nextScreen: Screen, nextViewport: Viewport): void {
      screen = nextScreen;
      viewport = nextViewport;
      treeDirty = true;
    },
    viewport(next: Viewport): void {
      viewport = next;
      treeDirty = true;
    },
    tap(x: number, y: number): boolean {
      const hit = drawOrder().filter(e => e.type === "button" && !e.exiting && contains(e.abs, x, y)).at(-1);
      if (!hit) return false;
      const flags = flagsOf(hit.props);
      if (flags.disabled) return false;
      if (typeof hit.props.intent === "string") {
        gate({ name: hit.props.intent, payload: hit.props.payload as Record<string, unknown> | undefined });
        stats.intents++;
      }
      if (hit.props.local !== undefined) {
        const owner = nearestLocal(hit);
        if (owner?.local) {
          Object.assign(owner.local, hit.props.local as LocalPatch);
          stats.localWrites++;
          treeDirty = true;
        }
      }
      return true;
    },
    scroll(listKey: string, offsetPx: number): void {
      const list = [...entities.values()].find(e => e.key === listKey && e.type === "list");
      if (!list) return;
      list.scroll = offsetPx;
      stats.scrolls++;
      walk(list, (entity, parent) => {
        if (entity === list) return;
        placeAbs(entity, parent);
        // A scroll moves the rest pose without a motion: the content follows the finger.
        const dx = entity.abs.x - entity.rest.x;
        const dy = entity.abs.y - entity.rest.y;
        entity.rest.x = entity.abs.x;
        entity.rest.y = entity.abs.y;
        entity.pose.x += dx;
        entity.pose.y += dy;
      });
    },
    advance(dtMs: number): void {
      stats.frame++;
      if (treeDirty) {
        treeDirty = false;
        reconcile();
      }
      if (layoutDirty) {
        layoutDirty = false;
        solve();
      }
      tick(dtMs);
      despawn();
      if (layoutDirty) {
        // A despawn under policy "stay" reflows the siblings in the same frame.
        layoutDirty = false;
        solve();
      }
      countUnlaid();
    },
    isSettled(): boolean {
      for (const list of tweens.values()) if (list.length > 0) return false;
      return ![...entities.values()].some(e => e.exiting);
    }
  };
}
