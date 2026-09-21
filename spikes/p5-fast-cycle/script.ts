// Spike P5. A deterministic move script from a seed: case blocks on a 5×5 board, no merge rules.

import type { Cause, Hint, Item } from "./core";

export type ScriptEvent =
  | { t: number; op: "commit"; items: Item[]; cause: Cause; hints: Hint[] }
  | { t: number; op: "grab" | "release"; key: string }
  | { t: number; op: "drag"; key: string; dx: number; dy: number };

export type Script = { events: ScriptEvent[]; caseCounts: Record<number, number>; endMs: number; overlapAtMs: number };

const GENERATOR_CELL = 22;
const FRAME = 1000 / 60;

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type State = { items: Item[]; nextId: number };

/** The board state and the moves. Every move returns the commit it makes. */
export function createSim(seed: number) {
  const random = mulberry32(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)] as T;
  let state: State = { items: [{ id: "gen", kind: "gen", cell: GENERATOR_CELL, level: 1 }], nextId: 1 };
  const history: State[] = [];

  const cells = [...Array(25).keys()].filter(c => c !== GENERATOR_CELL).sort(() => random() - 0.5);
  for (const cell of cells.slice(0, 19))
    state.items.push({ id: `i${state.nextId++}`, kind: "item", cell, level: 1 + Math.floor(random() * 3) });

  const set = (next: State) => {
    history.push(state);
    state = next;
  };
  const hint = (kind: string, payload: Record<string, unknown>): Hint => ({ kind, payload, hint: true });
  const movable = () => state.items.filter(i => i.kind === "item");
  const freeCells = () => [...Array(25).keys()].filter(c => !state.items.some(i => i.cell === c));
  const commit = (hints: Hint[], cause: Cause = "edge") => ({ items: state.items, cause, hints });

  return {
    items: () => state.items,
    count: () => movable().length,
    pickItems: (n: number, except: string[] = []) => {
      const pool = movable().filter(i => !except.includes(i.id));
      const out: Item[] = [];
      while (out.length < n && pool.length > 0) out.push(...pool.splice(Math.floor(random() * pool.length), 1));
      return out;
    },
    freeCell: (except?: number) => pick(freeCells().filter(c => c !== except)),
    load: () => commit([], "load"),
    merge(from: string, into: string, withHint = true) {
      set({
        ...state,
        items: state.items.filter(i => i.id !== from).map(i => (i.id === into ? { ...i, level: i.level + 1 } : i))
      });
      return commit(withHint ? [hint("merged", { from, into })] : []);
    },
    tap(cell: number, withHint = true) {
      const id = `i${state.nextId}`;
      set({ nextId: state.nextId + 1, items: [...state.items, { id, kind: "item", cell, level: 1 }] });
      return { id, ...commit(withHint ? [hint("spawned", { key: id, generatorCell: GENERATOR_CELL })] : []) };
    },
    move(id: string, cell: number) {
      set({ ...state, items: state.items.map(i => (i.id === id ? { ...i, cell } : i)) });
      return commit([]);
    },
    sell(id: string) {
      set({ ...state, items: state.items.filter(i => i.id !== id) });
      return commit([]);
    },
    /** The state of the previous commit returns. The id counter rolls back with it. */
    rollback() {
      const previous = history.pop();
      if (previous) state = previous;
      return commit([], "rollback");
    }
  };
}

export type Sim = ReturnType<typeof createSim>;

