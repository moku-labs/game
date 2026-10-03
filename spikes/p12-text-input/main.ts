// Spike P12. One drawn text field on a WebGPU canvas, backed by one hidden DOM <input>.
// Query parameters pick the variant: tech, focus, pd, ps, lift, fs, ac, enter, autocap, autocorrect.

import { Application, BitmapFontManager, BitmapText, Container, Graphics, TextStyle } from "pixi.js";

type Tech = "over" | "clear" | "tiny" | "top" | "offscreen" | "native";
type FocusAt = "down" | "up" | "click" | "raf";
type Entry = { t: number; type: string; detail?: unknown };

const params = new URLSearchParams(location.search);
const tech = (params.get("tech") ?? "top") as Tech;
const focusAt = (params.get("focus") ?? "down") as FocusAt;
const preventDown = params.get("pd") !== "0";
const preventScroll = params.get("ps") !== "0";
const liftOn = params.get("lift") !== "off";
const fontPx = Number(params.get("fs") ?? 16);
const label = params.get("label") ?? `${tech}-${focusAt}`;

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const input = document.getElementById("field") as HTMLInputElement;
const form = document.getElementById("form") as HTMLFormElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const safeProbe = document.getElementById("safe") as HTMLDivElement;

// ovf=1 drops the overflow lock on html and body, as a page without it would be.
if (params.get("ovf") === "1") {
  document.documentElement.style.overflow = "visible";
  document.body.style.overflow = "visible";
}

// ---- the hidden input: attributes a game field wants ----
input.type = "text";
input.name = params.get("name") ?? "p12nick";
input.autocomplete = params.get("ac") ?? "off";
input.setAttribute("autocorrect", params.get("autocorrect") ?? "off");
input.setAttribute("autocapitalize", params.get("autocap") ?? "off");
input.spellcheck = false;
input.enterKeyHint = params.get("enter") ?? "done";
input.inputMode = "text";
input.maxLength = 24;

// ---- the log the driver reads ----
const entries: Entry[] = [];
const t0 = performance.now();
function log(type: string, detail?: unknown): void {
  entries.push({ t: Math.round(performance.now() - t0), type, detail });
  renderHud();
}

// ---- layout: 1080 short side, safe-area aware ----
type Rect = { x: number; y: number; w: number; h: number };
let field: Rect = { x: 0, y: 0, w: 0, h: 0 };
let lift = 0;
let scale = 1;

function layout(): void {
  const safe = safeProbe.getBoundingClientRect();
  const w = window.innerWidth;
  const h = window.innerHeight;
  scale = Math.min(w, h) / 1080;
  const fw = Math.min(860 * scale, w - 32);
  const fh = Math.max(44, 120 * scale);
  field = { x: (w - fw) / 2, y: safe.top + safe.height * 0.74, w: fw, h: fh };
  applyLift("layout");
}

/** The drawn field in layout-viewport coordinates, after the lift. */
function drawnField(): Rect {
  return { ...field, y: field.y - lift };
}

function placeInput(): void {
  const r = drawnField();
  const s = input.style;
  s.position = "fixed";
  s.margin = "0";
  s.padding = "0";
  s.border = "0";
  s.fontSize = `${fontPx}px`;
  s.pointerEvents = tech === "native" ? "auto" : "none";
  s.opacity = tech === "clear" ? "1" : "0";
  if (tech === "clear") {
    s.color = "transparent";
    s.background = "transparent";
    s.caretColor = "transparent";
    s.outline = "none";
  }
  if (params.get("vis") === "1") {
    s.opacity = "1";
    s.background = "#fff";
    s.color = "#000";
  }
  const at = (x: number, y: number, width: number, height: number) => {
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.width = `${width}px`;
    s.height = `${height}px`;
  };
  if (tech === "over" || tech === "clear" || tech === "native") at(r.x, r.y, r.w, r.h);
  else if (tech === "tiny") at(r.x, r.y, 1, 1);
  else if (tech === "top") at(0, 0, 1, 1);
  else at(-10000, r.y, r.w, r.h);
}

// ---- keyboard and the visual viewport ----
function viewportInfo() {
  const vv = window.visualViewport;
  return {
    inner: [window.innerWidth, window.innerHeight],
    scrollY: window.scrollY,
    vv: vv ? { w: Math.round(vv.width), h: Math.round(vv.height), top: Math.round(vv.offsetTop), pageTop: Math.round(vv.pageTop), scale: vv.scale } : null
  };
}

function applyLift(reason: string): void {
  const vv = window.visualViewport;
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const focused = document.activeElement === input;
  const margin = 16;
  const next = liftOn && focused ? Math.max(0, field.y + field.h + margin - visibleBottom) : 0;
  if (next !== lift) log("lift", { reason, from: Math.round(lift), to: Math.round(next), visibleBottom: Math.round(visibleBottom) });
  lift = next;
  placeInput();
}

