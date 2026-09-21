// Spike P1: WebGPU probe + a PixiJS v8 scene of 200 sprites. Throwaway code.
import { Application, Graphics, Sprite } from "pixi.js";

const started = performance.now();
const report: Record<string, unknown> = { userAgent: navigator.userAgent };

const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
report.hasNavigatorGpu = Boolean(gpu);

if (gpu) {
  const adapter = (await gpu.requestAdapter()) as
    | { info?: Record<string, string>; limits: Record<string, number>; features: Set<string> }
    | null;
  report.adapter = adapter
    ? {
        info: adapter.info
          ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device }
          : "no info",
        maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
        maxBufferSize: adapter.limits.maxBufferSize,
        features: [...adapter.features].slice(0, 12)
      }
    : null;
}

const mount = document.querySelector<HTMLDivElement>("#game");
const app = new Application();

try {
  await app.init({ preference: "webgpu", resizeTo: mount ?? window, background: "#18212b", antialias: true });
  mount?.append(app.canvas);
  report.rendererChosen = app.renderer.name;

  const shape = new Graphics().roundRect(0, 0, 48, 48, 10).fill(0xff7aa8);
  const texture = app.renderer.generateTexture(shape);
  const sprites: Sprite[] = [];
  for (let index = 0; index < 200; index += 1) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(Math.random() * app.screen.width, Math.random() * app.screen.height);
    sprites.push(sprite);
    app.stage.addChild(sprite);
  }

  let frames = 0;
  let firstFrameAt = 0;
  app.ticker.add(ticker => {
    frames += 1;
    if (frames === 1) firstFrameAt = performance.now();
    for (const sprite of sprites) sprite.rotation += 0.02 * ticker.deltaTime;
  });

  const windowStart = performance.now();
  await new Promise(resolve => setTimeout(resolve, 3000));
  const seconds = (performance.now() - windowStart) / 1000;

  report.timeToFirstFrameMs = Math.round(firstFrameAt - started);
  report.averageFps = Math.round(frames / seconds);
  // One 48×48 RGBA8 texture shared by 200 sprites; the estimate is texture bytes only.
  report.textureBytesEstimate = texture.source.width * texture.source.height * 4;
  report.canvasSize = `${app.screen.width}x${app.screen.height}`;
} catch (error) {
  report.pixiInitError = String(error);
}

const target = document.querySelector("#report");
if (target) target.textContent = JSON.stringify(report, null, 2);
console.log("[p1]", JSON.stringify(report));
