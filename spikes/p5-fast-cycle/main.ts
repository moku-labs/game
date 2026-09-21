// Spike P5. A Pixi v8 board that draws the views of core.ts. bun serve.ts, then http://localhost:3055

import { Application, Container, Graphics, Text } from "pixi.js";
import { CELL, type Core, createCore, ORIGIN, type Policy, SIDE, type View } from "./core";
import { buildScript, createSim, feed, type Script, type Sim } from "./script";

const SEED = 20260922;
const FRAME = 1000 / 60;
const COLORS = [0x6c7a89, 0x4caf7a, 0x3d8bd9, 0x9b59d0, 0xe0a030, 0xe05a4a, 0xf0e050];

const app = new Application();
await app.init({ preference: "webgpu", width: 1080, height: 1080, background: 0x1b1b28, antialias: true });
document.getElementById("mount")?.appendChild(app.canvas);
console.log(`[p5] renderer=${app.renderer.name}`);

const grid = new Graphics();
for (let cell = 0; cell < SIDE * SIDE; cell++)
  grid.roundRect(ORIGIN + (cell % SIDE) * CELL + 6, ORIGIN + Math.floor(cell / SIDE) * CELL + 6, CELL - 12, CELL - 12, 18);
grid.fill(0x26263a);
const layer = new Container();
app.stage.addChild(grid, layer);

// ---- state of the page ----
let policy: Policy = "A";
let rate = 5;
let core: Core = createCore(policy, "spec");
let sim: Sim = createSim(SEED);
let script: Script | undefined;
let cursor = 0;
let clock = 0;
let deltas: number[] = [];
let work: number[] = [];

const reset = () => {
  core = createCore(policy, "spec");
  sim = createSim(SEED);
  script = undefined;
  const load = sim.load();
  core.commit(load.items, load.cause);
};

// ---- views to display objects ----
type Shown = { box: Container; body: Graphics; label: Text; level: number; kind: string };
const shown = new Map<View, Shown>();

const draw = (entry: Shown, view: View) => {
  entry.level = view.level;
  entry.body.clear().roundRect(-70, -70, 140, 140, view.item.kind === "gen" ? 70 : 26);
  entry.body.fill(view.item.kind === "gen" ? 0xd0d0e0 : (COLORS[view.level % COLORS.length] as number));
  entry.label.text = view.item.kind === "gen" ? "GEN" : String(view.level);
};

const sync = () => {
  const views = core.views();
  for (const view of views) {
    let entry = shown.get(view);
    if (!entry) {
      const body = new Graphics();
      const label = new Text({ text: "", style: { fill: 0xffffff, fontSize: 56, fontWeight: "700" } });
      label.anchor.set(0.5);
      const box = new Container();
      box.addChild(body, label);
      layer.addChild(box);
      entry = { box, body, label, level: -1, kind: view.item.kind };
      shown.set(view, entry);
    }
    if (entry.level !== view.level) draw(entry, view);
    entry.box.position.set(view.x, view.y);
    entry.box.scale.set(view.scale);
    entry.box.alpha = view.alpha;
    entry.box.zIndex = view.held ? 3 : view.exiting ? 2 : 1;
  }
  for (const [view, entry] of shown) {
    if (views.includes(view)) continue;
    entry.box.destroy({ children: true });
    shown.delete(view);
  }
  layer.sortableChildren = true;
};

const tick = (dtMs: number) => {
  if (script) {
    clock += dtMs;
    cursor = feed(core, script.events, cursor, clock);
    if (clock > script.endMs + 1500) script = undefined;
  }
  core.advance(dtMs);
  sync();
};

app.ticker.add(ticker => {
  const started = performance.now();
  tick(Math.min(ticker.deltaMS, 50));
  if (script) {
    deltas.push(ticker.deltaMS);
    work.push(performance.now() - started);
  }
});

