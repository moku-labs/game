// Spike P10. The browser page: correctness of each filter under WebGPU, cost per scenario,
// churn under toggles. drive.ts calls window.p10.* through Playwright.

import { Application, BlurFilter, Container, DisplacementFilter, type Filter, RenderTexture, Sprite, Texture, TexturePool, type UniformGroup, type WebGPURenderer } from "pixi.js";
import { createFilter, type Descriptor, type FilterSlot, stats, syncFilters, syncFiltersPooled, writeFilter } from "./filters";
import { gpu, installGpuCounters, snapshot } from "./gpu-count";

installGpuCounters();

const W = 1080;
const H = 1920;
let app: Application;
let renderer: WebGPURenderer;
const warnings: string[] = [];

const origWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" ").slice(0, 300));
  origWarn(...args);
};

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return +(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0).toFixed(3);
};
const round = (x: number, d = 3) => +x.toFixed(d);
const done = () => (renderer as unknown as { gpu: { device: GPUDevice } }).gpu.device.queue.onSubmittedWorkDone();
const raf = () => new Promise<number>(r => requestAnimationFrame(r));

function makeTextures() {
  const bg = document.createElement("canvas");
  bg.width = W;
  bg.height = H;
  const g = bg.getContext("2d") as CanvasRenderingContext2D;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#1b2a6b");
  grad.addColorStop(1, "#8a2b5e");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `hsl(${(i * 37) % 360} 70% 60%)`;
    g.fillRect((i * 97) % W, (i * 211) % H, 24, 24);
  }
  const btn = document.createElement("canvas");
  btn.width = 256;
  btn.height = 256;
  const b = btn.getContext("2d") as CanvasRenderingContext2D;
  b.fillStyle = "#3fa9f5";
  b.beginPath();
  b.roundRect(32, 64, 192, 128, 32);
  b.fill();
  b.fillStyle = "#fff";
  b.font = "bold 48px sans-serif";
  b.fillText("PLAY", 72, 146);
  const noise = document.createElement("canvas");
  noise.width = 128;
  noise.height = 128;
  const n = noise.getContext("2d") as CanvasRenderingContext2D;
  for (let i = 0; i < 128 * 128; i += 7) {
    n.fillStyle = `rgb(${(i * 13) % 256},${(i * 29) % 256},128)`;
    n.fillRect(i % 128, Math.floor(i / 128), 4, 4);
  }
  return { bg: Texture.from(bg), btn: Texture.from(btn), noise: Texture.from(noise) };
}

let tex: ReturnType<typeof makeTextures>;

async function setup() {
  app = new Application();
  await app.init({ preference: "webgpu", width: W, height: H, resolution: 1, antialias: false, autoStart: false, background: "#101018" });
  renderer = app.renderer as WebGPURenderer;
  document.body.appendChild(app.canvas);
  tex = makeTextures();
  const adapter = (renderer as unknown as { gpu: { adapter: GPUAdapter } }).gpu.adapter;
  return {
    rendererType: renderer.type === 2 ? "webgpu" : renderer.type === 1 ? "webgl" : String(renderer.type),
    rendererName: renderer.name,
    adapter: { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, description: adapter.info?.description },
    hasGl: typeof WebGL2RenderingContext !== "undefined",
    userAgent: navigator.userAgent
  };
}

// ---------- 1 + 2: does each filter run under WebGPU ----------

function readPixels(target: RenderTexture) {
  return renderer.extract.pixels(target).pixels as Uint8ClampedArray;
}

function diffEnergy(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let e = 0;
  for (let i = 0; i < a.length; i++) e += Math.abs((a[i] as number) - (b[i] as number));
  return Math.round(e / 255);
}

function diffCount(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs((a[i] as number) - (b[i] as number)) > 8 || Math.abs((a[i + 1] as number) - (b[i + 1] as number)) > 8 || Math.abs((a[i + 2] as number) - (b[i + 2] as number)) > 8 || Math.abs((a[i + 3] as number) - (b[i + 3] as number)) > 8) n++;
  }
  return n;
}

