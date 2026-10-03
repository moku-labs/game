/** P15 spike probe: assets over the Tauri protocol, splash to Home, renderer, safe area, lifecycle. */
import { listen } from "@tauri-apps/api/event";

const REPORT = "http://127.0.0.1:8788/report";
const t0 = Date.now();
const events: Array<{ ms: number; at: string; name: string; detail?: unknown }> = [];

/** Sends one JSON report to the host. The title keeps the last kind, for the screenshot fallback. */
function send(kind: string, data: Record<string, unknown>): void {
  const body = JSON.stringify({ spike: "p15", kind, ms: Date.now() - t0, ...data });
  document.title = `P15 ${kind}`;
  fetch(REPORT, { method: "POST", headers: { "content-type": "text/plain" }, body }).catch((error: unknown) => {
    document.title = `P15 POST failed ${String(error)}`;
  });
}

/** Records one lifecycle event and reports it right away (it may only leave on resume). */
function record(name: string, detail?: unknown): void {
  const entry = { ms: Date.now() - t0, at: new Date().toISOString(), name, detail };
  events.push(entry);
  send("event", { event: entry, visibility: document.visibilityState, all: events });
}

document.addEventListener("visibilitychange", () => record("visibilitychange", document.visibilityState));
addEventListener("pagehide", e => record("pagehide", { persisted: e.persisted }));
addEventListener("pageshow", e => record("pageshow", { persisted: e.persisted }));
addEventListener("blur", () => record("window.blur"));
addEventListener("focus", () => record("window.focus"));
addEventListener("touchstart", e => record("touchstart", { x: e.touches[0]?.clientX, y: e.touches[0]?.clientY }), { passive: true });
addEventListener("pointerdown", e => record("pointerdown", { type: e.pointerType, x: e.clientX, y: e.clientY }));

for (const name of ["tauri://suspended", "tauri://resumed", "tauri://focus", "tauri://blur"]) {
  listen(name, event => record(name, event.payload)).catch((error: unknown) => record(`listen-failed ${name}`, String(error)));
}

/** Fetches one URL and records status, content type and the first bytes. */
async function probe(url: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const head = new TextDecoder().decode(bytes.slice(0, 40));
    return { url, status: response.status, ok: response.ok, type: response.headers.get("content-type"), size: bytes.length, head };
  } catch (error) {
    return { url, error: String(error) };
  }
}

/** Reads the four CSS insets the way the engine does: a probe with env() padding. */
function insets(): Record<string, string> {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(el);
  const s = getComputedStyle(el);
  const out = { top: s.paddingTop, right: s.paddingRight, bottom: s.paddingBottom, left: s.paddingLeft };
  el.remove();
  return out;
}

/** The sizes the page sees and the two backgrounds, to tell where a band comes from. */
function layout(): Record<string, unknown> {
  return {
    insets: insets(),
    inner: { w: innerWidth, h: innerHeight },
    client: { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    visual: { w: visualViewport?.width, h: visualViewport?.height, top: visualViewport?.offsetTop },
    screen: { w: screen.width, h: screen.height },
    scrollY,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor
  };
}

type Game = {
  flow: { state(): { path: string } };
  renderer: { host: { kind(): string }; viewport: { size(): unknown } };
  ui: { find(key: string): number | undefined };
  input: { tap(entity: number): boolean };
};

/** Waits for the page's own `game` handle, then follows the splash to Home. */
async function followGame(): Promise<void> {
  const paths: Array<{ ms: number; path: string }> = [];
  let game: Game | undefined;
  for (let i = 0; i < 600; i += 1) {
    game = Reflect.get(globalThis, "game") as Game | undefined;
    if (game) {
      try {
        const path = game.flow.state().path;
        if (paths.at(-1)?.path !== path) paths.push({ ms: Date.now() - t0, path });
        if (path.startsWith("home")) break;
      } catch {
        // The flow is not running yet.
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const atHome = paths.at(-1)?.path.startsWith("home") ?? false;
  const result: Record<string, unknown> = { paths, atHome, layout: layout() };
  if (game) {
    try { result.renderer = game.renderer.host.kind(); } catch (error) { result.rendererError = String(error); }
    try { result.viewport = game.renderer.viewport.size(); } catch (error) { result.viewportError = String(error); }
  }
  send("home", result);
  if (!game || !atHome) return;

  // Touch through the page's own helper (a synthetic tap, not a real finger): Play moves to the board.
  await new Promise(resolve => setTimeout(resolve, 3000));
  const play = game.ui.find("play");
  const tapped = play === undefined ? "no play element" : game.input.tap(play);
  await new Promise(resolve => setTimeout(resolve, 1500));
  send("tap", { tapped, pathAfter: game.flow.state().path });
}

addEventListener("load", async () => {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const assets = await Promise.all([
    probe("/manifest.json"),
    probe("/missing-file.json"),
    probe("/probe.ktx2"),
    probe("/no-such-dir/x.png")
  ]);
  send("boot", {
    href: location.href,
    ua: navigator.userAgent,
    dpr: devicePixelRatio,
    screen: { w: innerWidth, h: innerHeight },
    navigatorGpu: gpu !== undefined,
    adapter: gpu ? (await gpu.requestAdapter()) !== null : false,
    insets: insets(),
    assets
  });
  // Every asset the page fetched, with its time and size: the loader's own requests.
  setTimeout(() => {
    const entries = performance.getEntriesByType("resource").map(e => {
      const r = e as PerformanceResourceTiming;
      return { name: r.name.replace(location.origin, ""), ms: Math.round(r.duration), size: r.transferSize || r.decodedBodySize, status: (r as PerformanceResourceTiming & { responseStatus?: number }).responseStatus };
    });
    send("resources", { entries });
  }, 15_000);
  await followGame();
});
