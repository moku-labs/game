// Spike P9. The browser page: WebGPU renderer, our own rAF clock, no Pixi ticker.
// bun serve.ts, then http://localhost:3059 ; measure.ts drives window.p9 through Playwright.

import {
  autoDetectRenderer,
  Container,
  Culler,
  Particle,
  ParticleContainer,
  Rectangle,
  RenderTexture,
  Sprite,
  Texture
} from "pixi.js";
import { createEmitter, type EmitterConfig } from "./emitter";

const W = 390;
const H = 844;

// ---- atlases drawn into canvases: page A for particles, page B for board sprites ----
const drawAtlasA = () => {
  const c = document.createElement("canvas");
  c.width = 384;
  c.height = 64;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#fff";
  // 0 star
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 30 : 12;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  g.fill();
  // 1 soft circle
  const grad = g.createRadialGradient(96, 32, 0, 96, 32, 30);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(64, 0, 64, 64);
  // 2 spark
  g.fillStyle = "#fff";
  g.fillRect(128 + 28, 4, 8, 56);
  g.fillRect(128 + 4, 28, 56, 8);
  // 3 diamond
  g.beginPath();
  g.moveTo(224, 4);
  g.lineTo(252, 32);
  g.lineTo(224, 60);
  g.lineTo(196, 32);
  g.fill();
  // 4 solid square (for pixel checks), one empty frame away: linear sampling at a frame edge reads the neighbour texel
  g.fillRect(320, 0, 64, 64);
  return c;
};

const drawAtlasB = () => {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = "#e03030";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#3050e0";
  g.fillRect(128, 0, 128, 128);
  return c;
};

const pageA = Texture.from(drawAtlasA());
const pageB = Texture.from(drawAtlasB());
const frame = (page: Texture, x: number, y: number, w: number, h: number) =>
  new Texture({ source: page.source, frame: new Rectangle(x, y, w, h) });
const particleFrames = [0, 1, 2, 3].map(i => frame(pageA, i * 64, 0, 64, 64));
const solidA = frame(pageA, 320, 0, 64, 64);
const redTile = frame(pageB, 0, 0, 128, 128);
const blueTile = frame(pageB, 128, 0, 128, 128);

// ---- renderer, created directly: no Application, so no ticker exists ----
const renderer = await autoDetectRenderer({
  preference: "webgpu",
  width: W,
  height: H,
  resolution: window.devicePixelRatio,
  autoDensity: true,
  background: 0x15151f,
  antialias: false
});
document.body.appendChild(renderer.canvas);
const adapter = await navigator.gpu?.requestAdapter();
const adapterInfo = adapter?.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } : null;

// draw-call counter on the WebGPU pass encoder
let draws = 0;
const proto = GPURenderPassEncoder.prototype;
const origIndexed = proto.drawIndexed;
const origDraw = proto.draw;
proto.drawIndexed = function (...args: Parameters<typeof origIndexed>) {
  draws++;
  return origIndexed.apply(this, args);
};
proto.draw = function (...args: Parameters<typeof origDraw>) {
  draws++;
  return origDraw.apply(this, args);
};

const board = () => {
  const layer = new Container();
  for (let i = 0; i < 81; i++) {
    const s = new Sprite(i % 2 ? redTile : blueTile);
    s.width = 40;
    s.height = 40;
    s.x = 15 + (i % 9) * 40;
    s.y = 240 + Math.floor(i / 9) * 40;
    s.alpha = 0.35;
    layer.addChild(s);
  }
  return layer;
};

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const stats = (values: number[]) => ({
  p50: r2(percentile(values, 50)),
  p95: r2(percentile(values, 95)),
  max: r2(Math.max(0, ...values)),
  mean: r2(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length))
});

const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));

type Mode = "position" | "full" | "position-nochurn";

// typed as a plain record: Pixi's option type is `ParticleProperties & Record<string, boolean>`, which a
// `ParticleProperties` value does not satisfy under exactOptionalPropertyTypes
const DYNAMIC: Record<Mode, Record<string, boolean>> = {
  position: { position: true },
  "position-nochurn": { position: true },
  full: { position: true, vertex: true, rotation: true, color: true }
};