async function checkFilters() {
  const rt = RenderTexture.create({ width: 512, height: 512 });
  const stage = new Container();
  const sprite = new Sprite(tex.btn);
  sprite.position.set(128, 128);
  stage.addChild(sprite);
  const render = () => renderer.render({ container: stage, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
  render();
  await done();
  const base = readPixels(rt);

  const kinds: Descriptor[] = [
    { kind: "alpha", alpha: 0.5 },
    { kind: "blur", strength: 8 },
    { kind: "colorMatrix" },
    { kind: "displacement" },
    { kind: "noise", noise: 0.5 },
    { kind: "pfGlow", strength: 4, distance: 10 },
    { kind: "pfOutline", thickness: 4 },
    { kind: "pfDropShadow" },
    { kind: "glow", uStrength: 4, uRadius: 12 },
    { kind: "tint", uAmount: 1 }
  ];
  const rows = [];
  for (const d of kinds) {
    const w0 = warnings.length;
    const p0 = gpu.renderPasses;
    let row: Record<string, unknown> = { kind: d.kind };
    try {
      let f: Filter;
      if (d.kind === "displacement") {
        const map = new Sprite(tex.noise);
        stage.addChild(map);
        map.renderable = false;
        f = new DisplacementFilter({ sprite: map, scale: 30 });
      } else f = createFilter(d);
      sprite.filters = [f];
      render();
      await done();
      const passes = gpu.renderPasses - p0;
      const px = readPixels(rt);
      row = {
        kind: d.kind,
        hasGpuProgram: !!f.gpuProgram,
        hasGlProgram: !!f.glProgram,
        compatibleRenderers: f.compatibleRenderers,
        padding: f.padding,
        changedPixels: diffCount(base, px),
        renderPasses: passes,
        warnings: warnings.slice(w0)
      };
      sprite.filters = null;
      f.destroy();
    } catch (e) {
      row.error = String(e);
    }
    rows.push(row);
  }

  // Uniform tween: the same instance, the value written between two renders, no update() call.
  const glow = createFilter({ kind: "glow", uStrength: 0, uRadius: 12 });
  sprite.filters = [glow];
  const shots: number[] = [];
  const energy: number[] = [];
  for (const s of [0, 1, 2, 4]) {
    writeFilter(glow, { kind: "glow", uStrength: s });
    render();
    await done();
    const px = readPixels(rt);
    shots.push(diffCount(base, px));
    energy.push(diffEnergy(base, px));
  }
  // isStatic: true needs update(); without it the value written is not uploaded.
  const ug = glow.resources.fu as UniformGroup;
  ug.isStatic = true;
  writeFilter(glow, { kind: "glow", uStrength: 0 });
  render();
  await done();
  const staticNoUpdate = diffCount(base, readPixels(rt));
  ug.update();
  render();
  await done();
  const staticWithUpdate = diffCount(base, readPixels(rt));
  ug.isStatic = false;
  sprite.filters = null;
  glow.destroy();
  rt.destroy(true);
  return {
    rows,
    tween: { strengths: [0, 1, 2, 4], changedPixels: shots, diffEnergy: energy },
    isStatic: { afterWriteNoUpdate: staticNoUpdate, afterUpdate: staticWithUpdate, note: "strength 4 then 0; nonzero without update means the old value stayed on the GPU" }
  };
}

// ---------- 3: cost ----------

type Scene = { stage: Container; tick: (t: number) => void; dispose: () => void };

function buttonsGrid(n: number, parent: Container) {
  const out: Sprite[] = [];
  for (let i = 0; i < n; i++) {
    const s = new Sprite(tex.btn);
    s.position.set(40 + (i % 3) * 340, 300 + Math.floor(i / 3) * 320);
    parent.addChild(s);
    out.push(s);
  }
  return out;
}

function backdrop(parent: Container) {
  const s = new Sprite(tex.bg);
  parent.addChild(s);
  return s;
}

/** Every scene has the same content: one full-screen backdrop and 10 buttons. Only filters differ. */
function buildScene(name: string): Scene {
  const stage = new Container();
  const back = new Container();
  stage.addChild(back);
  const backs = [backdrop(back)];
  const ui = new Container();
  stage.addChild(ui);
  const buttons = buttonsGrid(10, ui);
  const filters: Filter[] = [];
  const add = (f: Filter) => (filters.push(f), f);
  let tick: (t: number) => void = () => {};

  const m = name.match(/^(\w+?)-(\d+)(?:-(.*))?$/);
  const kind = m?.[1] ?? name;
  const n = Number(m?.[2] ?? 0);
  const variant = m?.[3] ?? "";

  if (kind === "glow" || kind === "pfglow" || kind === "tint" || kind === "disabled") {
    for (let i = 0; i < n; i++) {
      const d: Descriptor = kind === "pfglow" ? { kind: "pfGlow", strength: 2, distance: 10 } : kind === "tint" ? { kind: "tint", uAmount: 0.5 } : { kind: "glow", uStrength: 2, uRadius: 12 };
      const f = add(createFilter(d));
      if (variant === "pad48") f.padding = 48;
      if (kind === "disabled") f.enabled = false;
      (buttons[i] as Sprite).filters = [f];
    }
    tick = t => {
      const s = 2 + Math.sin(t / 200);
      for (const f of filters) writeFilter(f, kind === "pfglow" ? { kind: "pfGlow", strength: s } : kind === "tint" ? { kind: "tint", uAmount: s / 3 } : { kind: "glow", uStrength: s });
    };
  } else if (kind === "chain") {
    // two filters in one list on each of n buttons
    for (let i = 0; i < n; i++) {
      const a = add(createFilter({ kind: "glow", uStrength: 2, uRadius: 12 }));
      const b = add(createFilter({ kind: "tint", uAmount: 0.3 }));
      (buttons[i] as Sprite).filters = [a, b];
    }
  } else if (kind === "glowparent") {
    const f = add(createFilter({ kind: "glow", uStrength: 2, uRadius: 12 }));
    ui.filters = [f];
    tick = t => writeFilter(f, { kind: "glow", uStrength: 2 + Math.sin(t / 200) });
  } else if (kind === "blur") {
    // n full-screen backdrops, each with its own blur
    for (let i = 1; i < n; i++) backs.push(backdrop(back));
    for (const b of backs) {
      const f = add(new BlurFilter({ strength: 8, quality: variant === "q1" ? 1 : 4, resolution: variant === "res05" ? 0.5 : 1 }));
      if (variant === "edge") (f as BlurFilter).repeatEdgePixels = true;
      b.filters = [f];
    }
    tick = t => {
      for (const f of filters) (f as BlurFilter).strength = 8 + 2 * Math.sin(t / 300);
    };
  } else if (kind === "blurarea") {
    // a blurred panel behind a popup: filterArea limits the pass to 1080x640
    const f = add(new BlurFilter({ strength: 8, quality: 4 }));
    back.filters = [f];
    if (variant !== "full") back.filterArea = { x: 0, y: 640, width: W, height: 640 } as never;
  }
  return {
    stage,
    tick,
    dispose: () => {
      stage.destroy({ children: true });
      for (const f of filters) f.destroy();
    }
  };
}

async function bench(name: string, opts: { throughputFrames?: number; rafFrames?: number } = {}) {
  const K = opts.throughputFrames ?? 200;
  const R = opts.rafFrames ?? 240;
  const rt0 = new Map(gpu.rtSizes);
  const mb0 = gpu.liveTextureBytes;
  const scene = buildScene(name);
  const render = () => renderer.render({ container: scene.stage });
  // warm-up: pipelines, pool textures, bind groups
  for (let i = 0; i < 30; i++) {
    scene.tick(i * 16);
    render();
  }
  await done();

  // throughput: K frames back to back, then wait for the GPU. GPU-bound ms per frame. 5 repeats.
  const g0 = snapshot();
  const cpu: number[] = [];
  const reps: number[] = [];
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    for (let i = 0; i < K; i++) {
      scene.tick(i * 16);
      const a = performance.now();
      render();
      cpu.push(performance.now() - a);
    }
    await done();
    reps.push((performance.now() - t0) / K);
  }
  const g1 = snapshot();
  const KK = K * 5;

  // rAF loop: real frames at the display rate, GPU completion latency per frame
  const deltas: number[] = [];
  const lat: number[] = [];
  const rafCpu: number[] = [];
  let last = await raf();
  for (let i = 0; i < R; i++) {
    const now = await raf();
    deltas.push(now - last);
    last = now;
    scene.tick(now);
    const a = performance.now();
    render();
    rafCpu.push(performance.now() - a);
    const submitted = performance.now();
    void done().then(() => lat.push(performance.now() - submitted));
  }
  await done();
  scene.dispose();
  await done();
  return {
    name,
    throughputMsPerFrame: { median: pct(reps, 50), min: pct(reps, 0), max: pct(reps, 100) },
    rtCreated: Object.fromEntries([...gpu.rtSizes].filter(([k, v]) => v !== (rt0.get(k) ?? 0)).map(([k, v]) => [k, v - (rt0.get(k) ?? 0)])),
    liveTextureMBDelta: round((gpu.liveTextureBytes - mb0) / 1048576, 1),
    renderCpuMs: { p50: pct(cpu, 50), p95: pct(cpu, 95) },
    perFrame: {
      renderPasses: round((g1.renderPasses - g0.renderPasses) / KK, 2),
      writeBuffer: round((g1.writeBuffer - g0.writeBuffer) / KK, 2),
      writeBufferBytes: round((g1.writeBufferBytes - g0.writeBufferBytes) / KK, 0),
      bindGroupsCreated: round((g1.bindGroups - g0.bindGroups) / KK, 2),
      texturesCreated: round((g1.texturesCreated - g0.texturesCreated) / KK, 2)
    },
    raf: { deltaP50: pct(deltas, 50), deltaP95: pct(deltas, 95), renderCpuP95: pct(rafCpu, 95), gpuDoneLatencyP50: pct(lat, 50), gpuDoneLatencyP95: pct(lat, 95) }
  };
}

// ---------- 4: churn ----------

function poolCount() {
  const buckets = (TexturePool as unknown as { _buckets: Map<number, unknown[]> })._buckets;
  let n = 0;
  for (const b of buckets.values()) n += b.length;
  return { buckets: buckets.size, idleTextures: n };
}

async function heap() {
  (window as unknown as { gc?: () => void }).gc?.();
  await new Promise(r => setTimeout(r, 50));
  (window as unknown as { gc?: () => void }).gc?.();
  return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? -1;
}

const LISTS: Descriptor[][] = [
  [],
  [{ kind: "glow", uStrength: 2 }],
  [{ kind: "glow", uStrength: 2 }, { kind: "tint", uAmount: 0.3 }],
  [{ kind: "tint", uAmount: 0.6 }],
  [{ kind: "blur", strength: 6 }],
  [{ kind: "tint", uAmount: 0.4 }, { kind: "glow", uStrength: 1 }, { kind: "blur", strength: 4 }]
];

async function toggle(mode: "pooled" | "slot" | "slotFree" | "enabled" | "onoff" | "steady", iterations = 1000) {
  const bg0 = gpu.bindGroups;
  stats.freeBuffers = mode === "slotFree";
  const stage = new Container();
  backdrop(stage);
  const buttons = buttonsGrid(10, stage);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const slots: FilterSlot[] = buttons.map(() => ({ kinds: [], instances: [] }));
  const pools = buttons.map(() => new Map<string, Filter>());
  const keys = buttons.map(() => ({ key: "" }));
  const fixed = buttons.map(() => [createFilter({ kind: "glow", uStrength: 2 }), createFilter({ kind: "tint", uAmount: 0.3 })]);
  if (mode === "enabled" || mode === "steady") buttons.forEach((b, i) => (b.filters = fixed[i] as Filter[]));
  const render = () => renderer.render({ container: stage });

  const step = (i: number) => {
    buttons.forEach((b, j) => {
      if (mode === "pooled") syncFiltersPooled(b, pools[j] as Map<string, Filter>, keys[j] as { key: string }, LISTS[Math.floor(rnd() * LISTS.length)] as Descriptor[]);
      else if (mode === "slot" || mode === "slotFree") syncFilters(b, slots[j] as FilterSlot, LISTS[Math.floor(rnd() * LISTS.length)] as Descriptor[]);
      else if (mode === "enabled") for (const f of fixed[j] as Filter[]) f.enabled = rnd() < 0.5;
      else if (mode === "onoff") b.filters = (i + j) % 2 === 0 ? null : [(fixed[j] as Filter[])[0] as Filter];
      else for (const f of fixed[j] as Filter[]) writeFilter(f, { kind: "glow", uStrength: 2 + Math.sin(i / 20) });
    });
  };

  // warm-up so the first allocations of every list are already done
  for (let i = 0; i < 60; i++) {
    step(i);
    render();
  }
  await done();
  const h0 = await heap();
  const g0 = snapshot();
  const p0 = poolCount();
  const s0 = { ...stats };
  const cpu: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const a = performance.now();
    step(i);
    render();
    cpu.push(performance.now() - a);
    if (i % 50 === 49) await done();
  }
  await done();
  const h1 = await heap();
  const g1 = snapshot();
  const p1 = poolCount();
  // dispose and check what returns
  stage.destroy({ children: true });
  for (const s of slots) for (const f of s.instances) f.destroy();
  for (const p of pools) for (const f of p.values()) f.destroy();
  for (const fs of fixed) for (const f of fs) f.destroy();
  renderer.render({ container: new Container() });
  await done();
  const g2 = snapshot();
  return {
    mode,
    iterations,
    stepPlusRenderCpuMs: { p50: pct(cpu, 50), p95: pct(cpu, 95), max: pct(cpu, 100) },
    heapDeltaKB: h0 > 0 ? round((h1 - h0) / 1024, 1) : null,
    heapBeforeMB: round(h0 / 1048576, 2),
    filtersCreated: stats.created - s0.created,
    filterListAssigns: stats.assigns - s0.assigns,
    gpuDuring: {
      texturesCreated: g1.texturesCreated - g0.texturesCreated,
      texturesDestroyed: g1.texturesDestroyed - g0.texturesDestroyed,
      liveTexturesBefore: g0.liveTextures,
      liveTexturesAfter: g1.liveTextures,
      liveTextureMBAfter: round(g1.liveTextureBytes / 1048576, 1),
      bindGroupsCreated: g1.bindGroups - g0.bindGroups,
      buffersCreated: g1.buffersCreated - g0.buffersCreated,
      liveBuffersBefore: g0.liveBuffers,
      liveBuffersAfter: g1.liveBuffers,
      pipelinesCreated: g1.pipelines - g0.pipelines,
      shaderModulesCreated: g1.shaderModules - g0.shaderModules
    },
    pool: { before: p0, after: p1 },
    afterDispose: { liveTextures: g2.liveTextures, liveBuffers: g2.liveBuffers },
    bindGroupsIncludingWarmup: g1.bindGroups - bg0
  };
}

