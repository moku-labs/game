// Spike P5. Pure TypeScript, no Pixi. Tween + keyed reconcile + despawn queue + three overlap policies.
// Thrown away after RESULT.md. Units: reference px, short side 1080, cell 180.

export type Policy = "A" | "B" | "C";
export type Cause = "edge" | "rollback" | "restore" | "load";
export type EasingSet = "spec" | "linear";
export type Item = { id: string; kind: "item" | "gen"; cell: number; level: number };
export type Hint = { kind: string; payload?: Record<string, unknown>; hint: true };
export type Field = "x" | "y" | "scale" | "alpha";

export const CELL = 180;
export const SIDE = 5;
export const ORIGIN = 90;
export const DURATION = 350;
const FIELDS: Field[] = ["x", "y", "scale", "alpha"];

export const cellCenter = (cell: number) => ({
  x: ORIGIN + (cell % SIDE) * CELL + CELL / 2,
  y: ORIGIN + Math.floor(cell / SIDE) * CELL + CELL / 2
});

type Track = { field: Field; at: (p: number) => number; to: number };
type Motion = { name: string; tracks: Track[]; elapsed: number };
type Batch = { name: string; fields: Field[]; level?: number; start: (view: View) => Motion[] };

export type View = {
  key: string;
  item: Item;
  x: number;
  y: number;
  scale: number;
  alpha: number;
  level: number;
  held: boolean;
  exiting: boolean;
  running: Motion[];
  queue: Batch[];
  bornFrame: number;
  speed?: { x: number; y: number };
};

const outCubic = (p: number) => 1 - (1 - p) ** 3;
const inCubic = (p: number) => p ** 3;
const outBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
const linear = (p: number) => p;

export type Stats = {
  maxJumpPx: number;
  maxScaleJump: number;
  snapCount: number;
  overlapCount: number;
  cutMotions: number;
  crossFieldFinishes: number;
  maxSpeedJump: number;
  speedJumps: number[];
  lagSamples: number[];
  /** From the LAST commit that touched the key to convergence. */
  lagFromLastSamples: number[];
  queueDepthMax: { despawn: number; motion: number };
  /** Which finished motion made the jumps of policy A: count above the snap threshold and the largest jump. */
  jumpsByMotion: Record<string, { finished: number; snaps: number; maxPx: number; maxScale: number }>;
};

