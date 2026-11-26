#!/usr/bin/env bun
/**
 * @file The walk of the real game: `GAME_DIR=<game repo> bun bench/stress/game/walk.ts <phone|desktop> <out-dir>
 * [--only a,b] [--profile]`. It drives a debug build of «A Memory Missing» through its heaviest moments (the album,
 * a pack reveal, the busy board, the pass, every event window, fast gestures), marks every action on the page clock
 * and in the monitor's log, and keeps every frame of the engine's ring with its phases, its slowest systems, its GPU
 * time, its cause bits and its demand reason, the raw log of `monitor.stream()`, the exact JS heap at each mark, and
 * a trace with the V8 collections on the page clock. `--profile` adds a sampling CPU profile and an allocation
 * profile of each scenario (their timings are not a measurement). `--only ov-album,ov-events,ov-board` takes the
 * overdraw pictures instead. `HOOKS=1` counts what makes Pixi rebuild its draw list (a desktop diagnostic).
 *
 * `GAME_DIR` is the game's repo: the saves come from its `tests/scenarios`, read only. `APP` is the app id
 * (`studio.kitto.memorymissing.hotpath.debug` by default: `game/build.ts` builds it), `SERIAL` the phone.
 *
 * phone: WebView DevTools on port 9352. It checks forwards, reverses and the keyguard first and stops on a taken
 * phone; it stops and starts only its own app, wakes the screen every two minutes, never touches port 9333 or a
 * setting, and gives its port back. desktop: `game/desktop.ts` serves the debug web build on DevTools port 9353.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SERIAL = process.env.SERIAL ?? "R5CY32V0J9M";
const APP = process.env.APP ?? "studio.kitto.memorymissing.hotpath.debug";
const PHONE_PORT = 9352;
const DESKTOP_PORT = 9353;
const GAME = process.env.GAME_DIR ?? "";
const [mode, out, ...flags] = process.argv.slice(2);
const only = flags.includes("--only")
  ? (flags[flags.indexOf("--only") + 1] ?? "").split(",")
  : undefined;
const profiled = flags.includes("--profile");

if ((mode !== "phone" && mode !== "desktop") || out === undefined || GAME === "") {
  console.error(
    "Usage: GAME_DIR=<game repo> bun bench/stress/game/walk.ts <phone|desktop> <out-dir> [--only a,b] [--profile]"
  );
  process.exit(2);
}

mkdirSync(out, { recursive: true });

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Runs a command and gives its output. */
async function sh(...words: string[]): Promise<string> {
  const child = Bun.spawn(words, { stderr: "pipe" });
  const text = await new Response(child.stdout).text();

  await child.exited;

  return text;
}

const adb = (...words: string[]): Promise<string> => sh("adb", "-s", SERIAL, ...words);

// ---------------------------------------------------------------------------------------------------------------
// The DevTools socket.
// ---------------------------------------------------------------------------------------------------------------

type Socket = {
  ws: WebSocket;
  next: number;
  waiting: Map<number, (message: Record<string, unknown>) => void>;
  events: Array<Record<string, unknown>>;
};

async function open(url: string): Promise<Socket> {
  const socket: Socket = { ws: new WebSocket(url), next: 0, waiting: new Map(), events: [] };

  socket.ws.addEventListener("message", event => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;

    if (typeof message.id === "number") {
      socket.waiting.get(message.id)?.(message);
      socket.waiting.delete(message.id);
    } else {
      socket.events.push(message);
    }
  });
  await new Promise(resolve => socket.ws.addEventListener("open", resolve, { once: true }));

  return socket;
}

function send(
  socket: Socket,
  method: string,
  params: object = {}
): Promise<Record<string, unknown>> {
  socket.next += 1;

  const id = socket.next;

  return new Promise(resolve => {
    socket.waiting.set(id, resolve);
    socket.ws.send(JSON.stringify({ id, method, params }));
  });
}

async function js<T>(socket: Socket, expression: string): Promise<T> {
  const answer = (await send(socket, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  })) as { result?: { result?: { value?: T }; exceptionDetails?: unknown } };

  if (answer.result?.exceptionDetails !== undefined) {
    throw new Error(JSON.stringify(answer.result.exceptionDetails).slice(0, 500));
  }

  return answer.result?.result?.value as T;
}

const port = mode === "phone" ? PHONE_PORT : DESKTOP_PORT;

/** The pages the DevTools port lists, asked until it answers. */
async function pagesOf(): Promise<Array<{ type: string; webSocketDebuggerUrl: string }>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const listed = await fetch(`http://127.0.0.1:${port}/json`);
      const pages = (await listed.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;

      if (pages.length > 0) return pages;
    } catch {
      await sleep(300);
    }
  }

  return [];
}

async function connect(): Promise<{ page: Socket; browser: Socket | undefined }> {
  if (mode === "phone") {
    let pid = "";

    for (let attempt = 0; attempt < 50 && pid === ""; attempt += 1) {
      const found = await adb("shell", "pidof", APP);

      pid = found.trim();
      if (pid === "") await sleep(200);
    }

    if (pid === "") throw new Error("the app is not running");

    await adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  }

  const pages = await pagesOf();

  const target = pages.find(entry => entry.type === "page") ?? pages[0];

  if (target === undefined) throw new Error("no page on the DevTools port");

  let browser: Socket | undefined;

  try {
    const answered = await fetch(`http://127.0.0.1:${port}/json/version`);
    const version = (await answered.json()) as {
      webSocketDebuggerUrl?: string;
    };

    if (version.webSocketDebuggerUrl !== undefined)
      browser = await open(version.webSocketDebuggerUrl);
  } catch {
    browser = undefined;
  }

  return { page: await open(target.webSocketDebuggerUrl), browser };
}

