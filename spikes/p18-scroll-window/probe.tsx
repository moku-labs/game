/**
 * Spike P18, headless probe. Real `ui`, real Yoga, inert renderer, plain Bun.
 *
 *   bun spikes/p18-scroll-window/probe.tsx            -> metrics.json
 *
 * Mode "full": today's scroll, every row is an element. Mode "window": the same list, but only
 * the rows inside the viewport plus a margin are elements, between two spacer rows. The window is
 * moved from outside (a module variable) and a re-render is asked for through a local tap, since
 * a view cannot read the scroll offset today.
 */
import { createApp, defineGame, projection, type } from "../../src/index";
import { animPlugin } from "../../src/plugins/anim";
import { assetsPlugin } from "../../src/plugins/assets";
import { i18nPlugin } from "../../src/plugins/i18n";
import { inputPlugin } from "../../src/plugins/input";
import { Pointer, Pressed } from "../../src/plugins/input/components";
import { rendererPlugin } from "../../src/plugins/renderer";
import { Transform } from "../../src/plugins/renderer/components";
import { scenesPlugin } from "../../src/plugins/scenes";
import { textPlugin } from "../../src/plugins/text";
import { Text } from "../../src/plugins/text/components";
import { Box, Scroll, UiCounters } from "../../src/plugins/ui/components";
import { uiPlugin } from "../../src/plugins/ui/index";
import { defineComponent } from "../../src/plugins/ui/jsx/component";
import { worldPlugin } from "../../src/plugins/world";

const ROW_H = 120;
const VIEW_H = 1600;
const MARGIN = 5;

/** What the view reads. The probe changes it, then taps `bump` to re-render. */
const cfg = { n: 50, mode: "full" as "full" | "window", first: 0, last: 0, rowLocal: false };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { coins: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, never>;
}>();

/** One row with local state, so the probe can see whether it survives leaving the window. */
const LocalRow = defineComponent("LocalRow", {
  local: { open: false },
  view: (props: { i: number }, local) => row(props.i, local.open)
});

/** Five elements per row: the row, an avatar, two fixed texts, a button. */
function row(i: number, open = false) {
  return (
    <row key={`r${i}`} style={{ height: ROW_H, width: 1080, gap: 16, padding: 16, fill: 0x22_22_22 }}>
      <stack key={`a${i}`} style={{ width: 88, height: 88, fill: 0x44_44_44, radius: 44 }} />
      <text key={`n${i}`} style={{ width: 500, height: 48 }} content={`row ${i} ${open ? "open" : "shut"}`} />
      <text key={`s${i}`} style={{ width: 200, height: 48 }} content={String(i * 7)} />
      <button key={`g${i}`} local={{ open: true }} style={{ width: 120, height: 88 }} />
    </row>
  );
}

function rowsOf(from: number, to: number) {
  const out = [];
  for (let i = from; i <= to; i += 1) out.push(cfg.rowLocal ? <LocalRow key={`r${i}`} i={i} /> : row(i));
  return out;
}

const List = defineComponent("List", {
  local: { tick: 0 },
  view: (_props: object, local) => {
    const windowed = cfg.mode === "window";
    const from = windowed ? cfg.first : 0;
    const to = windowed ? cfg.last : cfg.n - 1;
    return (
      <column key="root" style={{ width: 1080, height: 1920 }}>
        <button key="bump" local={{ tick: local.tick + 1 }} style={{ width: 100, height: 100 }} />
        <scroll key="listBox" axis="y" style={{ width: 1080, height: VIEW_H }}>
          <column key="content" style={{ width: 1080 }}>
            {windowed ? <row key="top" style={{ width: 1080, height: from * ROW_H }} /> : null}
            {rowsOf(from, to)}
            {windowed ? <row key="bottom" style={{ width: 1080, height: (cfg.n - 1 - to) * ROW_H }} /> : null}
          </column>
        </scroll>
      </column>
    );
  }
});

const listScreen = projection({
  name: "list",
  layer: "ui",
  from: (p: { coins: number }) => [{ id: "screen", coins: p.coins }],
  key: (item: { id: string }) => item.id,
  view: () => <List key="listC" />
});

const home = defineNode({ rest: true, outcomes: { go: type() } });
const main = defineFlow("main", { nodes: { home }, start: "home", outcomes: {}, edges: { home: { go: "home" } } });
const feature = defineFeature("p18", { flows: [main], projections: [listScreen], ui: [List, LocalRow] });