window.visualViewport?.addEventListener("resize", () => {
  log("vv.resize", viewportInfo());
  applyLift("vv.resize");
});
window.visualViewport?.addEventListener("scroll", () => {
  log("vv.scroll", viewportInfo());
  applyLift("vv.scroll");
});
window.addEventListener("resize", () => {
  log("window.resize", viewportInfo());
  layout();
});
window.addEventListener("scroll", () => log("window.scroll", viewportInfo()));

// ---- the text model the canvas mirrors ----
let composing: { start: number; data: string } | null = null;

function caretIndexAt(clientX: number): number {
  const r = drawnField();
  const x = clientX - (r.x + padding());
  const value = input.value;
  let best = value.length;
  for (let i = 0; i <= value.length; i++) {
    if (prefixWidth(value.slice(0, i)) >= x) {
      best = i > 0 && prefixWidth(value.slice(0, i)) - x > x - prefixWidth(value.slice(0, i - 1)) ? i - 1 : i;
      break;
    }
  }
  return best;
}

function selection() {
  return { value: input.value, start: input.selectionStart, end: input.selectionEnd, dir: input.selectionDirection };
}

for (const type of ["focus", "blur", "select"] as const) input.addEventListener(type, () => log(type, { ...selection(), ...viewportInfo() }));
input.addEventListener("focus", () => {
  // The keyboard animates in; the vv events arrive later. Log where things stand twice.
  setTimeout(() => log("after-focus-600ms", viewportInfo()), 600);
});
input.addEventListener("blur", () => applyLift("blur"));
input.addEventListener("beforeinput", e => log("beforeinput", { inputType: e.inputType, data: e.data, isComposing: e.isComposing }));
input.addEventListener("input", e => {
  const ie = e as InputEvent;
  log("input", { inputType: ie.inputType, data: ie.data, isComposing: ie.isComposing, ...selection() });
});
input.addEventListener("compositionstart", e => {
  composing = { start: input.selectionStart ?? input.value.length, data: e.data };
  log("compositionstart", { data: e.data, ...selection() });
});
input.addEventListener("compositionupdate", e => {
  if (composing) composing.data = e.data;
  log("compositionupdate", { data: e.data, ...selection() });
});
input.addEventListener("compositionend", e => {
  composing = null;
  log("compositionend", { data: e.data, ...selection() });
});
input.addEventListener("keydown", e => {
  log("keydown", { key: e.key, code: e.code, keyCode: e.keyCode, isComposing: e.isComposing });
  if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) log("enter-submit", { value: input.value });
});
input.addEventListener("selectionchange", () => log("input.selectionchange", selection()));
document.addEventListener("selectionchange", () => {
  if (document.activeElement === input) log("doc.selectionchange", selection());
});
form.addEventListener("submit", e => {
  e.preventDefault();
  log("form-submit", { value: input.value });
  if (params.get("blurOnSubmit") !== "0") input.blur();
});

// ---- the tap → focus path, the way the engine's canvas listeners would see it ----
let pendingFocusX: number | null = null;

function inside(e: PointerEvent): boolean {
  const r = drawnField();
  return e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
}

function doFocus(where: string, clientX: number): void {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean; hasBeenActive: boolean } }).userActivation;
  input.focus({ preventScroll });
  const idx = caretIndexAt(clientX);
  input.setSelectionRange(idx, idx);
  log("focus-call", { where, active: document.activeElement === input, userActivation: activation ? { isActive: activation.isActive, hasBeenActive: activation.hasBeenActive } : "n/a", caret: idx });
}

canvas.addEventListener("pointerdown", e => {
  const hit = inside(e);
  log("pointerdown", { hit, pointerType: e.pointerType, x: Math.round(e.clientX), y: Math.round(e.clientY) });
  if (hit) {
    if (focusAt === "down") doFocus("pointerdown", e.clientX);
    if (preventDown) e.preventDefault();
  } else if (document.activeElement === input) {
    input.blur();
  }
});
canvas.addEventListener("pointerup", e => {
  if (!inside(e)) return;
  if (focusAt === "up") doFocus("pointerup", e.clientX);
  if (focusAt === "raf") pendingFocusX = e.clientX;
});
canvas.addEventListener("click", e => {
  log("click", { x: Math.round(e.clientX), y: Math.round(e.clientY) });
  if (focusAt === "click" && inside(e as PointerEvent)) doFocus("click", e.clientX);
});
canvas.addEventListener("mousedown", () => log("mousedown(compat)"));
canvas.addEventListener("touchstart", () => log("touchstart"), { passive: true });