// ---------------------------------------------------------------------------------------------------------------
// The page helper: marks on the page clock, and the frames of the ring kept as rows.
// ---------------------------------------------------------------------------------------------------------------

/** The scalar columns of the ring a row keeps, in row order; the six phases and five system pairs follow them. */
const COLUMNS = [
  "frame",
  "t",
  "gapMs",
  "capMs",
  "skipped",
  "startMs",
  "rateMs",
  "budgetMs",
  "agentMs",
  "workMs",
  "drawn",
  "idle",
  "stepped",
  "passes",
  "stencilPasses",
  "draws",
  "filterApplies",
  "filterMpx",
  "uploads",
  "uploadMb",
  "compiles",
  "marks",
  "rebuilds",
  "gpuMs",
  "gpuPartial",
  "path",
  "changed",
  "causes",
  "reason",
  "kept",
  "retakes",
  "targetsCreated",
  "targetsDestroyed"
];

/** A frame's own time: the sum of its six phases, which follow the scalar columns of a row. */
function ownOfRow(row: number[]): number {
  return row
    .slice(COLUMNS.length, COLUMNS.length + 6)
    .reduce((sum, value) => sum + Math.max(0, value), 0);
}

const HELPER = `(() => {
  if (globalThis.__hp) return true;
  const COLS = ${JSON.stringify(COLUMNS)};
  const ring = () => game.renderer.monitor.frames();
  const hp = globalThis.__hp = { marks: [], rows: [], log: [], cursor: ring().written, lost: 0 };
  // Every line of the monitor's stream, as it is written: the raw log of the run.
  hp.off = game.renderer.monitor.stream(line => { hp.log.push(JSON.stringify(line)); });
  hp.mark = label => {
    hp.marks.push([Math.round(performance.now() * 10) / 10, label, game.flow.state().path]);
    game.renderer.monitor.mark(label);
    return true;
  };
  // A drain copies the new frames into one typed array: no object per row, so the reader adds no garbage of its own
  // to the heap it measures beyond that one array every three seconds.
  const WIDTH = COLS.length + 6 + 10;
  hp.chunks = [];
  hp.drainUntil = until => {
    const r = ring(); const c = r.columns; const cap = r.capacity;
    const from = Math.max(hp.cursor, r.written - cap);
    hp.lost += from - hp.cursor;
    if (until <= from) { hp.cursor = Math.max(hp.cursor, until); return; }
    const chunk = new Float64Array((until - from) * WIDTH);
    for (let at = from; at < until; at += 1) {
      const s = (((r.newest - (r.written - 1 - at)) % cap) + cap) % cap;
      let o = (at - from) * WIDTH;
      for (let k = 0; k < COLS.length; k += 1) chunk[o++] = c[COLS[k]][s];
      for (let k = 0; k < 6; k += 1) chunk[o++] = c.phaseMs[s * 6 + k];
      for (let k = 0; k < 5; k += 1) { chunk[o++] = c.sysIdx[s * 5 + k]; chunk[o++] = c.sysMs[s * 5 + k]; }
    }
    hp.chunks.push(chunk);
    hp.cursor = Math.max(hp.cursor, until);
  };
  // The GPU time of a frame lands a few frames late: a row is read 2 s after its frame at the earliest.
  hp.timer = setInterval(() => hp.drainUntil(ring().written - 120), 3000);
  hp.take = () => {
    const r = ring();
    hp.drainUntil(r.written);
    const p = r.passes; const passes = [];
    // The newest passes of the pass ring: what each pass of the last frames was.
    for (let k = 0; k < Math.min(p.size, 400); k += 1) {
      const s = (((p.newest - k) % p.capacity) + p.capacity) % p.capacity;
      passes.push([p.frame[s], p.index[s], p.kind[s], p.width[s], p.height[s], Math.round(p.gpuMs[s] * 100) / 100, p.label[s], p.owner[s], p.kind2[s], p.restart[s], p.resolution[s]]);
    }
    for (const chunk of hp.chunks) {
      for (let o = 0; o < chunk.length; o += WIDTH) {
        const row = [];
        for (let k = 0; k < WIDTH; k += 1) { const v = chunk[o + k]; row.push(Number.isNaN(v) ? -1 : Math.round(v * 100) / 100); }
        hp.rows.push(row);
      }
    }
    hp.chunks = [];
    const got = { cols: COLS, rows: hp.rows, marks: hp.marks, log: hp.log, lost: hp.lost, systems: [...r.systemNames], kinds: [...r.kindNames], paths: [...r.paths], passes };
    hp.rows = []; hp.marks = []; hp.log = []; hp.lost = 0;
    return got;
  };
  // A sync point of the page clock for a trace or a profile: a named function that spins 4 ms.
  globalThis.__hpSync = function __hpSync() { const t0 = performance.now(); performance.mark("hp-sync"); while (performance.now() - t0 < 4) {} return t0; };
  return true;
})()`;

/**
 * A diagnostic of the test page only (`HOOKS=1`, never in a timed pass): it wraps what makes Pixi rebuild a render
 * group's instruction list (a child added or removed, `visible` / `renderable` / `zIndex` / `blendMode` written, a
 * pipe's `validateRenderable` answering true) and counts each by the engine functions that called it.
 */
