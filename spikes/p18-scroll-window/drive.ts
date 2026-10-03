// Spike P18 driver. Start `bun spikes/p18-scroll-window/serve.ts`, then `bun spikes/p18-scroll-window/drive.ts`.
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=metal", "--disable-gpu-vsync=false"]
});
const out = [];
for (const n of [50, 200, 1000]) {
  for (const mode of ["full", "window"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const logs: string[] = [];
    page.on("console", m => { if (m.type() === "error") logs.push(m.text().slice(0, 200)); });
    page.on("pageerror", e => logs.push(String(e).slice(0, 200)));
    await page.goto(`http://localhost:3118/?n=${n}&mode=${mode}`);
    await page.waitForFunction(() => "p18" in globalThis, undefined, { timeout: 60_000 });
    const result = await page.evaluate(() => (globalThis as any).p18.run());
    if (mode === "full" || n === 1000) await page.screenshot({ path: `${import.meta.dir}/shots/${n}-${mode}.png` });
    out.push({ ...result, errors: logs.slice(0, 3) });
    console.log(JSON.stringify(out.at(-1)));
    await page.close();
  }
}
await browser.close();
await Bun.write(`${import.meta.dir}/metrics-browser.json`, JSON.stringify(out, null, 2));
