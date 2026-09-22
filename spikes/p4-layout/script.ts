// Spike P4. The deterministic script: the app state, the screen, the fake gate, the nine cases and
// the metrics they collect. Shared by measure.ts (headless) and main.ts (browser).

import { createCore, defaultHooks, type Core, type Entity, type Hooks, type Intent, type Layout, type MeasureFn } from "./core";
import { RewardPopup, Settings, makeRows, type Reward, type Row } from "./screens";
import { tokens, type FlatStyle, type Style, type Viewport } from "./styles";

export const PORTRAIT: Viewport = { width: 1080, height: 1920, landscape: false };
export const LANDSCAPE: Viewport = { width: 1920, height: 1080, landscape: true };
export const FRAME = 1000 / 60;

/** Monospace fake: the headless stand-in for Pixi TextMetrics. */
export const fakeMeasure: MeasureFn = (content, style) => {
  const size = style.fontSize ?? 28;
  return { width: Math.round(content.length * size * 0.6), height: Math.round(size * 1.2) };
};

/** Case 6 hooks: an enter motion with a 40 px offset next to the rect. */
export const scriptHooks: Hooks = {
  ...defaultHooks,
  enter: view => {
    view.set({ y: view.rest.y + 40, scale: 0.6, alpha: 0 });
    return view.toRest(["y", "scale", "alpha"], { ms: 250 });
  }
};

export type AppState = {
  popup: "closed" | "open" | "claimed";
  reward: Reward;
  volume: number;
  rows: Row[];
  counter: number;
  counterFixed: boolean;
};

export type CaseMetrics = {
  caseCounts: Record<number, number>;
  unlaidPopupFrames: number;
  intentsPerTap: number[];
  behindMoved: number;
  solveCallsIdle: number;
  solveCallsScroll: number;
  solveLeafMs: number[];
  solvesPerLeafChange: number[];
  localLost: number;
  siblingShiftFrame: number[];
  nodeLeak: number[];
  fullSolveMs: number[];
  solvesPerFlip: number[];
  variantMisses: number;
  fightWrites: number;
  reconcilesPerDoubleRender: number[];
  solvesPerDoubleRender: number[];
  reentered: number;
  tabIntents: number;
  rowWidthError: number[];
  measureCallsPerChange: number[];
};

const emptyMetrics = (): CaseMetrics => ({
  caseCounts: {},
  unlaidPopupFrames: 0,
  intentsPerTap: [],
  behindMoved: 0,
  solveCallsIdle: 0,
  solveCallsScroll: 0,
  solveLeafMs: [],
  solvesPerLeafChange: [],
  localLost: 0,
  siblingShiftFrame: [],
  nodeLeak: [],
  fullSolveMs: [],
  solvesPerFlip: [],
  variantMisses: 0,
  fightWrites: 0,
  reconcilesPerDoubleRender: [],
  solvesPerDoubleRender: [],
  reentered: 0,
  tabIntents: 0,
  rowWidthError: [],
  measureCallsPerChange: []
});

export type Driver = ReturnType<typeof createDriver>;