// eslint-disable-next-line unicorn/prefer-string-raw -- the page script keeps its own escapes; a raw string would change them.
const HOOKS = `(() => {
  if (globalThis.__hpHooks) return true;
  const pixi = game.renderer.host.pixi();
  const counts = globalThis.__hpHooks = {};
  const note = what => {
    const lines = new Error().stack.split("\\n").slice(3, 7).map(line => line.trim().replace(/^at /, "").replace(/ \\(.*$/, ""));
    const key = what + " <- " + lines.join(" <- ");
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const proto = pixi.Container.prototype;
  for (const name of ["visible", "renderable", "zIndex", "blendMode"]) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.set) continue;
    Object.defineProperty(proto, name, { ...d, set(value) { if (this[name] !== value) note("set " + name); d.set.call(this, value); } });
  }
  for (const name of ["addChild", "addChildAt", "removeChild", "removeChildAt", "removeChildren"]) {
    const own = proto[name];
    if (typeof own !== "function") continue;
    proto[name] = function (...rest) { note(name); return own.apply(this, rest); };
  }
  for (const [label, pipe] of [["graphics", pixi.GraphicsPipe], ["bitmapText", pixi.BitmapTextPipe], ["text", pixi.CanvasTextPipe], ["nineSlice", pixi.NineSliceSpritePipe], ["mesh", pixi.MeshPipe]]) {
    const own = pipe?.prototype?.validateRenderable;
    if (typeof own !== "function") continue;
    pipe.prototype.validateRenderable = function (...rest) { const answer = own.apply(this, rest); if (answer) note("validate " + label + " (" + (rest[0]?.label ?? "") + ")"); return answer; };
  }
  return true;
})()`;

// ---------------------------------------------------------------------------------------------------------------
// Touches.
// ---------------------------------------------------------------------------------------------------------------

type Screen = {
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  top: number;
};

async function screenOf(page: Socket): Promise<Screen> {
  const css = await js<{ w: number; h: number; dpr: number }>(
    page,
    "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })"
  );

  if (mode === "desktop") {
    return { width: css.w, height: css.h, cssWidth: css.w, cssHeight: css.h, dpr: 1, top: 0 };
  }

  const size = /(\d{1,5})x(\d{1,5})/.exec(await adb("shell", "wm", "size"));
  const width = Number(size?.[1] ?? 1080);
  const height = Number(size?.[2] ?? 2340);
  const scale = width / css.w;

  // What the page does not cover is taken as the status bar, on top.
  return {
    width,
    height,
    cssWidth: css.w,
    cssHeight: css.h,
    dpr: scale,
    top: Math.max(0, height - css.h * scale)
  };
}

/** A swipe between two points given in CSS px of the page. */
async function swipe(
  page: Socket,
  screen: Screen,
  from: [number, number],
  to: [number, number],
  ms: number
): Promise<void> {
  if (mode === "phone") {
    const at = ([x, y]: [number, number]): string[] => [
      String(Math.round(x * screen.dpr)),
      String(Math.round(screen.top + y * screen.dpr))
    ];

    await adb("shell", "input", "swipe", ...at(from), ...at(to), String(ms));

    return;
  }

  const steps = Math.max(2, Math.round(ms / 16));
  const point = (share: number): { x: number; y: number } => ({
    x: from[0] + (to[0] - from[0]) * share,
    y: from[1] + (to[1] - from[1]) * share
  });

  await send(page, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point(0),
    button: "left",
    clickCount: 1
  });

  for (let step = 1; step <= steps; step += 1) {
    await send(page, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...point(step / steps),
      button: "left"
    });
    await sleep(ms / steps);
  }

  await send(page, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point(1),
    button: "left",
    clickCount: 1
  });
}

