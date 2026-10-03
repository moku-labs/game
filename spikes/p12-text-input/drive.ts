// Spike P12 driver. Desktop Chrome, Chrome mobile emulation and Playwright WebKit with iPhone
// emulation, against the page served by serve.ts. Writes logs/drive-<browser>.json and shots/.
import { chromium, devices, webkit, type Browser, type BrowserContext, type Page } from "playwright";

const BASE = "http://localhost:3062";
const which = process.argv[2] ?? "chrome";
const TECHS = ["top", "tiny", "over", "clear", "offscreen", "native"] as const;
const FOCI = ["down", "up", "click", "raf"] as const;

type Row = Record<string, unknown>;
const rows: Row[] = [];

async function open(context: BrowserContext, query: string, path = "/"): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}?${query}`);
  await page.waitForFunction(() => (window as any).__p12?.entries.some((e: any) => e.type === "renderer"));
  await page.waitForTimeout(150);
  return page;
}

const state = (page: Page) =>
  page.evaluate(() => {
    const p = (window as any).__p12;
    return { active: document.activeElement?.id ?? null, ...p.selection(), field: p.field(), renderer: p.renderer, entries: p.entries };
  });

async function tapField(page: Page, touch: boolean, dx = 0.5): Promise<void> {
  const f = await page.evaluate(() => (window as any).__p12.field());
  const x = f.x + f.w * dx;
  const y = f.y + f.h / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await page.waitForTimeout(120);
}

/** Matrix: does a tap on the drawn field leave the hidden input focused, and does typing reach it? */
async function focusMatrix(context: BrowserContext, touch: boolean, tag: string): Promise<void> {
  for (const tech of TECHS)
    for (const focus of FOCI)
      for (const pd of ["1", "0"]) {
        if (pd === "0" && focus !== "down") continue;
        const page = await open(context, `tech=${tech}&focus=${focus}&pd=${pd}`);
        await tapField(page, touch);
        await page.keyboard.type("Alex");
        const s = await state(page);
        const calls = s.entries.filter((e: any) => e.type === "focus-call").map((e: any) => e.detail);
        rows.push({ test: "focus", tag, tech, focus, pd, activeAfterTap: s.active === "field", value: s.value, focusCalls: calls, blurs: s.entries.filter((e: any) => e.type === "blur").length, renderer: s.renderer.name });
        await page.close();
      }
}

async function editing(context: BrowserContext, tag: string, touch: boolean): Promise<void> {
  const page = await open(context, "tech=top&focus=down&label=editing");
  await tapField(page, touch);
  await page.keyboard.type("Hello world");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(100);
  const sel = await state(page);
  await page.screenshot({ path: `shots/${tag}-selection.png` });
  // Tap near the start of the text: the canvas maps x to a caret index.
  await tapField(page, touch, 0.12);
  const caret = await state(page);
  await page.screenshot({ path: `shots/${tag}-caret-by-tap.png` });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const after = await state(page);
  rows.push({
    test: "editing",
    tag,
    selection: { start: sel.start, end: sel.end, dir: sel.dir, value: sel.value },
    caretAfterTapAt12pct: { start: caret.start, end: caret.end },
    events: sel.entries.filter((e: any) => /selectionchange|select$/.test(e.type)).length,
    enter: after.entries.filter((e: any) => /submit|keydown|blur/.test(e.type)).slice(-4),
    activeAfterEnter: after.active
  });
  await page.close();
}

async function ime(context: BrowserContext, tag: string, touch: boolean): Promise<void> {
  const page = await open(context, "tech=top&focus=down&label=ime");
  await tapField(page, touch);
  await page.keyboard.type("Ok ");
  if (which === "webkit") {
    // No CDP in WebKit: insertText is a plain insert, no composition.
    await page.keyboard.insertText("Привет 日本");
  } else {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.imeSetComposition", { text: "にほ", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.imeSetComposition", { text: "日本", selectionStart: 2, selectionEnd: 2 });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `shots/${tag}-ime-composing.png` });
    const mid = await state(page);
    rows.push({ test: "ime-mid", tag, value: mid.value, start: mid.start, end: mid.end });
    // Commit the composition the way an IME does: the composed text is inserted.
    await cdp.send("Input.insertText", { text: "日本" });
    await page.keyboard.insertText(" Привет ");
    // A second composition, then a synthetic Enter while it is open. CDP is not a real IME:
    // this shows what keydown carries, not what a real IME does with the Enter.
    await cdp.send("Input.imeSetComposition", { text: "か", selectionStart: 1, selectionEnd: 1 });
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(100);
  await page.screenshot({ path: `shots/${tag}-ime-done.png` });
  const s = await state(page);
  const relevant = s.entries.filter((e: any) => /composition|beforeinput|^input$|keydown|submit/.test(e.type)).slice(-30);
  rows.push({ test: "ime", tag, value: s.value, events: relevant });
  await page.close();
}

let browser: Browser;
let context: BrowserContext;
if (which === "chrome") {
  browser = await chromium.launch({ channel: "chrome" });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await focusMatrix(context, false, "chrome-desktop");
  await editing(context, "chrome-desktop", false);
  await ime(context, "chrome-desktop", false);
  const page = await open(context, "tech=top");
  await page.screenshot({ path: "shots/chrome-desktop-idle.png" });
} else if (which === "chrome-mobile") {
  browser = await chromium.launch({ channel: "chrome" });
  context = await browser.newContext({ ...devices["Pixel 7"] });
  await focusMatrix(context, true, "chrome-pixel7");
  await editing(context, "chrome-pixel7", true);
  await ime(context, "chrome-pixel7", true);
  for (const path of ["/", "/resize"]) {
    const page = await open(context, "tech=top", path);
    rows.push({ test: "viewport-meta", path, meta: await page.evaluate(() => document.querySelector("meta[name=viewport]")?.getAttribute("content")), info: await page.evaluate(() => (window as any).__p12.viewportInfo()) });
    await page.close();
  }
} else {
  browser = await webkit.launch();
  context = await browser.newContext({ ...devices["iPhone 15 Pro"] });
  await focusMatrix(context, true, "webkit-iphone");
  await editing(context, "webkit-iphone", true);
  await ime(context, "webkit-iphone", true);
}
await browser.close();
await Bun.write(`logs/drive-${which}.json`, JSON.stringify(rows, null, 1));

const focusRows = rows.filter(r => r.test === "focus");
console.log(`${which}: focus matrix`);
for (const r of focusRows) console.log(`  ${String(r.tech).padEnd(9)} ${String(r.focus).padEnd(5)} pd=${r.pd} active=${r.activeAfterTap} value=${JSON.stringify(r.value)} blurs=${r.blurs} renderer=${r.renderer} act=${JSON.stringify((r.focusCalls as any[])[0]?.userActivation)}`);
for (const r of rows.filter(r => r.test !== "focus")) console.log(JSON.stringify(r));