const PHONE = { width: 1080, height: 1920, scale: 0.36, orientation: "portrait", safeArea: { top: 0, right: 0, bottom: 0, left: 0 } } as const;

async function tick(times = 60) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function q(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { p50: +at(0.5).toFixed(3), p95: +at(0.95).toFixed(3), max: +(s.at(-1) ?? 0).toFixed(3) };
}

async function start() {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, inputPlugin, assetsPlugin, scenesPlugin, animPlugin, i18nPlugin, textPlugin, uiPlugin, feature],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { coins: 1 }, initialSession: { visits: 0 }, seed: 1 }
    }
  } as never) as any;
  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.renderer.viewport.size = () => PHONE;
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  return app;
}

function uiEntities(app: any): Set<number> {
  return new Set([...app.world.ecs.query(Box)].map((t: any) => (Array.isArray(t) ? t[0] : t) as number));
}

function step(app: any): number {
  const t = performance.now();
  app.time.step(16);
  return performance.now() - t;
}

/** Re-render the list through a local tap and step once; returns the frame ms. */
function rerender(app: any): number {
  app.input.tap(app.ui.find("bump") ?? 0);
  return step(app);
}

function setWindow(firstVisible: number) {
  const visible = Math.ceil(VIEW_H / ROW_H);
  cfg.first = Math.max(0, firstVisible - MARGIN);
  cfg.last = Math.min(cfg.n - 1, firstVisible + visible + MARGIN - 1);
}

async function measure(n: number, mode: "full" | "window") {
  cfg.n = n;
  cfg.mode = mode;
  cfg.rowLocal = false;
  setWindow(0);
  const app = await start();
  const tMount = performance.now();
  app.world.projection.mount(["list"], { kind: "plugin", name: "p18" });
  const mountFrames: number[] = [];
  for (let i = 0; i < 6 && uiEntities(app).size === 0; i += 1) {
    mountFrames.push(step(app));
    await tick();
  }
  mountFrames.push(step(app));
  const mountMs = performance.now() - tMount;
  const c = app.world.ecs.resource(UiCounters);
  const entities = uiEntities(app).size;
  const nodes = c.nodes;

  // Idle frames: nothing changes.
  const idle: number[] = [];
  for (let i = 0; i < 120; i += 1) idle.push(step(app));

  // Drag frames: finger moves 6 px per frame.
  const container = app.ui.find("listBox");
  const pointer = app.world.ecs.resource(Pointer);
  pointer.y = 1500;
  app.world.ecs.tag(container, Pressed);
  step(app);
  const solvesBeforeDrag = c.solves;
  const drag: number[] = [];
  for (let i = 0; i < 120; i += 1) {
    pointer.y -= 6;
    drag.push(step(app));
  }
  const dragSolves = c.solves - solvesBeforeDrag;
  app.world.ecs.untag(container, Pressed);
  step(app);
  const scroll = app.world.ecs.get(container, Scroll);

  // Full re-render of the root (a local tap anywhere in the List component).
  const rerenders: number[] = [];
  for (let i = 0; i < 30; i += 1) {
    rerenders.push(rerender(app));
    step(app);
  }

  // Window shift by one row and by a page: what spawns, what exits, what it costs.
  let shift1: number[] = [];
  let shiftPage: number[] = [];
  let spawnedPerShift1 = 0;
  let spawnedPerPage = 0;
  let stableEntitiesKept = false;
  if (mode === "window") {
    for (let first = 1; first <= 30; first += 1) {
      setWindow(first);
      const before = uiEntities(app);
      shift1.push(rerender(app));
      step(app); // sweep frees the exited rows
      const after = uiEntities(app);
      spawnedPerShift1 = [...after].filter(e => !before.has(e)).length;
      stableEntitiesKept = app.ui.find(`r${first + 3}`) !== undefined;
    }
    for (let page = 1; page <= 20; page += 1) {
      setWindow(Math.min(n - 14, 30 + page * 14));
      const before = uiEntities(app);
      shiftPage.push(rerender(app));
      step(app);
      spawnedPerPage = [...uiEntities(app)].filter(e => !before.has(e)).length;
    }
  }
  const nodesAfter = c.nodes;
  const entitiesAfter = uiEntities(app).size;
  await app.stop();
  return {
    n,
    mode,
    uiEntities: entities,
    yogaNodes: nodes,
    mountMs: +mountMs.toFixed(2),
    mountFrames: mountFrames.map(v => +v.toFixed(2)),
    idleFrameMs: q(idle),
    dragFrameMs: q(drag),
    dragSolves,
    scrollMin: scroll?.min,
    rerenderFrameMs: q(rerenders),
    ...(mode === "window"
      ? {
          shift1FrameMs: q(shift1),
          shiftPageFrameMs: q(shiftPage),
          spawnedPerShift1,
          spawnedPerPage,
          stableEntitiesKept,
          nodesAfterShifts: nodesAfter,
          entitiesAfterShifts: entitiesAfter
        }
      : {})
  };
}