async function tap(page: Socket, screen: Screen, at: [number, number]): Promise<void> {
  if (mode === "phone") {
    await adb(
      "shell",
      "input",
      "tap",
      String(Math.round(at[0] * screen.dpr)),
      String(Math.round(screen.top + at[1] * screen.dpr))
    );

    return;
  }

  await send(page, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: at[0],
    y: at[1],
    button: "left",
    clickCount: 1
  });
  await send(page, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: at[0],
    y: at[1],
    button: "left",
    clickCount: 1
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The steps of a scenario.
// ---------------------------------------------------------------------------------------------------------------

type Walk = {
  page: Socket;
  screen: Screen;
  log: string[];
  /** The used JS heap at each mark: the Mac's time, the label, bytes. */
  heap: Array<[number, string, number]>;
};

/** Marks an action on the page clock and in the monitor's log; the exact used heap of that moment is asked for without a wait. */
function mark(walk: Walk, label: string): Promise<boolean> {
  noteHeap(walk, label);

  return js(walk.page, `__hp.mark(${JSON.stringify(label)})`);
}

/** Asks DevTools for the used JS heap now; the answer is kept with the label when it comes. */
function noteHeap(walk: Walk, label: string): void {
  const asked = Date.now();

  send(walk.page, "Runtime.getHeapUsage")
    .then(answer => {
      const usage = (answer as { result?: { usedSize?: number } }).result;

      if (usage?.usedSize !== undefined) walk.heap.push([asked, label, usage.usedSize]);
    })
    .catch(() => undefined);
}

const pathOf = (walk: Walk): Promise<string> => js(walk.page, "game.flow.state().path");

/** Waits until the graph stands on a path (a prefix), up to a limit. */
async function waitFor(walk: Walk, at: string, limitMs = 12_000): Promise<boolean> {
  const until = Date.now() + limitMs;

  while (Date.now() < until) {
    const now = await pathOf(walk);

    if (now === at || now.startsWith(at)) return true;

    await sleep(100);
  }

  walk.log.push(`TIMEOUT waiting for ${at}, at ${await pathOf(walk)}`);

  return false;
}

/** Answers the gate once the graph stands on `at`, marks it, and stands `gapMs` after. */
async function answer(
  walk: Walk,
  at: string,
  intent: string,
  payload: unknown,
  label: string,
  gapMs: number
): Promise<boolean> {
  if (!(await waitFor(walk, at))) return false;

  noteHeap(walk, label);

  const taken = await js<boolean | string>(
    walk.page,
    `(() => { __hp.mark(${JSON.stringify(label)}); try { return game.flow.gate.answer(${JSON.stringify(
      payload === undefined ? { intent } : { intent, payload }
    )}); } catch (error) { return String(error); } })()`
  );

  if (taken !== true) walk.log.push(`REFUSED ${label}: ${String(taken)}`);

  await sleep(gapMs);

  return taken === true;
}

/** The middle of a keyed element or of a projection's view, in CSS px; `undefined` when it is not shown. */
function middleOf(walk: Walk, input: object): Promise<[number, number] | undefined> {
  return js(
    walk.page,
    `Promise.resolve(doors.read(game, doors.sources.locate, ${JSON.stringify(input)})).then(r => r ? [r.x + r.w / 2, r.y + r.h / 2] : undefined, () => undefined)`
  );
}

/** Marks and swipes. */
async function markedSwipe(
  walk: Walk,
  label: string,
  from: [number, number],
  to: [number, number],
  ms: number,
  gapMs: number
): Promise<void> {
  await mark(walk, label);
  await swipe(walk.page, walk.screen, from, to, ms);
  await sleep(gapMs);
}

/** A save as `saveImport` takes it, built from a scenario of the game at the device's time. */
async function saveOf(scenario: string, now: number): Promise<string> {
  // The scenario and the starting session are the game's own modules, read where they lie: nothing is written there.
  const built = (await import(path.join(GAME, "tests", "scenarios", `${scenario}.ts`))) as {
    default: (now: number) => { player: { settings?: object }; session?: object };
  };
  const state = (await import(path.join(GAME, "core", "state.ts"))) as { startingSession: object };
  const made = built.default(now);
  const text = JSON.stringify({
    player: { ...made.player, settings: { ...made.player.settings, locale: "ru" } },
    session: { ...state.startingSession, ...made.session },
    rng: { seed: 42, streams: {} }
  });

  // A debug build plays a test season that starts at its first launch: the scenario's high-water mark, set for the
  // real season of 2027, would read as past its end. The mark is the device's now.
  const save = JSON.parse(text) as { player: { album?: { seenUntil: number } } };

  if (save.player.album !== undefined) save.player.album.seenUntil = now;

  return JSON.stringify(save);
}

/** What closes a window that opened by itself, by the end of its path. */
const DISMISS: ReadonlyArray<[string, string]> = [
  ["albumStart", "begin"],
  ["albumBook", "close"],
  ["albumEnd", "take"],
  ["vitrineOpen", "close"],
  ["offerSheet/idle", "close"],
  ["dailyWindow", "dailyClose"],
  ["goalsBoard", "goalsClose"],
  ["passSheet/sheet", "close"],
  ["colleaguesSheet/list", "colleaguesClose"],
  ["settingsSheet/open", "done"],
  ["shopSheet/open", "close"],
  ["levelSheet/open", "close"],
  ["levelSheet/kitGift", "close"],
  ["puzzlesSheet/intro", "close"]
];

/** Brings the graph to a rest path: the splash and the promo are passed, a window that opened by itself is closed. */
async function settle(walk: Walk, target: string, limitMs = 40_000): Promise<boolean> {
  const until = Date.now() + limitMs;

  while (Date.now() < until) {
    const now = await pathOf(walk);

    if (now === target) {
      // A window of the ward's tick may still be on its way: the path must hold.
      await sleep(1500);

      if ((await pathOf(walk)) === target) return true;

      continue;
    }

    const intent =
      now.startsWith("splash") || now.startsWith("promo")
        ? "done"
        : DISMISS.find(([end]) => now.endsWith(end))?.[1];

    if (intent !== undefined) {
      await js(
        walk.page,
        `(() => { try { return game.flow.gate.answer({ intent: ${JSON.stringify(intent)} }); } catch (error) { return String(error); } })()`
      );
    }

    await sleep(700);
  }

  walk.log.push(`NOT SETTLED on ${target}, at ${await pathOf(walk)}`);

  return false;
}

/** Stands the game on a scenario's save: an import restarts the main flow, then the splash is passed. */
async function restore(walk: Walk, scenario: string, startAt: string): Promise<void> {
  const now = await js<number>(walk.page, "Date.now()");
  const save = await saveOf(scenario, now);

  await js(
    walk.page,
    `doors.run(game, doors.commands.saveImport, { save: ${save} }).then(() => true, e => String(e))`
  );

  await settle(walk, startAt);

  walk.log.push(`restored ${scenario}: ${await pathOf(walk)}`);
  await js(
    walk.page,
    `doors.run(game, doors.commands.mute, { muted: true }).then(() => true, e => String(e))`
  );
  await sleep(4000);
}

/** The lines of `dumpsys meminfo` a report reads: PSS in KB by name. */
function memoryOf(text: string): Record<string, number> {
  const found: Record<string, number> = {};

  for (const name of ["Native Heap", "Graphics", "GL mtrack", "EGL mtrack", "TOTAL PSS", "TOTAL"]) {
    const match = new RegExp(String.raw`^\s*${name}:?\s+(\d+)`, "m").exec(text);

    if (match !== null) found[name] = Number(match[1]);
  }

  return found;
}

const BOOK = "sideSheet/albumSheet/albumBook";
const BOARD = "mergeBoard/awaitIntent";

/** The pairs of the field that merge, as the game's soak tool finds them. */
function pairsOf(walk: Walk): Promise<Array<[number, number]>> {
  return js(
    walk.page,
    `Promise.resolve(doors.read(game, doors.sources.model)).then(({ player }) => {
      const seen = new Map(); const found = [];
      player.board.cells.forEach((cell, index) => {
        if (cell?.kind !== "item" || player.board.cover?.[index]) return;
        const name = cell.chain + ":" + cell.level;
        if (seen.has(name)) { found.push([index, seen.get(name)]); seen.delete(name); }
        else seen.set(name, index);
      });
      return found;
    })`
  );
}

/**
 * A picture of the overdraw heat map of the screen that stands: the map on, a screenshot, the map off. A pixel's
 * brightness counts the layers drawn there, 1/16 white a layer.
 */
async function heatShot(walk: Walk, name: string): Promise<void> {
  await js(walk.page, "(game.renderer.sync.debug.overdraw(true), true)");
  await sleep(900);

  const file = path.join(out as string, `overdraw-${name}.png`);
  const canvas = await js<object>(
    walk.page,
    `(() => { const c = document.querySelector("canvas"); const s = game.renderer.stats(); return { width: c.width, height: c.height, cssWidth: c.clientWidth, cssHeight: c.clientHeight, views: s.views, drawCalls: s.drawCalls, textureMb: s.textureMb, path: game.flow.state().path }; })()`
  );

  if (mode === "phone") {
    const child = Bun.spawn(["adb", "-s", SERIAL, "exec-out", "screencap", "-p"]);

    await Bun.write(file, await new Response(child.stdout).arrayBuffer());
  } else {
    const shot = (await send(walk.page, "Page.captureScreenshot", { format: "png" })) as {
      result?: { data?: string };
    };

    await Bun.write(file, Buffer.from(shot.result?.data ?? "", "base64"));
  }

  writeFileSync(
    path.join(out as string, `overdraw-${name}.json`),
    JSON.stringify({ name, canvas, screen: walk.screen })
  );
  await js(walk.page, "(game.renderer.sync.debug.overdraw(false), true)");
  await sleep(500);
}

/** The scenarios: a name, the save, and what the walk does. */
const SCENARIOS: Record<
  string,
  { save: string; start: string; run: (walk: Walk) => Promise<void> }
> = {
  album: {
    save: "album-live",
    start: "ward",

    run: async walk => {
      const { cssWidth: w, cssHeight: h } = walk.screen;

      await answer(walk, "ward", "album", undefined, "album: open from the ward", 300);
      await waitFor(walk, BOOK, 20_000);
      await sleep(2500);

      // The overview, flung up and down with a fast finger.
      for (let index = 0; index < 4; index += 1) {
        await markedSwipe(
          walk,
          "album: fling the overview up",
          [w / 2, h * 0.75],
          [w / 2, h * 0.3],
          120,
          450
        );
      }

      for (let index = 0; index < 4; index += 1) {
        await markedSwipe(
          walk,
          "album: fling the overview down",
          [w / 2, h * 0.3],
          [w / 2, h * 0.75],
          120,
          450
        );
      }

      await sleep(800);
      await answer(walk, BOOK, "view", { at: "set", set: 0 }, "album: open a set page", 1800);

      // Pages swiped fast, as F244 measured them, then faster.
      for (let index = 0; index < 10; index += 1) {
        await markedSwipe(
          walk,
          "album: swipe a page (300 ms apart)",
          [w * 0.8, h * 0.56],
          [w * 0.2, h * 0.56],
          150,
          300
        );
      }

      for (let index = 0; index < 8; index += 1) {
        await markedSwipe(
          walk,
          "album: swipe a page (100 ms apart)",
          [w * 0.8, h * 0.56],
          [w * 0.2, h * 0.56],
          100,
          100
        );
      }

      await sleep(1200);

      for (let index = 0; index < 6; index += 1) {
        await answer(walk, BOOK, "view", { at: "turn", dir: 1 }, "album: turn by the arrow", 450);
      }

      const set = await js<number>(
        walk.page,
        `Promise.resolve(doors.read(game, doors.sources.model)).then(m => m.session?.album?.view?.set ?? m.session?.sheet?.view?.set ?? 0, () => 0)`
      );

      await answer(walk, BOOK, "view", { at: "zoom", set, card: 0 }, "album: zoom a card", 1200);
      await answer(walk, BOOK, "view", { at: "set", set }, "album: close the zoom", 900);
      await answer(walk, BOOK, "view", { at: "overview" }, "album: back to the overview", 1200);
      await answer(walk, BOOK, "store", undefined, "album: open the store", 1500);
      await answer(
        walk,
        "sideSheet/albumSheet/albumStore",
        "claim",
        { index: 0 },
        "album: buy a box (the reveal opens)",
        2500
      );

      if (await waitFor(walk, "sideSheet/albumSheet/albumReveal", 8000)) {
        for (let step = 1; step <= 3; step += 1) {
          await answer(
            walk,
            "sideSheet/albumSheet/albumReveal",
            "next",
            { step },
            `album: reveal step ${step}`,
            1500
          );
        }

        await answer(
          walk,
          "sideSheet/albumSheet/albumReveal",
          "skip",
          { step: 9 },
          "album: reveal skip to the end",
          1800
        );
        await answer(
          walk,
          "sideSheet/albumSheet/albumReveal",
          "done",
          undefined,
          "album: reveal done",
          1800
        );
      }

      const now = await pathOf(walk);

      if (now.includes("albumSetDone"))
        await answer(walk, now, "take", { set: 0 }, "album: take the set prize", 1500);
      const afterTake = await pathOf(walk);

      if (afterTake.includes("albumStore"))
        await answer(
          walk,
          "sideSheet/albumSheet/albumStore",
          "close",
          undefined,
          "album: close the store",
          1000
        );

      await answer(walk, BOOK, "close", undefined, "album: close", 1500);
    }
  },
  reveal: {
    save: "album-live",
    start: "ward",

    run: async walk => {
      await answer(walk, "ward", "board", undefined, "board: enter from the ward", 300);
      await waitFor(walk, BOARD, 25_000);
      await sleep(3000);
      await answer(
        walk,
        BOARD,
        "takeReward",
        undefined,
        "reveal: take the pack from the reward stack",
        2500
      );

      const reveal = "sideSheet/albumSheet/albumReveal";

      if (await waitFor(walk, reveal, 10_000)) {
        for (let step = 1; step <= 4; step += 1)
          await answer(walk, reveal, "next", { step }, `reveal: step ${step}`, 1400);

        await answer(walk, reveal, "skip", { step: 9 }, "reveal: skip to the end", 1800);
        await answer(walk, reveal, "openNext", undefined, "reveal: open the next pack", 2500);

        for (let step = 1; step <= 2; step += 1)
          await answer(walk, reveal, "next", { step }, `reveal 2: step ${step}`, 1400);

        await answer(walk, reveal, "skip", { step: 9 }, "reveal 2: skip to the end", 1800);
        await answer(walk, reveal, "done", undefined, "reveal 2: done", 2500);
      }
    }
  },
  board: {
    save: "worst-ward",
    start: "ward",
    // eslint-disable-next-line sonarjs/cognitive-complexity -- a walk is its steps in order: split up, the order is lost.
    run: async walk => {
      await answer(walk, "ward", "board", undefined, "board: enter from the ward", 300);
      await settle(walk, BOARD);
      await sleep(3000);

      // Merges with room between them, then as fast as the gate takes them.
      for (let index = 0; index < 6; index += 1) {
        const [pair] = await pairsOf(walk);

        if (pair === undefined) break;

        await answer(
          walk,
          BOARD,
          "drop",
          { from: pair[0], to: pair[1] },
          "board: merge (900 ms apart)",
          900
        );
      }

      for (let index = 0; index < 8; index += 1) {
        const [pair] = await pairsOf(walk);

        if (pair === undefined) break;

        await answer(
          walk,
          BOARD,
          "drop",
          { from: pair[0], to: pair[1] },
          "board: merge (150 ms apart)",
          150
        );
      }

      await sleep(1500);

      for (let index = 0; index < 10; index += 1) {
        await answer(
          walk,
          BOARD,
          "tapGenerator",
          { cell: 31 },
          "board: tap the generator (120 ms apart)",
          120
        );
      }

      await sleep(1500);

      // Real drags of an item across the field and back, fast.
      const pairs = await pairsOf(walk);
      const from = await middleOf(walk, {
        target: { projection: "board.cells", key: `c${pairs[0]?.[0] ?? 10}` }
      });
      const far = await middleOf(walk, { target: { projection: "board.cells", key: "c3" } });

      if (from !== undefined && far !== undefined) {
        for (let index = 0; index < 6; index += 1) {
          await markedSwipe(
            walk,
            "board: drag an item across the field",
            index % 2 === 0 ? from : far,
            index % 2 === 0 ? far : from,
            250,
            350
          );
        }

        for (let index = 0; index < 8; index += 1) {
          await mark(walk, "board: tap an item (select)");
          await tap(walk.page, walk.screen, index % 2 === 0 ? from : far);
          await sleep(180);
        }
      } else {
        walk.log.push("no cell rects for the drags");
      }

      await sleep(1200);

      for (const [intent, payload, close] of [
        ["shop", { tab: "market" }, "close"],
        ["storage", undefined, "close"],
        ["level", undefined, "close"]
      ] as const) {
        await answer(walk, BOARD, intent, payload, `board: open ${intent}`, 1600);

        const now = await pathOf(walk);

        if (now !== BOARD)
          await answer(walk, now, close, undefined, `board: close ${intent}`, 1200);
      }

      for (let index = 0; index < 3; index += 1) {
        await answer(walk, BOARD, "ward", undefined, "scene: board to the ward", 300);
        await waitFor(walk, "ward", 25_000);
        await sleep(2500);
        await answer(walk, "ward", "board", undefined, "scene: ward to the board", 300);
        await waitFor(walk, BOARD, 25_000);
        await sleep(2500);
      }
    }
  },
  pass: {
    save: "pass-sheet-claimable",
    start: "ward",

    run: async walk => {
      const { cssWidth: w, cssHeight: h } = walk.screen;
      const sheet = "sideSheet/passSheet/sheet";

      await answer(walk, "ward", "pass", undefined, "pass: open from the ward", 300);

      if (!(await waitFor(walk, sheet, 20_000))) return;

      await sleep(2500);

      for (let index = 0; index < 6; index += 1) {
        await markedSwipe(
          walk,
          "pass: fling the track",
          [w / 2, h * 0.7],
          [w / 2, h * 0.35],
          120,
          400
        );
      }

      for (let index = 0; index < 6; index += 1) {
        await markedSwipe(
          walk,
          "pass: fling the track back",
          [w / 2, h * 0.35],
          [w / 2, h * 0.7],
          120,
          400
        );
      }

      await answer(walk, sheet, "claim", { level: 6, column: "free" }, "pass: claim a level", 2500);

      const now = await pathOf(walk);

      await answer(walk, now, "close", undefined, "pass: close", 1500);
    }
  },
  "ov-album": {
    save: "album-live",
    start: "ward",

    run: async walk => {
      await heatShot(walk, "ward");
      await answer(walk, "ward", "album", undefined, "overdraw: open the album", 300);
      await waitFor(walk, BOOK, 20_000);
      await sleep(3000);
      await heatShot(walk, "album-overview");
      await answer(walk, BOOK, "view", { at: "set", set: 0 }, "overdraw: open a set page", 2500);
      await heatShot(walk, "album-set-page");
      await answer(walk, BOOK, "close", undefined, "overdraw: close the album", 1500);
    }
  },
  "ov-events": {
    save: "maint-stress-events",
    start: "ward",

    run: async walk => {
      await answer(walk, "ward", "daily", undefined, "overdraw: open daily", 300);

      if (await waitFor(walk, "sideSheet/dailySheet/dailyWindow", 15_000)) {
        await sleep(3000);
        await heatShot(walk, "daily-popup");
        await answer(
          walk,
          "sideSheet/dailySheet/dailyWindow",
          "dailyClose",
          undefined,
          "overdraw: close daily",
          1500
        );
      }

      await answer(walk, "ward", "goals", undefined, "overdraw: open goals", 300);

      if (await waitFor(walk, "sideSheet/goalsSheet/goalsBoard", 15_000)) {
        await sleep(3000);
        await heatShot(walk, "goals-board");
        await answer(
          walk,
          "sideSheet/goalsSheet/goalsBoard",
          "goalsClose",
          undefined,
          "overdraw: close goals",
          1500
        );
      }
    }
  },
  "ov-board": {
    save: "worst-ward",
    start: "ward",

    run: async walk => {
      await answer(walk, "ward", "board", undefined, "overdraw: enter the board", 300);
      await settle(walk, BOARD);
      await sleep(3000);
      await heatShot(walk, "board");
      await answer(walk, BOARD, "shop", { tab: "market" }, "overdraw: open the shop", 300);

      if (await waitFor(walk, "shopSheet/open", 15_000)) {
        await sleep(3000);
        await heatShot(walk, "shop-over-board");
      }
    }
  },
  events: {
    save: "maint-stress-events",
    start: "ward",
    // eslint-disable-next-line sonarjs/cognitive-complexity -- a walk is its steps in order: split up, the order is lost.
    run: async walk => {
      const windows: Array<[string, string, unknown, string, string]> = [
        ["vitrine", "vitrine", undefined, "sideSheet/vitrineSheet/vitrineOpen", "close"],
        ["offer", "offer", undefined, "sideSheet/offerSheet/idle", "close"],
        ["goals", "goals", undefined, "sideSheet/goalsSheet/goalsBoard", "goalsClose"],
        [
          "colleagues",
          "colleagues",
          undefined,
          "sideSheet/colleaguesSheet/list",
          "colleaguesClose"
        ],
        ["album", "album", undefined, BOOK, "close"],
        ["daily", "daily", undefined, "sideSheet/dailySheet/dailyWindow", "dailyClose"],
        ["shop", "shop", { tab: "market" }, "shopSheet/open", "close"],
        ["settings", "settings", undefined, "sideSheet/settingsSheet/open", "done"]
      ];

      // Each window opened, left to stand, closed.
      for (const [name, intent, payload, rest, close] of windows) {
        await answer(walk, "ward", intent, payload, `events: open ${name}`, 300);

        if (!(await waitFor(walk, rest, 20_000))) {
          const stuck = await pathOf(walk);

          if (stuck !== "ward")
            await answer(walk, stuck, "back", undefined, `events: back out of ${name}`, 1500);

          continue;
        }

        await sleep(2200);

        if (name === "shop" || name === "goals") {
          const { cssWidth: w, cssHeight: h } = walk.screen;

          for (let index = 0; index < 4; index += 1) {
            await markedSwipe(
              walk,
              `events: fling the ${name} list`,
              [w / 2, h * 0.7],
              [w / 2, h * 0.35],
              120,
              400
            );
          }
        }

        await answer(walk, rest, close, undefined, `events: close ${name}`, 1800);
        await waitFor(walk, "ward", 10_000);
        await sleep(500);
      }

      // The same windows opened and closed as fast as the gates take it: the close comes 250 ms after the rest.
      for (let round = 0; round < 2; round += 1) {
        for (const [name, intent, payload, rest, close] of windows) {
          await answer(walk, "ward", intent, payload, `events fast: open ${name}`, 0);

          if (!(await waitFor(walk, rest, 20_000))) {
            const stuck = await pathOf(walk);

            if (stuck !== "ward")
              await answer(
                walk,
                stuck,
                "back",
                undefined,
                `events fast: back out of ${name}`,
                1500
              );

            continue;
          }

          await sleep(250);
          await answer(walk, rest, close, undefined, `events fast: close ${name}`, 0);
          await waitFor(walk, "ward", 10_000);
        }
      }

      await sleep(1500);
    }
  }
};

// ---------------------------------------------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------------------------------------------

if (mode === "phone") {
  const forwardList = await adb("forward", "--list");
  const reverseList = await adb("reverse", "--list");
  const windows = await adb("shell", "dumpsys", "window");
  const forwards = forwardList.trim();
  const reverses = reverseList.trim();
  const focus =
    windows
      .split("\n")
      .find(line => line.includes("mCurrentFocus"))
      ?.trim() ?? "";

  console.log({ forwards, reverses, focus });

  if (forwards !== "" || reverses !== "")
    throw new Error("a port is held on the phone: it is taken, nothing was touched");
  if (/Keyguard|NotificationShade/.test(focus))
    throw new Error("the phone is locked, nothing was touched");
  if (process.env.CHECK_ONLY !== undefined) process.exit(0);

  await adb("shell", "am", "force-stop", APP);
  await sleep(800);
  await adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1");
}

let awake = Date.now();

async function keepAwake(): Promise<void> {
  if (mode !== "phone" || Date.now() - awake < 120_000) return;

  awake = Date.now();
  await adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
}

try {
  // The overdraw pictures are a pass of their own: asked for by name, never part of a timed walk.
  const names = Object.keys(SCENARIOS).filter(name =>
    only === undefined ? !name.startsWith("ov-") : only.includes(name)
  );

  for (const name of names) {
    const scenario = SCENARIOS[name];

    if (scenario === undefined) continue;

    await keepAwake();

    const { page, browser } = await connect();

    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        if (await js<boolean>(page, "Boolean(globalThis.game?.flow?.state?.()?.path)")) break;
      } catch {
        // The page is still loading.
      }

      await sleep(200);
    }

    const walk: Walk = { page, screen: await screenOf(page), log: [], heap: [] };

    await restore(walk, scenario.save, scenario.start);
    await js(page, HELPER);
    if (process.env.HOOKS !== undefined) await js(page, HOOKS);

    const header = await js<object>(
      page,
      `({ engine: globalThis.__MOKU_GAME_ENGINE__, build: globalThis.__MOKU_GAME_BUILD__, kind: game.renderer.host.kind(), ua: navigator.userAgent, timeOrigin: performance.timeOrigin })`
    );
    let traced = false;

    if (browser !== undefined) {
      const started = await send(browser, "Tracing.start", {
        traceConfig: {
          includedCategories: [
            "v8",
            "devtools.timeline",
            "disabled-by-default-v8.gc",
            "blink.user_timing"
          ]
        },
        transferMode: "ReportEvents"
      });

      traced = started.error === undefined;
      if (!traced) walk.log.push(`no trace: ${JSON.stringify(started.error)}`);
    }

    if (profiled) {
      await send(page, "Profiler.enable");
      await send(page, "Profiler.setSamplingInterval", { interval: 250 });
      await send(page, "Profiler.start");
      await send(page, "HeapProfiler.enable");
      await send(page, "HeapProfiler.startSampling", {
        samplingInterval: 2048,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true
      });
    }

    const memoryBefore =
      mode === "phone" ? memoryOf(await adb("shell", "dumpsys", "meminfo", APP)) : {};
    const sync = await js<number>(page, "__hpSync()");
    const clock =
      mode === "phone"
        ? await adb("shell", "cat /sys/kernel/gpu/gpu_clock /sys/kernel/gpu/gpu_busy")
        : "";

    await mark(walk, `${name}: start`);
    await scenario.run(walk);
    await sleep(2500);

    const taken = await js<object>(page, "__hp.take()");
    const hooks = await js<object>(page, "globalThis.__hpHooks ?? null");
    const stats = await js<object>(page, "game.renderer.stats()");
    const memoryAfter =
      mode === "phone" ? memoryOf(await adb("shell", "dumpsys", "meminfo", APP)) : {};
    let profile: unknown;
    let trace: unknown[] = [];

    let heapProfile: unknown;

    if (profiled) {
      profile = ((await send(page, "Profiler.stop")) as { result?: { profile?: unknown } }).result
        ?.profile;
      heapProfile = (
        (await send(page, "HeapProfiler.stopSampling")) as { result?: { profile?: unknown } }
      ).result?.profile;
    }

    if (traced && browser !== undefined) {
      browser.events.length = 0;
      await send(browser, "Tracing.end");

      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (browser.events.some(event => event.method === "Tracing.tracingComplete")) break;

        await sleep(200);
      }

      trace = browser.events
        .filter(event => event.method === "Tracing.dataCollected")
        .flatMap(event => (event.params as { value: unknown[] }).value)
        .filter(event => {
          const entry = event as { name?: string };

          return (
            entry.name === "MinorGC" ||
            entry.name === "MajorGC" ||
            entry.name === "hp-sync" ||
            entry.name === "V8.GC_MARK_COMPACTOR" ||
            entry.name === "V8.GCScavenger"
          );
        });
    }

    writeFileSync(
      path.join(out, `${name}.json`),
      JSON.stringify({
        name,
        header,
        sync,
        clock,
        stats,
        walkLog: walk.log,
        heap: walk.heap,
        memoryBefore,
        memoryAfter,
        hooks,
        screen: walk.screen,
        ...taken,
        log: undefined,
        trace
      })
    );
    // The raw log of the monitor's stream, one line each, beside the results.
    writeFileSync(
      path.join(out, `${name}.stream.jsonl`),
      `${(taken as { log: string[] }).log.join("\n")}\n`
    );
    if (profile !== undefined)
      writeFileSync(path.join(out, `${name}.cpuprofile`), JSON.stringify(profile));
    if (heapProfile !== undefined)
      writeFileSync(path.join(out, `${name}.heapprofile`), JSON.stringify(heapProfile));

    const rows = (taken as { rows: number[][] }).rows;
    const own = ownOfRow;

    console.log(
      name,
      JSON.stringify({
        frames: rows.length,
        over16: rows.filter(row => own(row) > 16.7).length,
        over33: rows.filter(row => own(row) > 33.3).length,
        worst: Math.max(...rows.map(row => own(row))).toFixed(1),
        gc: trace.length,
        stream: (taken as { log: string[] }).log.length,
        log: walk.log
      })
    );
    page.ws.close();
    browser?.ws.close();
  }
} finally {
  if (mode === "phone") {
    await adb("forward", "--remove", `tcp:${port}`);
    await adb("shell", "am", "force-stop", APP);
  }
}
