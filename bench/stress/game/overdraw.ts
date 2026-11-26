#!/usr/bin/env bun
/**
 * @file Reads the overdraw pictures `walk.ts` took: `bun bench/stress/game/overdraw.ts <dir>`. In the heat map a pixel's
 * brightness counts the layers drawn there, 1/16 white a layer, white at sixteen. The mean brightness over the
 * game's canvas gives the layers per pixel; times the pixels of the canvas, the megapixels one frame fills.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [folder] = process.argv.slice(2);

if (folder === undefined) {
  console.error("Usage: bun overdraw.ts <dir>");
  process.exit(2);
}

for (const file of readdirSync(folder).filter(
  name => name.startsWith("overdraw-") && name.endsWith(".json")
)) {
  const meta = JSON.parse(readFileSync(path.join(folder, file), "utf8")) as {
    name: string;
    canvas: {
      width: number;
      height: number;
      cssWidth: number;
      cssHeight: number;
      views: number;
      drawCalls: number;
      path: string;
    };
    screen: { top: number; dpr: number };
  };
  const image = sharp(path.join(folder, file.replace(".json", ".png")));
  const size = await image.metadata();
  // The canvas inside the picture: under the status bar on the phone, the whole picture on the desktop.
  const top = Math.min(Math.round(meta.screen.top), (size.height ?? 1) - 1);
  const height = Math.min(
    Math.round(meta.canvas.cssHeight * meta.screen.dpr),
    (size.height ?? 0) - top
  );
  const { data, info } = await image
    .extract({ left: 0, top, width: size.width ?? 0, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let saturated = 0;
  let worst = 0;

  for (let at = 0; at < data.length; at += info.channels) {
    const value = Math.max(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0);

    sum += value;
    worst = Math.max(worst, value);
    if (value >= 250) saturated += 1;
  }

  const pixels = data.length / info.channels;
  const layers = (sum / pixels / 255) * 16;
  const canvasMpx = (meta.canvas.width * meta.canvas.height) / 1e6;

  console.info(
    JSON.stringify({
      screen: meta.name,
      path: meta.canvas.path,
      views: meta.canvas.views,
      drawCalls: meta.canvas.drawCalls,
      canvasMpx: Math.round(canvasMpx * 100) / 100,
      layers: Math.round(layers * 100) / 100,
      mostLayers: Math.round((worst / 255) * 16 * 10) / 10,
      saturatedShare: Math.round((saturated / pixels) * 1000) / 10,
      mpxPerFrame: Math.round(layers * canvasMpx * 100) / 100
    })
  );
}