const loadConfig = (mode: Mode, target: number, size: number): EmitterConfig => {
  const base: EmitterConfig = {
    scale: size,
    maxParticles: target,
    rate: target / 2, // mean lifetime 2 s -> about `target` live
    lifetimeMs: [1500, 2500],
    speed: [40, 260],
    angle: [0, Math.PI * 2],
    gravity: { x: 0, y: 120 },
    drag: 0.4,
    spinRadPerS: [0, 0],
    shape: { kind: "circle", radius: 120 },
    textures: particleFrames,
    seed: 9
  };
  if (mode === "full")
    return {
      ...base,
      spinRadPerS: [-4, 4],
      // mean over life about `size`, so fill rate matches the position-only runs
      scale: [
        [0, size * 0.5],
        [0.2, size * 1.5],
        [1, size * 0.8]
      ],
      alpha: [
        [0, 1],
        [0.7, 0.9],
        [1, 0]
      ],
      tint: [
        [0, 0xffe080],
        [0.5, 0xffffff],
        [1, 0xff6020]
      ]
    };
  if (mode === "position-nochurn")
    return { ...base, rate: 0, lifetimeMs: [1e12, 1e12], gravity: { x: 0, y: 0 }, drag: 0, speed: [5, 20], shape: { kind: "circle", radius: 380 } };
  return base;
};

/** Steady load: about `target` live particles, measured over `frames` frames of our own rAF loop. */
async function runLoad(mode: Mode, target: number, size = 0.3, frames = 240, capMs = 8000) {
  const stage = new Container();
  stage.addChild(board());
  const pc = new ParticleContainer({ dynamicProperties: DYNAMIC[mode], texture: particleFrames[0] as Texture });
  pc.blendMode = "add";
  stage.addChild(pc);
  const emitter = createEmitter(pc, loadConfig(mode, target, size));
  emitter.moveTo(W / 2, H / 2);

  // prewarm: fill to steady state without rendering
  if (mode === "position-nochurn") emitter.burst(target, W / 2, H / 2);
  else for (let t = 0; t < 3000; t += 16) emitter.step(16);
  renderer.render(stage);
  await nextFrame();

  const step: number[] = [];
  const render: number[] = [];
  const cpu: number[] = [];
  const delta: number[] = [];
  const gpuDone: number[] = [];
  const live: number[] = [];
  const device = (renderer as unknown as { gpu?: { device: GPUDevice } }).gpu?.device;
  let last = await nextFrame();
  const start = performance.now();
  for (let f = 0; f < frames && performance.now() - start < capMs; f++) {
    const now = await nextFrame();
    const dt = Math.min(now - last, 50);
    delta.push(now - last);
    last = now;
    const t0 = performance.now();
    live.push(emitter.step(dt));
    const t1 = performance.now();
    renderer.render(stage);
    const t2 = performance.now();
    step.push(t1 - t0);
    render.push(t2 - t1);
    cpu.push(t2 - t0);
    if (device && f % 10 === 0) device.queue.onSubmittedWorkDone().then(() => gpuDone.push(performance.now() - t2));
  }
  await new Promise(r => setTimeout(r, 100));
  stage.destroy({ children: true });
  return {
    mode,
    target,
    particleCssPx: Math.round(64 * size),
    frames: step.length,
    live: stats(live),
    stepMs: stats(step),
    renderCallMs: stats(render),
    cpuFrameMs: stats(cpu),
    rafDeltaMs: stats(delta),
    over16_7: r2(delta.filter(d => d > 17.5).length / Math.max(1, delta.length)),
    gpuDoneAfterSubmitMs: stats(gpuDone),
    dropped: emitter.dropped
  };
}

/** The merge "stars burst" effect. */
const starsConfig: EmitterConfig = {
  maxParticles: 512,
  rate: 0,
  lifetimeMs: [600, 900],
  speed: [150, 420],
  angle: [0, Math.PI * 2],
  gravity: { x: 0, y: 600 },
  drag: 2,
  spinRadPerS: [-6, 6],
  shape: { kind: "ring", inner: 10, outer: 24 },
  textures: [particleFrames[0] as Texture, particleFrames[3] as Texture],
  scale: [
    [0, 0.2],
    [0.15, 0.7],
    [1, 0]
  ],
  alpha: [
    [0, 1],
    [0.6, 1],
    [1, 0]
  ],
  tint: [
    [0, 0xffd040],
    [0.4, 0xffffff],
    [1, 0xff8020]
  ],
  seed: 42
};

