// Spike P4. The Pixi v8 page: draws the entity table of core.ts, measures text with Pixi, exposes __p4.

import { Application, BitmapText, CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import type { Core, Entity, Layout, MeasureFn } from "./core";
import { createPixiLayout, offsetProbe } from "./layout-pixi";
import { createYogaLayout } from "./layout-yoga";
import { summarize } from "./measure";
import { LANDSCAPE, PORTRAIT, createDriver, type Driver } from "./script";
import { makeRows } from "./screens";

type AdapterName = "A" | "B";
type ScreenName = "popup" | "settings";
const SCALE = 0.5;
const SEED = 20260922;
const FONT = "system-ui, Helvetica, Arial";

const bar = document.getElementById("bar") as HTMLDivElement;
const mount = document.getElementById("mount") as HTMLDivElement;
const status = document.createElement("span");
status.id = "status";

const app = new Application();
await app.init({ preference: "webgpu", width: PORTRAIT.width * SCALE, height: PORTRAIT.height * SCALE, background: 0x151824, antialias: true });
mount.append(app.canvas);
app.ticker.stop();

// ---- text measurement through Pixi

const styleOf = (fontSize: number): TextStyle => new TextStyle({ fontFamily: FONT, fontSize, fill: 0xf0f0f0 });
const pixiMeasure: MeasureFn = (content, style) => {
  const metrics = CanvasTextMetrics.measureText(content, styleOf(style.fontSize ?? 28));
  return { width: Math.ceil(metrics.width), height: Math.ceil(metrics.height) };
};

/** Case 9, browser part: does CanvasTextMetrics apply to a BitmapText? Compare with its own width. */
const bitmapMeasure = (): { text: string; canvasWidth: number; bitmapWidth: number; delta: number } => {
  const text = "1234567";
  const canvasWidth = CanvasTextMetrics.measureText(text, styleOf(28)).width;
  const bitmap = new BitmapText({ text, style: { fontFamily: FONT, fontSize: 28 } });
  const bitmapWidth = bitmap.width;
  bitmap.destroy();
  return { text, canvasWidth, bitmapWidth, delta: Math.abs(canvasWidth - bitmapWidth) };
};

// ---- the mirror: one display object per entity

type Display = { root: Container; shape: Graphics; label: Text | BitmapText | undefined; image: Sprite | undefined; signature: string };
const displays = new Map<number, Display>();
let fightWrites = 0;
const workSamples: number[] = [];

const signatureOf = (entity: Entity): string => `${entity.abs.w}|${entity.abs.h}|${entity.flat.fill ?? ""}|${entity.flat.radius ?? ""}|${entity.flat.alpha ?? ""}`;

const paint = (display: Display, entity: Entity): void => {
  const { shape } = display;
  shape.clear();
  const fill = entity.flat.fill;
  if (fill !== undefined) shape.roundRect(0, 0, entity.abs.w, entity.abs.h, entity.flat.radius ?? 0).fill({ color: fill, alpha: entity.flat.alpha ?? 1 });
  else if (entity.type === "box" || entity.type === "list") shape.roundRect(0, 0, entity.abs.w, entity.abs.h, 0).stroke({ color: 0x334, width: 1, alpha: 0.6 });
  if (display.image) {
    display.image.width = entity.abs.w;
    display.image.height = entity.abs.h;
  }
};

const ensureDisplay = (entity: Entity): Display => {
  let display = displays.get(entity.id);
  if (display) return display;
  const root = new Container({ label: entity.key });
  const shape = new Graphics();
  root.addChild(shape);
  let label: Text | BitmapText | undefined;
  let image: Sprite | undefined;
  if (entity.type === "text") {
    const content = String(entity.props.content ?? "");
    const fontSize = entity.flat.fontSize ?? 28;
    label = entity.props.bitmap ? new BitmapText({ text: content, style: { fontFamily: FONT, fontSize, fill: 0xf0f0f0 } }) : new Text({ text: content, style: styleOf(fontSize) });
    root.addChild(label);
  }
  if (entity.type === "image") {
    image = new Sprite(Texture.WHITE);
    image.tint = 0x8a90a8;
    root.addChild(image);
  }
  display = { root, shape, label, image, signature: "" };
  displays.set(entity.id, display);
  return display;
};

const sync = (core: Core): void => {
  const t0 = performance.now();
  const order = core.drawOrder();
  const live = new Set(order.map(e => e.id));
  for (const [id, display] of displays) {
    if (live.has(id)) continue;
    display.root.destroy({ children: true });
    displays.delete(id);
  }
  app.stage.removeChildren();
  for (const entity of order) {
    const display = ensureDisplay(entity);
    const signature = signatureOf(entity);
    if (signature !== display.signature) {
      display.signature = signature;
      paint(display, entity);
    }
    if (display.label) {
      const content = String(entity.props.content ?? "");
      if (display.label.text !== content) display.label.text = content;
    }
    const { pose } = entity;
    // The picture is pose (= rect at rest + motion offset); nothing else writes the display position.
    display.root.position.set(pose.x * SCALE, pose.y * SCALE);
    display.root.scale.set(pose.scale * SCALE);
    display.root.alpha = pose.alpha;
    display.root.visible = entity.abs.w > 0 || entity.abs.h > 0;
    if (display.root.x !== pose.x * SCALE || display.root.y !== pose.y * SCALE) fightWrites++;
    app.stage.addChild(display.root);
  }
  app.renderer.render(app.stage);
  workSamples.push(performance.now() - t0);
};

// ---- drivers

// @pixi/layout keeps ONE module-global Yoga instance that every `LayoutSystem.init` (every renderer init,
// and offsetProbe) replaces with a fresh wasm instance. Nodes made before the swap can no longer be inserted
// next to nodes made after it ("BindingError: Expected null or instance of Node, got an instance of Node").
// So the probe runs once, here, before any adapter B node exists.
const offsetProbeResult = await offsetProbe();
const yogaSwapNote = "LayoutSystem.init calls setYoga(await loadYoga()): one global instance, replaced on every init; a probe after adapter B was created broke insertChild with a BindingError";

const layouts: Partial<Record<AdapterName, Layout>> = {};
const layoutFor = async (name: AdapterName): Promise<Layout> => {
  layouts[name] ??= name === "A" ? await createYogaLayout() : await createPixiLayout();
  return layouts[name] as Layout;
};

let current: { adapter: AdapterName; driver: Driver; layout: Layout } | undefined;
let landscape = false;

const resize = (): void => {
  const viewport = landscape ? LANDSCAPE : PORTRAIT;
  app.renderer.resize(viewport.width * SCALE, viewport.height * SCALE);
};

const load = async (adapter: AdapterName, screen: ScreenName): Promise<Driver> => {
  const layout = await layoutFor(adapter);
  for (const display of displays.values()) display.root.destroy({ children: true });
  displays.clear();
  fightWrites = 0;
  workSamples.length = 0;
  const driver = createDriver(layout, { measure: pixiMeasure, exitFlow: "leave", onFrame: sync });
  current = { adapter, driver, layout };
  landscape = false;
  resize();
  driver.setViewport(PORTRAIT);
  driver.state.popup = screen === "popup" ? "open" : "closed";
  driver.render();
  driver.step(2);
  setStatus(`${adapter} / ${screen}`);
  return driver;
};

const stepMs = (ms: number): void => {
  current?.driver.step(Math.max(1, Math.round(ms / (1000 / 60))));
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
};

/** Real display frames: 3 s of ticker with 100 rows and the counter ticking every frame. */
const liveFrames = async (): Promise<{ frames: number; deltaP95: number; workP95: number; entities: number; visible: boolean; source: string }> => {
  if (!current) throw new Error("load first");
  const { driver } = current;
  driver.state.rows = makeRows(100);
  driver.render();
  driver.step(2);
  const deltas: number[] = [];
  workSamples.length = 0;
  let last = performance.now();
  // A hidden pane never fires requestAnimationFrame: fall back to a timer and say so.
  const visible = document.visibilityState === "visible";
  const schedule = (fn: () => void): void => {
    if (visible) requestAnimationFrame(fn);
    else setTimeout(fn, 16);
  };
  await new Promise<void>(resolve => {
    const tick = (): void => {
      const now = performance.now();
      deltas.push(now - last);
      last = now;
      driver.state.counter++;
      driver.render();
      driver.step(1);
      if (deltas.length < 180) schedule(tick);
      else resolve();
    };
    schedule(tick);
  });
  const entities = driver.core.entities().length;
  driver.state.rows = makeRows(30);
  driver.render();
  driver.step(25);
  return { frames: deltas.length, deltaP95: percentile(deltas, 95), workP95: percentile(workSamples, 95), entities, visible, source: visible ? "requestAnimationFrame" : "setTimeout(16): pane hidden, deltas are not display frames" };
};

const play = (): void => {
  if (!current) return;
  current.driver.runAll(SEED, 10);
};

const metrics = async () => {
  if (!current) throw new Error("load first");
  const { adapter, driver, layout } = current;
  return {
    ...summarize(layout, driver, "leave", true),
    browser: {
      renderer: app.renderer.name,
      fightWrites,
      workP95: percentile(workSamples, 95),
      bitmapMeasure: bitmapMeasure(),
      bOffsetProbe: adapter === "B" ? offsetProbeResult : undefined,
      yogaSwapNote: adapter === "B" ? yogaSwapNote : undefined,
      runtimes: globalThis.__p4Runtimes ?? []
    }
  };
};

const save = async (extra: Record<string, unknown> = {}): Promise<string> => {
  if (!current) throw new Error("load first");
  const body = JSON.stringify({ ...(await metrics()), ...extra }, null, 2);
  const response = await fetch(`/metrics/${current.adapter}`, { method: "POST", body });
  return response.text();
};

/** A strip of 8 frames, 50 ms apart, posted to serve.ts as shots/case<n>-<adapter>.png. */
const strip = async (adapter: AdapterName, caseNo: 1 | 2 | 4 | 5): Promise<string> => {
  const driver = await load(adapter, caseNo === 1 || caseNo === 2 ? "popup" : "settings");
  if (caseNo === 1) {
    driver.state.popup = "closed";
    driver.render();
    driver.step(25);
    driver.state.popup = "open";
    driver.render();
  }
  if (caseNo === 2) {
    driver.step(20);
    const claim = driver.buttonIn("panel", "claim");
    if (claim) driver.core.tap(...driver.center(claim));
    driver.render();
  }
  if (caseNo === 4) {
    driver.step(2);
    driver.state.rows = driver.state.rows.filter(row => row.id !== "row-3");
    driver.render();
  }
  if (caseNo === 5) {
    landscape = true;
    resize();
    driver.setViewport(LANDSCAPE);
  }
  const w = app.canvas.width;
  const h = app.canvas.height;
  const sheet = document.createElement("canvas");
  sheet.width = w * 4;
  sheet.height = h * 2;
  const context = sheet.getContext("2d") as CanvasRenderingContext2D;
  for (let index = 0; index < 8; index++) {
    driver.step(index === 0 ? 1 : 3);
    context.drawImage(app.canvas, (index % 4) * w, Math.floor(index / 4) * h, w, h);
    context.fillStyle = "#fff";
    context.font = "16px system-ui";
    context.fillText(`${index * 50} ms`, (index % 4) * w + 8, Math.floor(index / 4) * h + 20);
  }
  const blob = await new Promise<Blob | null>(resolve => sheet.toBlob(resolve, "image/png"));
  if (!blob) return "no blob";
  const response = await fetch(`/shot/case${caseNo}-${adapter}`, { method: "POST", body: blob });
  return response.text();
};

// ---- page controls

const setStatus = (text: string): void => {
  status.textContent = text;
};
const button = (label: string, onClick: () => unknown): HTMLButtonElement => {
  const element = document.createElement("button");
  element.textContent = label;
  element.onclick = () => void Promise.resolve(onClick()).then(result => result !== undefined && setStatus(String(typeof result === "object" ? JSON.stringify(result) : result)));
  bar.append(element);
  return element;
};
button("A popup", () => load("A", "popup"));
button("A settings", () => load("A", "settings"));
button("B popup", () => load("B", "popup"));
button("B settings", () => load("B", "settings"));
button("flip", () => {
  landscape = !landscape;
  resize();
  current?.driver.setViewport(landscape ? LANDSCAPE : PORTRAIT);
  current?.driver.step(1);
});
button("step 50 ms", () => stepMs(50));
button("play script", () => {
  play();
  return "played";
});
button("live 3 s", () => liveFrames());
button("save metrics", () => save());
bar.append(status);

app.canvas.addEventListener("pointerdown", event => {
  const rect = app.canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / SCALE;
  const y = (event.clientY - rect.top) / SCALE;
  if (current?.driver.core.tap(x, y)) {
    current.driver.render();
    current.driver.step(1);
  }
});

declare global {
  // eslint-disable-next-line no-var
  var __p4: {
    load(adapter: AdapterName, screen: ScreenName): Promise<unknown>;
    step(ms: number): void;
    tap(x: number, y: number): boolean;
    flip(): void;
    play(): void;
    live(): Promise<unknown>;
    metrics(): Promise<unknown>;
    save(extra?: Record<string, unknown>): Promise<string>;
    strip(adapter: AdapterName, caseNo: 1 | 2 | 4 | 5): Promise<string>;
    frameTimes(): { workP95: number; samples: number };
  };
}

globalThis.__p4 = {
  load: async (adapter, screen) => {
    await load(adapter, screen);
    return "loaded";
  },
  step: stepMs,
  tap: (x, y) => {
    const hit = current?.driver.core.tap(x, y) ?? false;
    current?.driver.render();
    current?.driver.step(1);
    return hit;
  },
  flip: () => {
    landscape = !landscape;
    resize();
    current?.driver.setViewport(landscape ? LANDSCAPE : PORTRAIT);
    current?.driver.step(1);
  },
  play,
  live: liveFrames,
  metrics,
  save,
  strip,
  frameTimes: () => ({ workP95: percentile(workSamples, 95), samples: workSamples.length })
};

await load("A", "settings");
setStatus(`ready on ${app.renderer.name}; runtimes: ${(globalThis.__p4Runtimes ?? []).join(", ")}`);
