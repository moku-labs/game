// Spike P9. Two screenshots mid-run, to see that the emitter draws what it should. bun shots.ts
import { chromium } from "playwright-core";

const built = await Bun.build({ entrypoints: [`${import.meta.dir}/index.html`], minify: true });
const files = new Map<string, Blob>();
for (const output of built.outputs) files.set(output.path.replace(/^\.\//, "/"), output);
const server = Bun.serve({
  port: 3059,
  fetch(request) {
    const path = new URL(request.url).pathname;
    const file = files.get(path === "/" ? "/index.html" : path);
    return file ? new Response(file, { headers: { "Content-Type": file.type } }) : new Response("", { status: 404 });
  }
});
const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--enable-unsafe-webgpu"] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await page.goto(server.url.href);
await page.waitForFunction(() => (window as unknown as { p9?: unknown }).p9 !== undefined);
type P9 = { runLoad: (m: string, t: number) => Promise<unknown>; runBursts: (f?: number) => Promise<unknown> };
void page.evaluate(() => (window as unknown as { p9: P9 }).p9.runBursts(200));
await page.waitForTimeout(700);
await page.screenshot({ path: `${import.meta.dir}/shots/bursts.png` });
await page.waitForTimeout(1500);
void page.evaluate(() => (window as unknown as { p9: P9 }).p9.runLoad("full", 5000));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${import.meta.dir}/shots/load-full-5k.png` });
await page.waitForTimeout(2500);
await browser.close();
server.stop();