/** Does a row's local state survive leaving the window and coming back? */
async function localSurvival() {
  cfg.n = 200;
  cfg.mode = "window";
  cfg.rowLocal = true;
  setWindow(0);
  const app = await start();
  app.world.projection.mount(["list"], { kind: "plugin", name: "p18" });
  for (let i = 0; i < 6; i += 1) { step(app); await tick(); }
  const before = app.ui.find("n3");
  app.input.tap(app.ui.find("g3") ?? 0);
  step(app);
  const opened = app.world.ecs.get(app.ui.find("n3"), Text)?.content;
  setWindow(60);
  rerender(app);
  step(app);
  const gone = app.ui.find("n3") === undefined;
  setWindow(0);
  rerender(app);
  step(app);
  step(app);
  const back = app.world.ecs.get(app.ui.find("n3"), Text)?.content;
  const sameEntity = app.ui.find("n3") === before;
  await app.stop();
  return { opened, goneWhileOut: gone, afterReturn: back, sameEntity };
}

/** Yoga alone: the cost of keeping the whole list in Yoga with no entities. */
async function yogaOnly() {
  const { loadYoga } = await import("yoga-layout/load");
  const Y = await loadYoga();
  const out: Record<string, unknown>[] = [];
  for (const n of [50, 200, 1000, 10_000]) {
    const t0 = performance.now();
    const root = Y.Node.create();
    root.setWidth(1080);
    const content = Y.Node.create();
    root.insertChild(content, 0);
    const leaves: ReturnType<typeof Y.Node.create>[] = [];
    for (let i = 0; i < n; i += 1) {
      const r = Y.Node.create();
      r.setFlexDirection(Y.FLEX_DIRECTION_ROW);
      r.setHeight(ROW_H);
      r.setWidth(1080);
      r.setGap(Y.GUTTER_ALL, 16);
      r.setPadding(Y.EDGE_ALL, 16);
      for (const [w, h] of [[88, 88], [500, 48], [200, 48], [120, 88]] as const) {
        const c = Y.Node.create();
        c.setWidth(w);
        c.setHeight(h);
        r.insertChild(c, r.getChildCount());
        leaves.push(c);
      }
      content.insertChild(r, i);
    }
    const build = performance.now() - t0;
    const t1 = performance.now();
    root.calculateLayout(1080, undefined, Y.DIRECTION_LTR);
    const first = performance.now() - t1;
    const relayout: number[] = [];
    for (let k = 0; k < 20; k += 1) {
      leaves[(k * 37) % leaves.length]?.setWidth(500 + (k % 2));
      const t = performance.now();
      root.calculateLayout(1080, undefined, Y.DIRECTION_LTR);
      relayout.push(performance.now() - t);
    }
    // Read every rect, as `place` does.
    const t2 = performance.now();
    let sum = 0;
    for (let i = 0; i < content.getChildCount(); i += 1) {
      const r = content.getChild(i);
      sum += r.getComputedTop() + r.getComputedHeight();
      for (let j = 0; j < r.getChildCount(); j += 1) sum += r.getChild(j).getComputedLeft();
    }
    const read = performance.now() - t2;
    out.push({ rows: n, nodes: n * 5 + 2, buildMs: +build.toFixed(2), firstSolveMs: +first.toFixed(2), oneLeafRelayout: q(relayout), readAllRectsMs: +read.toFixed(2), sum });
    root.freeRecursive();
  }
  return out;
}

const results = [];
for (const n of [50, 200, 1000]) {
  results.push(await measure(n, "full"));
  results.push(await measure(n, "window"));
}
const local = await localSurvival();
const yoga = await yogaOnly();
const report = { bun: Bun.version, date: new Date().toISOString(), rowHeight: ROW_H, viewHeight: VIEW_H, margin: MARGIN, results, localSurvival: local, yoga };
await Bun.write(`${import.meta.dir}/metrics.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
