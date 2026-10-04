// Second probe: media from a blob: URL of bytes already fetched (the `assets.audio` seam).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit } from "playwright-core";

const out: Record<string, unknown> = {};
for (const [name, type, args] of [["chromium", chromium, ["--autoplay-policy=no-user-gesture-required", "--mute-audio"]], ["webkit", webkit, []]] as const) {
  const b = await type.launch({ args: [...args] });
  const page = await b.newPage();
  await page.goto("http://127.0.0.1:8796/probe.html");
  const res = [];
  for (const [f, t] of [["track.mp3", "audio/mpeg"], ["track.m4a", "audio/mp4"]]) {
    await page.evaluate(([fl, ty]) => (window as any).arm("blob", [fl, ty]), [f, t]);
    await page.click("#go");
    res.push(await page.evaluate(() => (window as any).result));
  }
  out[name] = res;
  await b.close();
}
writeFileSync(join(import.meta.dir, "results-blob.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