/** Merge effect: 3 simultaneous bursts of 40 stars every second, over the board. */
async function runBursts(frames = 600, perBurst = 40, bursts = 3) {
  const stage = new Container();
  stage.addChild(board());
  const pc = new ParticleContainer({
    dynamicProperties: DYNAMIC.full,
    texture: particleFrames[0] as Texture
  });
  pc.blendMode = "add";
  stage.addChild(pc);
  const emitter = createEmitter(pc, starsConfig);

  const idle = { step: [] as number[], render: [] as number[] };
  const busy = { step: [] as number[], render: [] as number[], live: [] as number[] };
  const spawnMs: number[] = [];
  const delta: number[] = [];
  let last = await nextFrame();
  let clock = 0;
  let nextBurst = 500;
  for (let f = 0; f < frames; f++) {
    const now = await nextFrame();
    const dt = Math.min(now - last, 50);
    delta.push(now - last);
    last = now;
    clock += dt;
    if (clock >= nextBurst) {
      nextBurst += 1000;
      const s0 = performance.now();
      for (let b = 0; b < bursts; b++) emitter.burst(perBurst, 100 + b * 95, 300 + b * 120);
      spawnMs.push(performance.now() - s0);
    }
    const t0 = performance.now();
    const n = emitter.step(dt);
    const t1 = performance.now();
    renderer.render(stage);
    const t2 = performance.now();
    if (n === 0) {
      idle.step.push(t1 - t0);
      idle.render.push(t2 - t1);
    } else {
      busy.step.push(t1 - t0);
      busy.render.push(t2 - t1);
      busy.live.push(n);
    }
  }
  stage.destroy({ children: true });
  return {
    perBurst,
    bursts,
    framesIdle: idle.step.length,
    framesBusy: busy.step.length,
    liveWhileBusy: stats(busy.live),
    spawnCallMs: stats(spawnMs),
    stepMsBusy: stats(busy.step),
    stepMsIdle: stats(idle.step),
    renderCallMsBusy: stats(busy.render),
    renderCallMsIdle: stats(idle.render),
    rafDeltaMs: stats(delta)
  };
}

/**
 * Correctness: the same emitter state drawn by ParticleContainer and by a mirror of plain Sprites.
 * Counts pixels that differ, and pixels that differ between two renders of the same state.
 */
async function artifactTest(dynamic: "full" | "position" = "full", checkpoints = [3, 8, 15, 25, 40, 60]) {
  const RW = 390;
  const RH = 600;
  const stage = new Container();
  const pc = new ParticleContainer({ dynamicProperties: DYNAMIC[dynamic], texture: particleFrames[0] as Texture });
  pc.blendMode = "add";
  stage.addChild(pc);
  const cfg: EmitterConfig = dynamic === "full" ? starsConfig : { ...starsConfig, scale: 0.5, alpha: undefined as never, tint: undefined as never, spinRadPerS: [0, 0] };
  const emitter = createEmitter(pc, cfg);
  const rt = RenderTexture.create({ width: RW, height: RH, resolution: 1 });
  const grab = (container: Container) => {
    renderer.render({ container, target: rt, clearColor: [0, 0, 0, 1] });
    return new Uint8Array(renderer.extract.pixels(rt).pixels);
  };
  const diff = (a: Uint8Array, b: Uint8Array) => {
    let n = 0;
    for (let i = 0; i < a.length; i += 4)
      if (Math.abs((a[i] as number) - (b[i] as number)) > 40 || Math.abs((a[i + 1] as number) - (b[i + 1] as number)) > 40 || Math.abs((a[i + 2] as number) - (b[i + 2] as number)) > 40) n++;
    return n;
  };
  const mirror = () => {
    const c = new Container();
    for (const p of pc.particleChildren as Particle[]) {
      const s = new Sprite(p.texture);
      s.anchor.set(p.anchorX, p.anchorY);
      s.position.set(p.x, p.y);
      s.scale.set(p.scaleX, p.scaleY);
      s.rotation = p.rotation;
      const bgr = p.color & 0xffffff;
      s.tint = ((bgr & 0xff) << 16) | (bgr & 0xff00) | ((bgr >> 16) & 0xff);
      s.alpha = (p.color >>> 24) / 255;
      s.blendMode = "add";
      c.addChild(s);
    }
    return c;
  };

  const rows: Record<string, number>[] = [];
  emitter.burst(40, 100, 200);
  emitter.burst(40, 195, 320);
  emitter.burst(40, 290, 440);
  for (let f = 1; f <= Math.max(...checkpoints); f++) {
    emitter.step(1000 / 60);
    renderer.render(stage); // the live render to the canvas, as in a game frame
    if (!checkpoints.includes(f)) continue;
    const a = grab(stage);
    const b = grab(stage);
    const m = mirror();
    const ref = grab(m);
    m.destroy({ children: true });
    let lit = 0;
    for (let i = 0; i < a.length; i += 4) if ((a[i] as number) + (a[i + 1] as number) + (a[i + 2] as number) > 30) lit++;
    rows.push({ frame: f, live: emitter.live, litPixels: lit, diffVsSprites: diff(a, ref), diffRenderTwice: diff(a, b) });
  }
  rt.destroy(true);
  stage.destroy({ children: true });
  return { dynamic, rows };
}

