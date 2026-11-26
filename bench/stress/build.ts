#!/usr/bin/env bun
/**
 * @file The measured page of the stress bench: `bun bench/stress/build.ts`. A release build of the bench
 * (`moku-game build`), then its script bundled again as an agent build: the dev flag `false`, so no dev-only work
 * runs in a frame, and the agent flag `true`, so the monitor keeps its frame ring. No editor agent, no control.
 * The page lands in `bench/stress/dist/web`.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runCli } from "../../src/cli";

const root = import.meta.dir;
const out = path.join(root, "dist", "web");

if ((await runCli(["build", "--root", root])) !== 0) process.exit(1);

const folder = path.join(root, ".moku", "agent");

mkdirSync(folder, { recursive: true });
writeFileSync(
  path.join(folder, "flags.ts"),
  "globalThis.__MOKU_GAME_AGENT__ = true;\nglobalThis.__MOKU_GAME_DEV__ = false;\nexport {};\n"
);
writeFileSync(
  path.join(folder, "main.ts"),
  [
    'import "./flags.ts";',
    'import { startPage } from "../../../../src/app/page.ts";',
    'import game from "../../index.ts";',
    'import config from "../../config.ts";',
    "",
    "await startPage(game, config);",
    ""
  ].join("\n")
);

const html = readFileSync(path.join(out, "index.html"), "utf8");
const script = /<script[^>]*src="\.\/([^"]+\.js)"/.exec(html)?.[1];

if (script === undefined) throw new Error("[stress] build: no script in the page.");

const result = await Bun.build({
  entrypoints: [path.join(folder, "main.ts")],
  outdir: out,
  publicPath: "./",
  // Names are kept: a profile of the page reads as the source does.
  minify: process.env.STRESS_MINIFY === "1",
  target: "browser",
  define: {
    __MOKU_GAME_DEV__: "false",
    __MOKU_GAME_AGENT__: "true",
    __MOKU_GAME_CONTROL__: "false"
  },
  naming: {
    entry: script,
    chunk: "page/[name]-[hash].[ext]",
    asset: "page/[name]-[hash].[ext]"
  },
  throw: false
});

if (!result.success)
  throw new Error(["[stress] build failed.", ...result.logs.map(String)].join("\n"));

console.info(`[stress] agent page in ${out}: ${readdirSync(out).join(", ")}`);