/** Builds the script. `onlyCase` builds one block of one case, for the screenshot strips. */
export function buildScript(seed: number, intervalMs: number, onlyCase?: number): Script {
  const sim = createSim(seed);
  const random = mulberry32(seed ^ 0x9e3779b9);
  const events: ScriptEvent[] = [{ t: 0, op: "commit", ...sim.load() }];
  const caseCounts: Record<number, number> = {};
  let slot = 3; // the first moves come after the load settled
  let overlapAtMs = 0;

  const at = (s: number) => s * intervalMs;
  const push = (s: number, c: { items: Item[]; cause: Cause; hints: Hint[] }) =>
    events.push({ t: at(s), op: "commit", items: c.items, cause: c.cause, hints: c.hints });

  const blocks: Record<number, (variant: number) => void> = {
    // 1. merge into B while B still plays levelUp
    1: () => {
      const [a1, a2, b] = sim.pickItems(3) as [Item, Item, Item];
      push(slot++, sim.merge(a1.id, b.id));
      push(slot++, sim.merge(a2.id, b.id));
    },
    // 2. merge A into B while A still slides
    2: () => {
      const [a, b] = sim.pickItems(2) as [Item, Item];
      push(slot++, sim.move(a.id, sim.freeCell()));
      push(slot++, sim.merge(a.id, b.id));
    },
    // 3. A flies into B, B is merged away before A arrives
    3: () => {
      const [a, b, c] = sim.pickItems(3) as [Item, Item, Item];
      push(slot++, sim.merge(a.id, b.id));
      push(slot++, sim.merge(b.id, c.id));
    },
    // 4. an item from the generator is merged before its arc ends
    4: () => {
      const [b] = sim.pickItems(1) as [Item];
      const tap = sim.tap(sim.freeCell());
      push(slot++, tap);
      push(slot++, sim.merge(tap.id, b.id));
    },
    // 5. a key leaves and returns while its exit plays: same fields, then other fields (the id is reused)
    5: variant => {
      if (variant % 2 === 0) {
        const [a, b] = sim.pickItems(2) as [Item, Item];
        push(slot++, sim.merge(a.id, b.id));
        push(slot++, sim.rollback());
        return;
      }
      const first = sim.freeCell();
      push(slot++, sim.tap(first));
      push(slot++, sim.rollback());
      push(slot++, sim.tap(sim.freeCell(first)));
    },
    // 6. the hint is lost
    6: variant => {
      const [a, b] = sim.pickItems(2) as [Item, Item];
      if (variant % 2 === 0) push(slot++, sim.merge(a.id, b.id, false));
      else push(slot++, sim.tap(sim.freeCell(), false));
      push(slot++, sim.move(b.id, sim.freeCell()));
    },
    // 7. two commits in one frame; in the odd variant a hint names a key that never had a view
    7: variant => {
      if (variant % 2 === 0) {
        const [a, b, c] = sim.pickItems(3) as [Item, Item, Item];
        push(slot, sim.merge(a.id, b.id));
        push(slot++, sim.merge(b.id, c.id));
        return;
      }
      const [d] = sim.pickItems(1) as [Item];
      const tap = sim.tap(sim.freeCell());
      push(slot, tap);
      push(slot++, sim.merge(tap.id, d.id));
    },
    // 8. the hand grabs a view that still slides, then drops it with no commit
    8: () => {
      const [a] = sim.pickItems(1) as [Item];
      push(slot, sim.move(a.id, sim.freeCell()));
      const grabAt = at(slot) + 100;
      events.push({ t: grabAt, op: "grab", key: a.id });
      for (let t = grabAt + FRAME; t < grabAt + 300; t += FRAME) events.push({ t, op: "drag", key: a.id, dx: 5, dy: -3 });
      events.push({ t: grabAt + 300, op: "release", key: a.id });
      slot += Math.ceil(400 / intervalMs) + 1;
    }
  };

  const fill = () => {
    while (sim.count() < 10) push(slot++, sim.tap(sim.freeCell()));
    while (sim.count() > 21) push(slot++, sim.sell((sim.pickItems(1)[0] as Item).id));
  };

  const order = onlyCase === undefined ? [1, 2, 3, 4, 5, 6, 7, 8].flatMap(c => Array<number>(10).fill(c)) : [onlyCase];
  order.sort(() => random() - 0.5);
  for (const caseNo of order) {
    fill();
    const variant = caseCounts[caseNo] ?? 0;
    const startSlot = slot;
    (blocks[caseNo] as (variant: number) => void)(variant);
    caseCounts[caseNo] = variant + 1;
    overlapAtMs = at(caseNo === 7 ? startSlot : startSlot + 1);
  }

  events.sort((a, b) => a.t - b.t);
  return { events, caseCounts, endMs: at(slot), overlapAtMs };
}

/** Feeds the events that are due into the core. */
export function feed(
  core: { commit(items: Item[], cause: Cause): void; hint(h: Hint): void; grab(k: string): unknown; dragBy(k: string, x: number, y: number): void; release(k: string): void },
  events: ScriptEvent[],
  cursor: number,
  nowMs: number
) {
  let index = cursor;
  for (; index < events.length && (events[index] as ScriptEvent).t <= nowMs; index++) {
    const event = events[index] as ScriptEvent;
    if (event.op === "commit") {
      core.commit(event.items, event.cause);
      for (const hint of event.hints) core.hint(hint);
    } else if (event.op === "grab") core.grab(event.key);
    else if (event.op === "drag") core.dragBy(event.key, event.dx, event.dy);
    else core.release(event.op === "release" ? event.key : "");
  }
  return index;
}
