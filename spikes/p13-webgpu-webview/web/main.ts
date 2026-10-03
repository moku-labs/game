/** P13 spike page: WebGPU probe, Pixi renderer pick, one sprite, report to the host. */
import { Application, Graphics, Sprite } from "pixi.js";

const REPORT = "http://127.0.0.1:8787/report";
const report: Record<string, unknown> = {
  spike: "p13",
  href: location.href,
  ua: navigator.userAgent,
  isSecureContext,
  dpr: devicePixelRatio,
  hasTauriInternals: "__TAURI_INTERNALS__" in globalThis
};
const out = document.querySelector("#out") as HTMLElement;

/** Probes WebGPU step by step and records each step. */
async function probeGpu(): Promise<void> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  report.navigatorGpu = gpu !== undefined;
  if (!gpu) return;
  report.preferredFormat = gpu.getPreferredCanvasFormat();
  try {
    const adapter = await gpu.requestAdapter();
    report.adapter = adapter !== null;
    if (!adapter) return;
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    report.adapterInfo = info
      ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description }
      : "no adapter.info";
    report.adapterFeatures = [...adapter.features];
    report.maxTextureDimension2D = adapter.limits.maxTextureDimension2D;
    const device = await adapter.requestDevice();
    report.device = true;
    device.destroy();
  } catch (error) {
    report.gpuError = String(error);
  }
}

/** Starts Pixi with WebGPU preferred and draws one sprite. */
async function startPixi(): Promise<void> {
  try {
    const app = new Application();
    await app.init({ preference: "webgpu", background: 0x1d2b3a, resizeTo: window, antialias: true });
    document.body.prepend(app.canvas);
    const g = new Graphics().circle(0, 0, 60).fill(0xf2b43d);
    const sprite = new Sprite(app.renderer.generateTexture(g));
    sprite.anchor.set(0.5);
    sprite.position.set(app.screen.width / 2, app.screen.height / 3);
    app.stage.addChild(sprite);
    app.ticker.add(t => (sprite.rotation += 0.02 * t.deltaTime));
    app.render();
    report.pixiRenderer = app.renderer.name;
    report.pixiRendererType = app.renderer.type;
  } catch (error) {
    report.pixiError = String(error);
  }
}

await probeGpu();
await startPixi();

const text = JSON.stringify(report);
out.textContent = JSON.stringify(report, null, 1);
document.title = `P13 gpu=${report.navigatorGpu} adapter=${report.adapter} device=${report.device} pixi=${report.pixiRenderer}`;

try {
  const response = await fetch(REPORT, { method: "POST", headers: { "content-type": "text/plain" }, body: text });
  out.textContent += `\nreport POST: ${response.status}`;
} catch (error) {
  out.textContent += `\nreport POST failed: ${String(error)}`;
}