/** Renders an empty stage at the display rate for `seconds`, then reports live GPU buffers: does Pixi's GC free them? */
async function waitGc(seconds: number) {
  const before = snapshot();
  const stage = new Container();
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    await raf();
    renderer.render({ container: stage });
  }
  await done();
  const after = snapshot();
  return { seconds, liveBuffersBefore: before.liveBuffers, liveBuffersAfter: after.liveBuffers, liveTexturesBefore: before.liveTextures, liveTexturesAfter: after.liveTextures, heapMB: round((await heap()) / 1048576, 2) };
}

/** A WGSL typo: what does the developer see, and does the rest of the frame still render? */
async function brokenFilter() {
  const { defineFilter, HEADER_FOR_TEST } = await import("./filters");
  const errors: string[] = [];
  const device = (renderer as unknown as { gpu: { device: GPUDevice } }).gpu.device;
  gpu.device = device;
  device.addEventListener("uncapturederror", e => errors.push(String((e as GPUUncapturedErrorEvent).error.message).slice(0, 300)));
  const bad = "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.uMissing; }";
  // what a dev-time check in defineFilter could do before Pixi ever sees the source
  const module = device.createShaderModule({ code: `${HEADER_FOR_TEST}\nstruct FilterUniforms { uAmount: f32, };\n@group(1) @binding(0) var<uniform> fu: FilterUniforms;\n${bad}` });
  const info = await module.getCompilationInfo();
  defineFilter("broken", { uniforms: { uAmount: { type: "f32", value: 1 } }, wgsl: bad });
  const rt = RenderTexture.create({ width: 512, height: 512 });
  const stage = new Container();
  const ok = new Sprite(tex.btn);
  const hurt = new Sprite(tex.btn);
  hurt.position.set(256, 256);
  stage.addChild(ok, hurt);
  let thrown = "";
  try {
    hurt.filters = [createFilter({ kind: "broken" })];
    for (let i = 0; i < 3; i++) renderer.render({ container: stage, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
    await done();
  } catch (e) {
    thrown = String(e).slice(0, 300);
  }
  await new Promise(r => setTimeout(r, 200));
  const px = readPixels(rt);
  // alpha at the centre of the healthy sprite (128,128) and of the broken one (384,384)
  const at = (x: number, y: number) => px[(y * 512 + x) * 4 + 3];
  return {
    compilationInfo: info.messages.map(m => `${m.type} ${m.lineNum}:${m.linePos} ${m.message}`),
    uncapturedErrors: errors.slice(0, 5),
    uncapturedErrorCount: errors.length,
    thrown,
    healthySpriteAlpha: at(128, 128),
    brokenSpriteAlpha: at(384, 384),
    warnings: warnings.slice(-5)
  };
}

function rtSizes() {
  return Object.fromEntries(gpu.rtSizes);
}

/** Pool texture sizes for a filtered 256 px button and a full-screen backdrop. */
function poolSizes() {
  return {
    button256pad16: TexturePool.getOptimalSize(256 + 32, 256 + 32, 1),
    button256pad0: TexturePool.getOptimalSize(256, 256, 1),
    fullScreen: TexturePool.getOptimalSize(W, H, 1),
    fullScreenRes05: TexturePool.getOptimalSize(W, H, 0.5),
    panel1080x640: TexturePool.getOptimalSize(W, 640, 1)
  };
}

(window as unknown as { p10: unknown }).p10 = { brokenFilter, waitGc, setup, checkFilters, bench, toggle, snapshot, rtSizes, poolSizes, warnings: () => warnings };
(window as unknown as { p10ready: boolean }).p10ready = true;
