/**
 * Spike P18, browser page. The same list as probe.tsx, drawn by the real renderer (WebGPU).
 * `?n=1000&mode=window`. The driver (drive.ts) reads `globalThis.p18`.
 */
import "./dev";
import { createApp, defineGame, projection, screen, type } from "../../src/index";
import { Pointer, Pressed } from "../../src/plugins/input/components";
import { Box, Scroll, UiCounters } from "../../src/plugins/ui/components";
import { defineComponent } from "../../src/plugins/ui/jsx/component";

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


const params = new URLSearchParams(location.search);
cfg.n = Number(params.get("n") ?? 50);
cfg.mode = (params.get("mode") ?? "full") as "full" | "window";

function setWindow(firstVisible: number) {
  const visible = Math.ceil(VIEW_H / ROW_H);
  cfg.first = Math.max(0, firstVisible - MARGIN);
  cfg.last = Math.min(cfg.n - 1, firstVisible + visible + MARGIN - 1);
}
setWindow(0);

const t0 = performance.now();
const app = createApp({
  plugins: [...screen, feature],
  pluginConfigs: {
    renderer: { mount: "#game", preference: (params.get("renderer") ?? "webgpu") as "webgpu" },
    flow: { mainFlow: main },
    i18n: { locale: "en", fallback: "en" },
    model: { initialPlayer: { coins: 1 }, initialSession: { visits: 0 }, seed: 1 }
  }
} as never) as any;
await app.start();
app.flow.run().catch(() => undefined);
app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
const tMount = performance.now();
app.world.projection.mount(["list"], { kind: "plugin", name: "p18" });

const frame = () => new Promise<number>(r => requestAnimationFrame(r));
while (app.ui.find("listBox") === undefined) await frame();
await frame();
const mountMs = performance.now() - tMount;

function q(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return { p50: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +(s.at(-1) ?? 0).toFixed(2) };
}

/** Samples rAF deltas, the renderer's own work ms and draw calls over `frames` frames. */
async function sample(frames: number, each?: () => void) {
  const deltas: number[] = [];
  const work: number[] = [];
  const draws: number[] = [];
  let last = await frame();
  for (let i = 0; i < frames; i += 1) {
    each?.();
    const now = await frame();
    deltas.push(now - last);
    last = now;
    const st = app.renderer.stats();
    work.push(st.frameMs);
    draws.push(st.drawCalls ?? -1);
  }
  return { rafDeltaMs: q(deltas), workMs: q(work), drawCalls: q(draws) };
}

async function run() {
  const ecs = app.world.ecs;
  const container = app.ui.find("listBox");
  const pointer = ecs.resource(Pointer);
  const idle = await sample(120);
  // Drag 1000 px/s up for 2 s: 16 px per frame at 60 Hz. The window follows Scroll.offset.
  pointer.y = 1800;
  ecs.tag(container, Pressed);
  let windowRenders = 0;
  const drag = await sample(240, () => {
    pointer.y -= 16;
    if (cfg.mode !== "window") return;
    const offset = ecs.get(container, Scroll)?.offset ?? 0;
    const firstVisible = Math.floor(-offset / ROW_H);
    const before = cfg.first;
    setWindow(firstVisible);
    if (cfg.first !== before) {
      windowRenders += 1;
      app.input.tap(app.ui.find("bump") ?? 0);
    }
  });
  ecs.untag(container, Pressed);
  const entities = [...ecs.query(Box)].length;
  return {
    n: cfg.n, mode: cfg.mode, renderer: app.renderer.host.kind(), mountMs: +mountMs.toFixed(1),
    startMs: +(tMount - t0).toFixed(1), uiEntities: entities, yogaNodes: ecs.resource(UiCounters).nodes,
    views: app.renderer.stats().views, idle, drag, windowRenders,
    offset: ecs.get(container, Scroll)?.offset
  };
}

Reflect.set(globalThis, "p18", { run, app });