export function createDriver(layout: Layout, options: { measure?: MeasureFn; exitFlow?: "leave" | "stay"; onFrame?: (core: Core) => void } = {}) {
  const state: AppState = {
    popup: "closed",
    reward: { orderId: "o-1", items: ["gem", "coin", "key"], coins: 25 },
    volume: 50,
    rows: makeRows(30),
    counter: 0,
    counterFixed: true
  };
  const intents: Intent[] = [];
  const gate = (intent: Intent): void => {
    intents.push(intent);
    if (intent.name === "claim") state.popup = "closed";
    if (intent.name === "volume") state.volume += Number(intent.payload?.delta ?? 0);
  };
  const core = createCore({ layout, hooks: scriptHooks, gate, measure: options.measure ?? fakeMeasure, ...(options.exitFlow ? { exitFlow: options.exitFlow } : {}) });
  let viewport = PORTRAIT;
  const metrics = emptyMetrics();

  const screen: Parameters<Core["render"]>[0] = local => ({
    type: "fragment",
    key: undefined,
    props: {},
    children: [
      Settings({ volume: state.volume, rows: state.rows, counter: state.counter, counterFixed: state.counterFixed, local }),
      ...(state.popup === "closed" ? [] : [RewardPopup({ reward: state.reward, phase: state.popup })])
    ]
  });

  const render = (): void => core.render(screen, viewport);
  const step = (frames = 1): void => {
    for (let index = 0; index < frames; index++) {
      core.advance(FRAME);
      options.onFrame?.(core);
    }
  };
  const subtree = (rootKey: string): Entity[] => {
    const root = core.byKey(rootKey);
    if (!root) return [];
    const out: Entity[] = [];
    const visit = (entity: Entity): void => {
      out.push(entity);
      for (const id of entity.children) {
        const child = core.get(id);
        if (child) visit(child);
      }
    };
    visit(root);
    return out;
  };
  const center = (entity: Entity): [number, number] => [entity.abs.x + entity.abs.w / 2, entity.abs.y + entity.abs.h / 2];
  const buttonIn = (parentKey: string, key: string): Entity | undefined => {
    const parent = core.byKey(parentKey);
    return parent ? parent.children.map(id => core.get(id)).find(e => e?.key === key) : undefined;
  };
  const count = (caseNo: number): void => {
    metrics.caseCounts[caseNo] = (metrics.caseCounts[caseNo] ?? 0) + 1;
  };
  const untilGone = (keys: () => Entity[], max = 60, each?: (frame: number) => void): number => {
    for (let frame = 1; frame <= max; frame++) {
      step();
      each?.(frame);
      if (keys().length === 0) return frame;
    }
    return max;
  };

  const cases: Record<number, () => void> = {
    // 1. Open the popup: every popup entity has a rect in frame 1.
    1() {
      state.popup = "open";
      render();
      step();
      const missing = subtree("popup").filter(e => !e.hasRect || (e.abs.w === 0 && e.abs.h === 0));
      if (missing.length > 0) metrics.unlaidPopupFrames++;
      step(5);
      count(1);
    },
    // 2. Tap claim: one intent, exit before despawn, nothing behind moves.
    2() {
      step(25); // earlier exits are despawned: only the popup's exit is measured
      if (state.popup !== "open") {
        state.popup = "open";
        render();
        step(2);
      }
      const behind = new Map(subtree("settings").map(e => [e.id, { ...e.abs }]));
      const claim = buttonIn("panel", "claim");
      const before = core.stats.intents;
      if (claim) core.tap(...center(claim));
      metrics.intentsPerTap.push(core.stats.intents - before);
      render();
      untilGone(() => core.entities().filter(e => e.key === "popup"), 60, () => {
        for (const entity of subtree("settings")) {
          const was = behind.get(entity.id);
          if (was && (was.x !== entity.abs.x || was.y !== entity.abs.y || was.w !== entity.abs.w || was.h !== entity.abs.h)) metrics.behindMoved++;
        }
      });
      count(2);
    },
    // 3. Counter ticks with a fixed width, then intrinsic, then a scroll.
    3() {
      state.counterFixed = true;
      render();
      step(25); // earlier exits are despawned: only the counter is measured
      let solves = core.stats.solves;
      for (let frame = 0; frame < 180; frame++) {
        state.counter++;
        render();
        step();
      }
      metrics.solveCallsIdle += core.stats.solves - solves;

      state.counterFixed = false;
      render();
      step(2);
      solves = core.stats.solves;
      const samplesBefore = core.stats.solveMs.length;
      for (let frame = 0; frame < 30; frame++) {
        state.counter++;
        render();
        step();
      }
      metrics.solvesPerLeafChange.push((core.stats.solves - solves) / 30);
      metrics.solveLeafMs.push(...core.stats.solveMs.slice(samplesBefore));
      state.counterFixed = true;
      render();
      step(2);

      solves = core.stats.solves;
      for (let frame = 1; frame <= 60; frame++) {
        core.scroll("rows", (frame * 500) / 60);
        step();
      }
      metrics.solveCallsScroll += core.stats.solves - solves;
      core.scroll("rows", 0);
      step();
      count(3);
    },
    // 4. Shuffle by key, keep local state, remove a row with an exit, churn 1000 rows.
    4() {
      state.rows = makeRows(30);
      render();
      step(2);
      const select = buttonIn("row-7", "select");
      if (select) core.tap(...center(select));
      render();
      step();
      const row7 = core.byKey("row-7");
      const selected = () => core.localReader("row-7", { selected: false }).selected;
      if (!selected()) metrics.localLost++;

      state.rows = shuffle(state.rows, seedState.next());
      render();
      step();
      if (core.byKey("row-7") !== row7 || !selected()) metrics.localLost++;

      const position = state.rows.findIndex(row => row.id === "row-7");
      const followerId = state.rows[position + 1]?.id ?? state.rows[position - 1]?.id ?? "row-8";
      const row8 = core.byKey(followerId);
      const row8Y = row8?.abs.y;
      state.rows = state.rows.filter(row => row.id !== "row-7");
      render();
      let shiftFrame = 0;
      untilGone(() => core.entities().filter(e => e.key === "row-7"), 60, frame => {
        if (shiftFrame === 0 && row8 && row8.abs.y !== row8Y) shiftFrame = frame;
      });
      metrics.siblingShiftFrame.push(shiftFrame);

      state.rows = makeRows(30);
      render();
      step(25);
      const nodesBefore = layout.nodeCount();
      state.rows = makeRows(1000, 7);
      render();
      step();
      state.rows = makeRows(30);
      render();
      step(30);
      const nodesAfter = layout.nodeCount();
      if (nodesBefore !== undefined && nodesAfter !== undefined) metrics.nodeLeak.push(nodesAfter - nodesBefore);
      count(4);
    },
    // 5. Orientation flip with 100 rows.
    5() {
      state.rows = makeRows(100);
      render();
      step(2);
      const solves = core.stats.solves;
      viewport = LANDSCAPE;
      core.viewport(viewport);
      step();
      metrics.solvesPerFlip.push(core.stats.solves - solves);
      metrics.fullSolveMs.push(core.stats.lastSolveMs);
      for (const entity of core.entities()) {
        const style = entity.props.style as Style | undefined;
        const branch = style?.when?.landscape;
        if (!branch) continue;
        for (const [key, value] of Object.entries(branch) as [keyof FlatStyle, unknown][]) {
          if (JSON.stringify(entity.flat[key]) !== JSON.stringify(value)) metrics.variantMisses++;
        }
      }
      viewport = PORTRAIT;
      core.viewport(viewport);
      step(2);
      state.rows = makeRows(30);
      render();
      step(2);
      count(5);
    },
    // 6. A rect and an enter motion at the same time: the picture is rect + offset, no snap.
    6() {
      state.rows = [...makeRows(30), { id: "row-new", label: "New row", value: "0%" }];
      render();
      step();
      const fresh = core.byKey("row-new");
      if (fresh) {
        let last = fresh.pose.y;
        for (let frame = 0; frame < 20; frame++) {
          step();
          const expectedDirection = fresh.pose.y <= last + 0.001;
          if (!expectedDirection) metrics.fightWrites++;
          last = fresh.pose.y;
        }
      }
      state.rows = makeRows(30);
      render();
      step(25);
      count(6);
    },
    // 7. Two state changes in one frame: one reconcile, one solve.
    7() {
      step();
      const reconciles = core.stats.reconciles;
      const solves = core.stats.solves;
      state.volume += 10;
      render();
      state.rows = makeRows(31);
      render();
      step();
      metrics.reconcilesPerDoubleRender.push(core.stats.reconciles - reconciles);
      metrics.solvesPerDoubleRender.push(core.stats.solves - solves);
      state.rows = makeRows(30);
      render();
      step(25);
      count(7);
    },
    // 8. Tab switch through local state: no intent, no re-entered entities, is.active follows.
    8() {
      const ids = new Set(subtree("settings").map(e => e.id));
      const intentsBefore = core.stats.intents;
      const video = buttonIn("tabs", "video");
      if (video) core.tap(...center(video));
      render();
      step();
      metrics.tabIntents += core.stats.intents - intentsBefore;
      const after = subtree("settings");
      metrics.reentered += after.filter(e => !ids.has(e.id) && !e.exiting).length;
      const videoAfter = buttonIn("tabs", "video");
      if (core.localReader("tabs", { tab: "audio" }).tab !== "video" || videoAfter?.flat.fill !== tokens.color.accent) metrics.localLost++;
      const audio = buttonIn("tabs", "audio");
      if (audio) core.tap(...center(audio));
      render();
      step();
      count(8);
    },
    // 9. Text measurement: row width = icon + gap + text; one measure call per content change.
    9() {
      step();
      const measured = buttonIn("measure-row", "measured");
      const row = core.byKey("measure-row");
      if (measured && row) {
        const expected = 40 + 16 + measureNow(measured).width;
        metrics.rowWidthError.push(Math.abs(row.abs.w - expected));
      }
      const calls = layout.measureCalls;
      state.volume += 1;
      render();
      step();
      metrics.measureCallsPerChange.push(layout.measureCalls - calls);
      count(9);
    }
  };

  const measureNow = (entity: Entity) => (options.measure ?? fakeMeasure)(String(entity.props.content ?? ""), entity.flat);

  const seedState = { value: 1, next: () => (seedState.value = (seedState.value * 1103515245 + 12345) % 2147483648) };

  return {
    core,
    state,
    metrics,
    intents,
    render,
    step,
    cases,
    center,
    buttonIn,
    subtree,
    setViewport(next: Viewport) {
      viewport = next;
      core.viewport(next);
    },
    /** Plays the seeded script: 10 blocks per case, shuffled. */
    runAll(seed: number, blocksPerCase = 10): void {
      seedState.value = seed;
      const blocks: number[] = [];
      for (const caseNo of Object.keys(cases).map(Number)) for (let index = 0; index < blocksPerCase; index++) blocks.push(caseNo);
      const order = shuffle(blocks, seed);
      render();
      step(2);
      for (const caseNo of order) cases[caseNo]?.();
      step(60);
    }
  };
}

/** Seeded Fisher–Yates. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed >>> 0 || 1;
  for (let index = out.length - 1; index > 0; index--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const pick = state % (index + 1);
    const a = out[index] as T;
    out[index] = out[pick] as T;
    out[pick] = a;
  }
  return out;
}