export function createCore(policy: Policy, easing: EasingSet) {
  const ease = (fn: (p: number) => number) => (easing === "linear" ? linear : fn);
  const live = new Map<string, View>();
  const exiting: View[] = [];
  const pendingEnter = new Map<string, Hint | undefined>(); // policy C: a key that returns while its old view still exits
  const lagOpen = new Map<string, number>();
  const lastTouch = new Map<string, number>();
  const forced = new Map<View, { x: number; y: number; scale: number }>();
  let projected = new Map<string, Item>();
  let pending: { items: Item[]; cause: Cause } | undefined;
  let hints: Hint[] = [];
  let now = 0;
  let frame = 0;
  let lastReconcileAt = 0;

  const stats: Stats = {
    maxJumpPx: 0,
    maxScaleJump: 0,
    snapCount: 0,
    overlapCount: 0,
    cutMotions: 0,
    crossFieldFinishes: 0,
    maxSpeedJump: 0,
    speedJumps: [],
    lagSamples: [],
    lagFromLastSamples: [],
    queueDepthMax: { despawn: 0, motion: 0 },
    jumpsByMotion: {}
  };

  // ---- motions: every track starts from the CURRENT value of the view ----
  const track = (view: View, field: Field, to: number, fn: (p: number) => number): Track => {
    const from = view[field];
    return { field, to, at: p => from + (to - from) * fn(p) };
  };
  const motions = {
    slide: (view: View, to: { x: number; y: number }): Motion => ({
      name: "slide",
      elapsed: 0,
      tracks: [track(view, "x", to.x, ease(outCubic)), track(view, "y", to.y, ease(outCubic))]
    }),
    enterArc: (view: View, to: { x: number; y: number }): Motion => {
      const fromY = view.y;
      const e = ease(outCubic);
      return {
        name: "enterArc",
        elapsed: 0,
        tracks: [
          track(view, "x", to.x, e),
          { field: "y", to: to.y, at: p => fromY + (to.y - fromY) * e(p) - 90 * 4 * e(p) * (1 - e(p)) },
          track(view, "scale", 1, e)
        ]
      };
    },
    exitInto: (view: View, to: { x: number; y: number }): Motion => ({
      name: "exitInto",
      elapsed: 0,
      tracks: [
        track(view, "x", to.x, ease(inCubic)),
        track(view, "y", to.y, ease(inCubic)),
        track(view, "scale", 0.6, ease(inCubic)),
        track(view, "alpha", 0, ease(inCubic))
      ]
    }),
    levelUp: (view: View): Motion => {
      const from = view.scale;
      const up = ease(outCubic);
      const down = ease(outBack);
      return {
        name: "levelUp",
        elapsed: 0,
        tracks: [
          {
            field: "scale",
            to: 1,
            at: p => (p < 0.5 ? from + (1.25 - from) * up(p * 2) : 1.25 + (1 - 1.25) * down(p * 2 - 1))
          }
        ]
      };
    },
    defaultEnter: (view: View): Motion => ({ name: "defaultEnter", elapsed: 0, tracks: [track(view, "scale", 1, ease(outCubic))] }),
    defaultExit: (view: View): Motion => ({
      name: "defaultExit",
      elapsed: 0,
      tracks: [track(view, "scale", 0.8, linear), track(view, "alpha", 0, linear)]
    }),
    settle: (view: View, fields: Field[]): Motion => {
      const rest = restPose(view);
      return { name: "settle", elapsed: 0, tracks: fields.map(field => track(view, field, rest[field], ease(outCubic))) };
    }
  };

  const restPose = (view: View) => ({ ...cellCenter(view.item.cell), scale: 1, alpha: 1 });

  // ---- writes ----
  const force = (view: View, field: Field, value: number) => {
    if (field !== "alpha") {
      const bucket = forced.get(view) ?? { x: 0, y: 0, scale: 0 };
      bucket[field] += value - view[field];
      forced.set(view, bucket);
    }
    view[field] = value;
  };
  const isCut = (motion: Motion) => motion.elapsed / DURATION < 0.5;
  const finish = (view: View, skip: Field[] = []) => {
    for (const motion of view.running) {
      if (isCut(motion)) stats.cutMotions++;
      const was = { x: view.x, y: view.y, scale: view.scale };
      for (const t of motion.tracks) if (!skip.includes(t.field)) force(view, t.field, t.to);
      const px = Math.hypot(view.x - was.x, view.y - was.y);
      const scale = Math.abs(view.scale - was.scale);
      const entry = (stats.jumpsByMotion[motion.name] ??= { finished: 0, snaps: 0, maxPx: 0, maxScale: 0 });
      entry.finished++;
      if (px > 8 || scale > 0.15) entry.snaps++;
      entry.maxPx = Math.max(entry.maxPx, Math.round(px));
      entry.maxScale = Math.max(entry.maxScale, Math.round(scale * 100) / 100);
    }
    view.running = [];
  };
  const cancel = (view: View) => {
    for (const motion of view.running) if (isCut(motion)) stats.cutMotions++;
    view.running = [];
  };

  const startBatch = (view: View, batch: Batch) => {
    if (batch.level !== undefined) view.level = batch.level;
    view.running.push(...batch.start(view));
  };

  // Under B a cancelled motion leaves fields off their rest pose. The new batch must bring them home.
  const withSettle = (batch: Batch): Batch => ({
    ...batch,
    start: view => {
      const started = batch.start(view);
      if (view.exiting) return started;
      const rest = restPose(view);
      const loose = FIELDS.filter(f => !batch.fields.includes(f) && view[f] !== rest[f]);
      return loose.length > 0 ? [...started, motions.settle(view, loose)] : started;
    }
  });

  const applyBatch = (view: View, batch: Batch) => {
    const busy = view.running.length > 0 || view.queue.length > 0;
    if (!busy) return startBatch(view, batch);

    stats.overlapCount++;
    for (const motion of view.running)
      if (!motion.tracks.some(t => batch.fields.includes(t.field))) stats.crossFieldFinishes++;

    if (policy === "A") {
      finish(view);
      return startBatch(view, batch);
    }
    if (policy === "B") {
      cancel(view);
      return startBatch(view, withSettle(batch));
    }
    view.queue.push(batch);
    stats.queueDepthMax.motion = Math.max(stats.queueDepthMax.motion, view.queue.length);
  };

  // ---- reconcile ----
  const spawn = (item: Item, hint: Hint | undefined) => {
    const at = cellCenter(item.cell);
    const fromGenerator = hint?.payload?.generatorCell as number | undefined;
    const origin = fromGenerator === undefined ? at : cellCenter(fromGenerator);
    const view: View = {
      key: item.id, item, x: origin.x, y: origin.y, scale: 0, alpha: 1, level: item.level,
      held: false, exiting: false, running: [], queue: [], bornFrame: frame
    };
    live.set(item.id, view);
    startBatch(view, {
      name: "enter",
      fields: fromGenerator === undefined ? ["scale"] : ["x", "y", "scale"],
      start: v => [fromGenerator === undefined ? motions.defaultEnter(v) : motions.enterArc(v, at)]
    });
  };

  const snapTo = (items: Item[]) => {
    live.clear();
    exiting.length = 0;
    pendingEnter.clear();
    for (const item of items) {
      const at = cellCenter(item.cell);
      live.set(item.id, {
        key: item.id, item, ...at, scale: 1, alpha: 1, level: item.level,
        held: false, exiting: false, running: [], queue: [], bornFrame: frame
      });
    }
  };

  const reconcile = () => {
    if (!pending) return;
    const { items, cause } = pending;
    pending = undefined;
    lastReconcileAt = now;
    const previous = projected;
    projected = new Map(items.map(item => [item.id, item]));

    // a hint finds its view by the key in its payload; a hint whose key has no diff entry is dropped
    const enterHints = new Map<string, Hint>();
    const exitHints = new Map<string, Hint>();
    for (const hint of hints) {
      if (hint.kind === "spawned") enterHints.set(hint.payload?.key as string, hint);
      if (hint.kind === "merged") exitHints.set(hint.payload?.from as string, hint);
    }
    hints = [];

    // "load" and "restore" play nothing: the picture is set, the despawn queue is flushed
    if (cause === "load" || cause === "restore") return snapTo(items);

    for (const item of items) {
      const view = live.get(item.id);
      if (view) {
        const moved = item.cell !== view.item.cell;
        const levelled = item.level !== view.item.level;
        view.item = item;
        if (!moved && !levelled) continue;
        lastTouch.set(item.id, now);
        const to = cellCenter(item.cell);
        applyBatch(view, {
          name: "change",
          fields: [...(moved ? (["x", "y"] as Field[]) : []), ...(levelled ? (["scale"] as Field[]) : [])],
          ...(levelled ? { level: item.level } : {}),
          start: v => [...(moved && !v.held ? [motions.slide(v, to)] : []), ...(levelled ? [motions.levelUp(v)] : [])]
        });
        continue;
      }

      lastTouch.set(item.id, now);
      const ghost = exiting.find(v => v.key === item.id);
      if (!ghost) {
        spawn(item, enterHints.get(item.id));
        continue;
      }
      // the key returns while its exit plays
      stats.overlapCount++;
      if (policy === "A") {
        finish(ghost);
        exiting.splice(exiting.indexOf(ghost), 1);
        spawn(item, enterHints.get(item.id));
      } else if (policy === "B") {
        cancel(ghost);
        exiting.splice(exiting.indexOf(ghost), 1);
        ghost.exiting = false;
        ghost.item = item;
        ghost.level = item.level;
        ghost.queue = [];
        live.set(item.id, ghost);
        startBatch(ghost, { name: "return", fields: FIELDS, start: v => [motions.settle(v, FIELDS)] });
      } else {
        pendingEnter.set(item.id, enterHints.get(item.id));
      }
    }

    for (const [key, view] of live) {
      if (projected.has(key)) continue;
      live.delete(key);
      lastTouch.set(key, now);
      view.exiting = true;
      view.held = false;
      exiting.push(view);
      stats.queueDepthMax.despawn = Math.max(stats.queueDepthMax.despawn, exiting.length);

      // the exit target is a POSITION, read once: the target's cell in the new state, else in the old one
      const into = exitHints.get(key)?.payload?.into as string | undefined;
      const target = into === undefined ? undefined : (projected.get(into) ?? previous.get(into));
      const to = target ? cellCenter(target.cell) : undefined;
      applyBatch(view, {
        name: "exit",
        fields: to ? FIELDS : ["scale", "alpha"],
        start: v => [to ? motions.exitInto(v, to) : motions.defaultExit(v)]
      });
    }
    for (const key of pendingEnter.keys()) if (!projected.has(key)) pendingEnter.delete(key);
  };

  // ---- frame ----
  const stepView = (view: View, dtMs: number) => {
    for (const motion of view.running) {
      motion.elapsed += dtMs;
      const p = Math.min(1, motion.elapsed / DURATION);
      for (const t of motion.tracks) {
        if (view.held && (t.field === "x" || t.field === "y")) continue;
        view[t.field] = p === 1 ? t.to : t.at(p);
      }
    }
    view.running = view.running.filter(motion => motion.elapsed < DURATION);
    const next = view.running.length === 0 ? view.queue.shift() : undefined;
    if (next) startBatch(view, next);
  };

  const isConverged = (key: string) => {
    if (exiting.some(v => v.key === key)) return false;
    const item = projected.get(key);
    if (!item) return true;
    const view = live.get(key);
    if (!view) return false;
    const rest = restPose(view);
    return view.x === rest.x && view.y === rest.y && view.scale === 1 && view.alpha === 1 && view.level === item.level;
  };

  const measureFrame = (before: Map<View, { x: number; y: number }>, dtMs: number) => {
    for (const [view, jump] of forced) {
      const px = Math.hypot(jump.x, jump.y);
      stats.maxJumpPx = Math.max(stats.maxJumpPx, px);
      stats.maxScaleJump = Math.max(stats.maxScaleJump, Math.abs(jump.scale));
      if (px > 8 || Math.abs(jump.scale) > 0.15) stats.snapCount++;
    }
    forced.clear();

    for (const view of [...live.values(), ...exiting]) {
      const was = before.get(view);
      if (!was || view.held || view.bornFrame === frame) {
        delete view.speed;
        continue;
      }
      const speed = { x: ((view.x - was.x) / dtMs) * 1000, y: ((view.y - was.y) / dtMs) * 1000 };
      if (view.speed) {
        const jump = Math.hypot(speed.x - view.speed.x, speed.y - view.speed.y);
        stats.maxSpeedJump = Math.max(stats.maxSpeedJump, jump);
        if (jump > 0) stats.speedJumps.push(jump);
      }
      view.speed = speed;
    }

    const keys = new Set([...projected.keys(), ...exiting.map(v => v.key), ...lagOpen.keys()]);
    for (const key of keys) {
      if (live.get(key)?.held) {
        lagOpen.delete(key);
        continue;
      }
      const open = lagOpen.get(key);
      if (isConverged(key)) {
        if (open !== undefined) {
          stats.lagSamples.push(now - open);
          stats.lagFromLastSamples.push(now - (lastTouch.get(key) ?? open));
        }
        lagOpen.delete(key);
      } else if (open === undefined) lagOpen.set(key, lastReconcileAt);
    }
  };

  return {
    stats,
    /** The new state and why it came. Reconcile runs once, at the start of the next advance. */
    commit(items: Item[], cause: Cause) {
      pending = { items, cause };
    },
    /** A V1 hint, released after its commit. */
    hint(hint: Hint) {
      hints.push(hint);
    },
    advance(dtMs: number) {
      frame++;
      const before = new Map([...live.values(), ...exiting].map(v => [v, { x: v.x, y: v.y }]));
      reconcile();
      now += dtMs;
      for (const view of [...live.values(), ...exiting]) stepView(view, dtMs);

      // the despawn queue lets a view go when its last motion ended
      for (const view of [...exiting]) {
        if (view.running.length > 0 || view.queue.length > 0) continue;
        exiting.splice(exiting.indexOf(view), 1);
        const item = projected.get(view.key);
        if (pendingEnter.has(view.key) && item) spawn(item, pendingEnter.get(view.key));
        pendingEnter.delete(view.key);
      }
      measureFrame(before, dtMs);
    },
    /** The hand takes the position of a view. Position tracks stop; other fields follow the policy. */
    grab(key: string) {
      const view = live.get(key);
      if (!view) return false;
      if (policy === "B") {
        cancel(view);
        const rest = restPose(view);
        const loose = (["scale", "alpha"] as Field[]).filter(f => view[f] !== rest[f]);
        if (loose.length > 0) view.running.push(motions.settle(view, loose));
      } else finish(view, ["x", "y"]);
      view.queue = [];
      view.level = view.item.level;
      view.held = true;
      return true;
    },
    dragBy(key: string, dx: number, dy: number) {
      const view = live.get(key);
      if (!view?.held) return;
      view.x += dx;
      view.y += dy;
    },
    dragTo(key: string, x: number, y: number) {
      const view = live.get(key);
      if (!view?.held) return;
      view.x = x;
      view.y = y;
    },
    /** A drop with no commit: there is no diff, so the view is sent home by a settle motion. */
    release(key: string) {
      const view = live.get(key);
      if (!view?.held) return;
      view.held = false;
      lagOpen.set(key, now);
      lastTouch.set(key, now);
      applyBatch(view, { name: "settle", fields: ["x", "y"], start: v => [motions.settle(v, ["x", "y"])] });
    },
    /** Views in the despawn queue take no part in hit tests. */
    hitTest(x: number, y: number, except?: string) {
      for (const view of live.values())
        if (view.key !== except && Math.abs(view.x - x) < CELL / 2 && Math.abs(view.y - y) < CELL / 2) return view.key;
      return undefined;
    },
    views: () => [...live.values(), ...exiting],
    isSettled: () =>
      exiting.length === 0 && pendingEnter.size === 0 && [...projected.keys()].every(isConverged) && live.size === projected.size,
    now: () => now
  };
}

export type Core = ReturnType<typeof createCore>;