/** Steps the stars burst with real frames, returns the canvas as a PNG data URL read right after the last render. */
async function burstCanvas(frames = 12) {
  const stage = new Container();
  stage.addChild(board());
  const pc = new ParticleContainer({ dynamicProperties: DYNAMIC.full, texture: particleFrames[0] as Texture });
  pc.blendMode = "add";
  stage.addChild(pc);
  const emitter = createEmitter(pc, starsConfig);
  for (let b = 0; b < 3; b++) emitter.burst(40, 100 + b * 95, 300 + b * 120);
  let url = "";
  for (let f = 0; f < frames; f++) {
    await nextFrame();
    emitter.step(1000 / 60);
    renderer.render(stage);
    if (f === frames - 1) url = renderer.canvas.toDataURL("image/png");
  }
  // the same state drawn by plain Sprites, on the canvas
  const mirror = new Container();
  for (const p of pc.particleChildren as Particle[]) {
    const s = new Sprite(p.texture);
    s.anchor.set(p.anchorX, p.anchorY);
    s.position.set(p.x, p.y);
    s.scale.set(p.scaleX, p.scaleY);
    s.rotation = p.rotation;
    const bgr = p.color & 0xffffff;
    s.tint = ((bgr & 0xff) << 16) | (bgr & 0xff00) | ((bgr >> 16) & 0xff);
    s.alpha = (p.color >>> 24) / 255;
    s.blendMode = "add";
    mirror.addChild(s);
  }
  const ref = new Container();
  ref.addChild(board(), mirror);
  renderer.render(ref);
  const spriteUrl = renderer.canvas.toDataURL("image/png");
  ref.destroy({ children: true });
  stage.destroy({ children: true });
  return { url, spriteUrl };
}

// ---- Q5: draw order among sprites and batching across atlas pages ----
/** Mean RGB over a rectangle of the extracted pixels. */
const meanRgb = (pixels: Uint8ClampedArray | Uint8Array, width: number, x0: number, y0: number, w: number, h: number) => {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      r += pixels[i] as number;
      g += pixels[i + 1] as number;
      b += pixels[i + 2] as number;
    }
  const n = w * h;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
};

function orderTest() {
  // s1 red at 0..128 x 0..128; particle green 128 px square centered on (128, 64) -> 64..192 x 0..128;
  // s2 blue at 128..256 x 64..192; s3 red at 256..384 x 0..128.
  const scene = (variant: string) => {
    const stage = new Container();
    const s1 = new Sprite(redTile);
    const s2 = new Sprite(blueTile);
    s2.position.set(128, 64);
    const s3 = new Sprite(redTile);
    s3.position.set(256, 0);
    let pc: ParticleContainer | undefined;
    if (variant !== "sprites-only") {
      const tex = variant === "pc-same-page" ? frame(pageB, 160, 32, 64, 64) : solidA;
      pc = new ParticleContainer({ texture: tex });
      pc.addParticle(new Particle({ texture: tex, x: 128, y: 64, scaleX: 2, scaleY: 2, anchorX: 0.5, anchorY: 0.5, tint: 0x00ff00 }));
      // second particle from page B (red tile) in a container bound to page A, at 300..364 x 160..224
      if (variant === "pc-mixed-sources")
        pc.addParticle(new Particle({ texture: redTile, x: 332, y: 192, anchorX: 0.5, anchorY: 0.5, scaleX: 0.5, scaleY: 0.5 }));
    }
    stage.addChild(s1);
    if (pc) stage.addChild(pc);
    stage.addChild(s2, s3);
    return stage;
  };

  const out: Record<string, unknown> = {};
  for (const variant of ["sprites-only", "pc-other-page", "pc-same-page", "pc-mixed-sources"]) {
    const stage = scene(variant);
    const rt = RenderTexture.create({ width: 400, height: 256, resolution: 1 });
    renderer.render({ container: stage, target: rt, clearColor: [0, 0, 0, 1] });
    draws = 0;
    renderer.render({ container: stage, target: rt, clearColor: [0, 0, 0, 1] });
    const drawCalls = draws;
    const { pixels, width } = renderer.extract.pixels(rt);
    out[variant] = {
      drawCalls,
      // inside s1 and the particle only: green means the particle is drawn after s1
      particleOverS1: meanRgb(pixels, width, 80, 8, 32, 32),
      // inside the particle and s2: blue means s2 is drawn after the particle
      s2OverParticle: meanRgb(pixels, width, 140, 76, 32, 32),
      // the page-B particle inside a page-A container: red if its own page were used
      mixedSourceParticle: meanRgb(pixels, width, 316, 176, 32, 32)
    };
    rt.destroy(true);
    stage.destroy({ children: true });
  }
  return out;
}

