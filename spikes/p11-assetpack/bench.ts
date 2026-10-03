/**
 * Build time: cold (cache off) three times, then with the AssetPack cache: miss, warm no-op,
 * one ui icon changed, one board.rings frame changed, the original restored.
 * Each run is a fresh `bun pack.ts` process, so the time includes Bun start and imports.
 */
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";

const run = async (label: string, extra: string[]) => {
  const t = performance.now();
  const proc = Bun.spawn(["bun", "pack.ts", ...extra], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const wall = Math.round(performance.now() - t);
  const report = JSON.parse(text.slice(text.indexOf("{")));
  const changed = await countNewOutputs(extra.find(a => a.startsWith("--out="))?.slice(6) ?? "");
  console.log(JSON.stringify({ label, wall, ...report.timings, problems: report.problems.length, outFilesWritten: changed }));
  return { label, wall, ...report.timings };
};

let since = Date.now();
const countNewOutputs = async (name: string) => {
  const glob = new Bun.Glob("**/*");
  let n = 0;
  for await (const f of glob.scan({ cwd: `out/${name}` })) {
    const s = Bun.file(`out/${name}/${f}`);
    if ((await s.stat()).mtimeMs >= since) n++;
  }
  since = Date.now();
  return n;
};

const results = [];
for (let i = 1; i <= 3; i++) { since = Date.now(); results.push(await run(`cold ${i}`, ["--out=bench-cold"])); }

await rm(".assetpack/bench-cache", { recursive: true, force: true });
await rm("out/bench-cache", { recursive: true, force: true });
await rm("stage/bench-cache", { recursive: true, force: true });
since = Date.now();
results.push(await run("cache miss", ["--out=bench-cache", "--cache"]));
results.push(await run("cache warm, no change", ["--out=bench-cache", "--cache"]));

const icon = "input/features/ui/assets/icon-coin.webp";
const ring = "input/features/board/assets/selection-ring-2.webp";
await copyFile(icon, `${icon}.bak`);
await copyFile(ring, `${ring}.bak`);
await writeFile(icon, await sharp(await readFile(`${icon}.bak`)).modulate({ hue: 30 }).webp({ quality: 90 }).toBuffer());
results.push(await run("cache, ui.icon-coin changed", ["--out=bench-cache", "--cache"]));
await writeFile(ring, await sharp(await readFile(`${ring}.bak`)).modulate({ hue: 30 }).webp({ quality: 90 }).toBuffer());
results.push(await run("cache, board.selection-ring-2 changed", ["--out=bench-cache", "--cache"]));
await copyFile(`${icon}.bak`, icon);
await copyFile(`${ring}.bak`, ring);
await rm(`${icon}.bak`);
await rm(`${ring}.bak`);
results.push(await run("cache, both restored", ["--out=bench-cache", "--cache"]));
await writeFile("bench.json", `${JSON.stringify(results, null, 2)}\n`);