// ---- the hand ----
let heldKey: string | undefined;
const toBoard = (event: PointerEvent) => {
  const rect = app.canvas.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * 1080, y: ((event.clientY - rect.top) / rect.height) * 1080 };
};
app.canvas.addEventListener("pointerdown", event => {
  const at = toBoard(event);
  const key = core.hitTest(at.x, at.y);
  if (!key) return;
  if (key === "gen") {
    const cell = sim.freeCell();
    if (cell === undefined) return;
    const tap = sim.tap(cell);
    core.commit(tap.items, tap.cause);
    for (const hint of tap.hints) core.hint(hint);
    return;
  }
  if (core.grab(key)) heldKey = key;
});
app.canvas.addEventListener("pointermove", event => {
  if (!heldKey) return;
  const at = toBoard(event);
  core.dragTo(heldKey, at.x, at.y);
});
app.canvas.addEventListener("pointerup", event => {
  if (!heldKey) return;
  const at = toBoard(event);
  const target = core.hitTest(at.x, at.y, heldKey);
  const key = heldKey;
  heldKey = undefined;
  core.release(key);
  if (!target || target === "gen") return;
  const merge = sim.merge(key, target);
  core.commit(merge.items, merge.cause);
  for (const hint of merge.hints) core.hint(hint);
});

// ---- buttons ----
const bar = document.getElementById("bar") as HTMLElement;
const buttons: Array<{ element: HTMLButtonElement; isOn: () => boolean }> = [];
const button = (text: string, isOn: () => boolean, run: () => void) => {
  const element = document.createElement("button");
  element.textContent = text;
  element.addEventListener("click", () => {
    run();
    for (const b of buttons) b.element.dataset.on = String(b.isOn());
  });
  bar.appendChild(element);
  buttons.push({ element, isOn });
  element.dataset.on = String(isOn());
};
for (const p of ["A", "B", "C"] as Policy[])
  button(`policy ${p}`, () => policy === p, () => {
    policy = p;
    reset();
  });
for (const r of [1, 3, 5, 8]) button(`${r}/s`, () => rate === r, () => (rate = r));
const play = () => {
  reset();
  script = buildScript(SEED, 1000 / rate);
  cursor = 0;
  clock = 0;
  deltas = [];
  work = [];
};
button("play script", () => false, play);
bar.append(" drag an item onto another to merge; click GEN to spawn");

reset();

// ---- the door for the orchestrator: fixed steps and strips ----
const p95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? 0;
const step = (ms: number) => {
  const parts = Math.max(1, Math.round(ms / FRAME));
  for (let part = 0; part < parts; part++) {
    clock += ms / parts;
    if (script) cursor = feed(core, script.events, cursor, clock);
    core.advance(ms / parts);
  }
  sync();
  app.render();
};
const load = (nextPolicy: Policy, caseNo: number) => {
  app.ticker.stop();
  policy = nextPolicy;
  core = createCore(policy, "spec");
  script = buildScript(SEED + caseNo, 200, caseNo);
  cursor = 0;
  clock = 0;
  return script.overlapAtMs;
};

Object.assign(globalThis, {
  __p5: {
    load,
    step,
    play,
    frameTimes: () => ({ frames: deltas.length, deltaP95: p95(deltas), workP95: p95(work), renderer: app.renderer.name }),
    /** 12 frames, 50 ms apart, from 50 ms before the overlap. Posted to serve.ts as shots/<name>.png. */
    async strip(nextPolicy: Policy, caseNo: number) {
      const overlapAt = load(nextPolicy, caseNo);
      step(overlapAt - 50);
      const size = 360;
      const sheet = document.createElement("canvas");
      sheet.width = size * 6;
      sheet.height = size * 2;
      const context = sheet.getContext("2d") as CanvasRenderingContext2D;
      for (let index = 0; index < 12; index++) {
        if (index > 0) step(50);
        context.drawImage(app.canvas, (index % 6) * size, Math.floor(index / 6) * size, size, size);
        context.fillStyle = "#fff";
        context.font = "20px system-ui";
        context.fillText(`${nextPolicy} case ${caseNo}  ${index * 50 - 50} ms`, (index % 6) * size + 8, Math.floor(index / 6) * size + 24);
      }
      const blob = await new Promise<Blob | null>(resolve => sheet.toBlob(resolve, "image/png"));
      if (!blob) return "no blob";
      const response = await fetch(`/shot/case${caseNo}-${nextPolicy}`, { method: "POST", body: blob });
      return response.text();
    }
  }
});