// ---- drawing ----
let renderer: { name: string; gpu: boolean; dpr: number; ua: string } | undefined;
const app = new Application();
await app.init({ canvas, preference: "webgpu", resizeTo: window, autoDensity: true, resolution: window.devicePixelRatio, background: "#141821", antialias: true });
renderer = { name: app.renderer.name, gpu: "gpu" in navigator, dpr: window.devicePixelRatio, ua: navigator.userAgent };
log("renderer", renderer);

const world = new Container();
app.stage.addChild(world);
const board = new Graphics();
const box = new Graphics();
const marks = new Graphics();
const textStyle = new TextStyle({ fontFamily: "Arial", fontSize: 40, fill: 0xffffff });
const text = new BitmapText({ text: "", style: textStyle });
const hint = new BitmapText({ text: "Tap to type your name", style: { fontFamily: "Arial", fontSize: 40, fill: 0x8890a8 } });
world.addChild(board, box, marks, text, hint);

function padding(): number {
  return 24 * scale + 8;
}

function prefixWidth(prefix: string): number {
  if (prefix === "") return 0;
  textStyle.fontSize = Math.round(field.h * 0.45);
  const m = BitmapFontManager.measureText(prefix, textStyle, false);
  return m.width * m.scale;
}

app.ticker.add(() => {
  if (pendingFocusX !== null) {
    doFocus("raf (frame step)", pendingFocusX);
    pendingFocusX = null;
  }

  world.y = -lift;
  const focused = document.activeElement === input;
  const r = field;
  const pad = padding();
  const size = Math.round(r.h * 0.45);
  textStyle.fontSize = size;
  (hint.style as TextStyle).fontSize = size;

  board.clear().rect(0, r.y - 120 * scale - 40, app.screen.width, 120 * scale + 40).fill(0x1f2533);
  box.clear().roundRect(r.x, r.y, r.w, r.h, 18 * scale).fill(0xfaf3e3).stroke({ color: focused ? 0xff9b3d : 0x6b5a46, width: focused ? 6 : 3 });
  text.text = input.value;
  text.style.fill = 0x3a2212;
  text.position.set(r.x + pad, r.y + (r.h - size * 1.15) / 2);
  hint.visible = !focused && input.value === "";
  hint.position.copyFrom(text.position);

  marks.clear();
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  const x0 = r.x + pad + prefixWidth(input.value.slice(0, start));
  const x1 = r.x + pad + prefixWidth(input.value.slice(0, end));
  const top = r.y + r.h * 0.2;
  const bottom = r.y + r.h * 0.8;
  if (focused && end > start) marks.rect(x0, top, x1 - x0, bottom - top).fill({ color: 0x4a90ff, alpha: 0.35 });
  if (focused && composing) {
    const cx0 = r.x + pad + prefixWidth(input.value.slice(0, composing.start));
    const cx1 = r.x + pad + prefixWidth(input.value.slice(0, composing.start + composing.data.length));
    marks.rect(cx0, bottom - 2, cx1 - cx0, 4).fill(0x3a2212);
  }
  const blinkOn = Math.floor(performance.now() / 530) % 2 === 0;
  if (focused && end === start && blinkOn) marks.rect(x1 - 1.5, top, 3, bottom - top).fill(0xff6a00);
});

layout();

// ---- HUD and the driver hook ----
function short(d: unknown): string {
  if (d === undefined) return "";
  const o = d as Record<string, unknown>;
  const pick = ["where", "active", "hit", "inputType", "data", "value", "start", "end", "key", "keyCode", "isComposing", "to", "visibleBottom", "name", "gpu"];
  const parts = pick.filter(k => k in o).map(k => `${k}=${JSON.stringify(o[k])}`);
  if (o.vv) parts.push(`vv=${(o.vv as any).h}@${(o.vv as any).top}`);
  return parts.join(" ");
}

function renderHud(): void {
  const lines = entries.filter(e => !/selectionchange|^select$|touchstart|mousedown/.test(e.type)).slice(-7).map(e => `${e.t} ${e.type} ${short(e.detail)}`);
  const vi = viewportInfo();
  const head = `${tech}/${focusAt} pd=${+preventDown} fs=${fontPx} ${location.pathname} ${renderer?.name ?? "?"} inner=${vi.inner.join("x")} vv=${vi.vv?.h}@${vi.vv?.top} scrollY=${vi.scrollY} lift=${Math.round(lift)}`;
  hud.textContent = `${head}\n${lines.join("\n")}`.slice(0, 1500);
}

async function save(name = label): Promise<void> {
  await fetch(`/log/${name}`, { method: "POST", body: JSON.stringify({ label: name, params: Object.fromEntries(params), renderer, entries }, null, 1) });
}

Object.assign(window, { __p12: { entries, save, field: () => drawnField(), viewportInfo, selection, renderer } });
document.addEventListener("visibilitychange", () => void save());
setInterval(() => void save(), 3000);