function cullTest() {
  const results: Record<string, unknown> = {};
  const view = new Rectangle(0, 0, W, H);
  const make = () => {
    const pc = new ParticleContainer({ texture: particleFrames[0] as Texture });
    pc.addParticle(new Particle({ texture: particleFrames[0] as Texture, x: 200, y: 400 }));
    const stage = new Container();
    stage.addChild(pc);
    return { pc, stage };
  };
  {
    const { pc, stage } = make();
    const b = pc.getBounds();
    results.boundsNoArea = { x: b.x, y: b.y, width: b.width, height: b.height };
    pc.cullable = true;
    Culler.shared.cull(stage, view);
    results.cullableNoBoundsArea_culled = pc.culled;
    pc.boundsArea = new Rectangle(0, 0, W, H);
    const b2 = pc.getBounds();
    results.boundsWithArea = { x: b2.x, y: b2.y, width: b2.width, height: b2.height };
    Culler.shared.cull(stage, view);
    results.cullableBoundsAreaOnScreen_culled = pc.culled;
    pc.boundsArea = new Rectangle(-500, -500, 100, 100);
    Culler.shared.cull(stage, view);
    results.cullableBoundsAreaOffScreen_culled = pc.culled;
    pc.cullArea = new Rectangle(0, 0, W, H);
    Culler.shared.cull(stage, view);
    results.cullAreaOverridesBoundsArea_culled = pc.culled;
    stage.destroy({ children: true });
  }
  {
    // the particle container at x = 500 (off a 390 wide view), no boundsArea
    const { pc, stage } = make();
    pc.x = 500;
    pc.cullable = true;
    Culler.shared.cull(stage, view);
    results.offscreenNoBoundsArea_culled = pc.culled;
    stage.destroy({ children: true });
  }
  return results;
}

/** JS-only: cost of tint/alpha setters vs writing the packed color; removeParticle vs swap-remove. */
function microBench() {
  const n = 50_000;
  const ps: Particle[] = [];
  for (let i = 0; i < n; i++) ps.push(new Particle(particleFrames[0] as Texture));
  const time = (fn: () => void) => {
    fn();
    const t = performance.now();
    for (let k = 0; k < 5; k++) fn();
    return r2((performance.now() - t) / 5);
  };
  const setters = time(() => {
    for (let i = 0; i < n; i++) {
      const p = ps[i] as Particle;
      p.tint = 0xffe080;
      p.alpha = 0.5;
    }
  });
  const packed = time(() => {
    for (let i = 0; i < n; i++) (ps[i] as Particle).color = 0x8080e0ff;
  });

  const pc = new ParticleContainer({ texture: particleFrames[0] as Texture });
  const kids = ps.slice(0, 20_000);
  pc.addParticle(...kids);
  const victims = kids.filter((_, i) => i % 100 === 7); // 200 particles
  const t0 = performance.now();
  for (const v of victims) pc.removeParticle(v);
  const removeParticleMs = r2(performance.now() - t0);
  const arr = pc.particleChildren;
  const t1 = performance.now();
  for (let k = 0; k < 200; k++) {
    const i = (k * 97) % arr.length;
    arr[i] = arr[arr.length - 1] as Particle;
    arr.length--;
  }
  pc.update();
  const swapRemoveMs = r2(performance.now() - t1);
  return { particles: n, tintAlphaSettersMs: setters, packedColorMs: packed, remove200of20kMs: { removeParticle: removeParticleMs, swapRemove: swapRemoveMs } };
}

declare global {
  interface Window {
    p9: unknown;
  }
}
window.p9 = {
  info: { renderer: renderer.name, crossOriginIsolated: window.crossOriginIsolated, adapter: adapterInfo, dpr: window.devicePixelRatio, canvas: [renderer.canvas.width, renderer.canvas.height], ua: navigator.userAgent },
  runLoad,
  runBursts,
  artifactTest,
  burstCanvas,
  orderTest,
  cullTest,
  microBench
};
console.log(`[p9] ready renderer=${renderer.name}`);
