import { Application } from "pixi.js";
import { mountAccepting } from "./scene-accepting";
import { mountPlain } from "./scene-plain";

const MARKER = "p2:beforeFullReload";

type Spike = { app: Application; frames: number; bootId: string; renderer: string };
const g = globalThis as unknown as { __spike?: Spike };

const marker = sessionStorage.getItem(MARKER);
if (marker) {
  console.log(`[p2] restored after full reload; marker=${marker}`);
  sessionStorage.removeItem(MARKER);
} else {
  console.log("[p2] fresh load, no marker");
}

if (import.meta.hot) {
  import.meta.hot.on("bun:beforeFullReload", () => {
    const frames = g.__spike?.frames ?? -1;
    sessionStorage.setItem(MARKER, JSON.stringify({ frames, bootId: g.__spike?.bootId, at: Date.now() }));
    console.log(`[p2] bun:beforeFullReload fired at frame ${frames}`);
  });
  import.meta.hot.on("bun:beforeUpdate", () => console.log("[p2] bun:beforeUpdate"));
  import.meta.hot.on("bun:afterUpdate", () => console.log(`[p2] bun:afterUpdate frames=${g.__spike?.frames}`));
}

const app = new Application();
await app.init({ preference: "webgpu", width: 640, height: 360, background: 0x222233 });
document.getElementById("mount")!.appendChild(app.canvas);

const rendererName = app.renderer.name ?? app.renderer.constructor.name;
const spike: Spike = { app, frames: 0, bootId: Math.random().toString(36).slice(2, 8), renderer: rendererName };
g.__spike = spike;
console.log(`[p2] boot ${spike.bootId} renderer=${rendererName} type=${app.renderer.type}`);

app.ticker.add(() => {
  spike.frames++;
});

mountAccepting(app);
mountPlain(app);
