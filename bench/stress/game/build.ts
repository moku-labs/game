#!/usr/bin/env bun
/**
 * @file Builds the real game with this checkout's engine as a debug app under its own app id, for a measured walk on
 * the phone: `bun bench/stress/game/build.ts --game <game repo> --work <scratch dir> [--id hotpath] [--names]`.
 * It never writes into the game's repo: it copies the game into the scratch folder, pins `@moku-labs/game` to a
 * tarball of this checkout, renames the app (`<identifier>.<id>`, so the debug app is `<identifier>.<id>.debug`),
 * builds the Android debug app for arm64 only, and leaves `<work>/keep/game-<id>.apk` and `<work>/keep/web-<id>`.
 * `--names` builds without minification, so a CPU or allocation profile reads as the source does; its timings are
 * not a release's. The copy with its Rust build takes about 5 GB of disk: it is removed at the end.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    game: { type: "string" },
    work: { type: "string" },
    id: { type: "string", default: "hotpath" },
    names: { type: "boolean", default: false }
  }
});

if (values.game === undefined || values.work === undefined) {
  console.error(
    "Usage: bun bench/stress/game/build.ts --game <game repo> --work <scratch dir> [--id hotpath] [--names]"
  );
  process.exit(2);
}

const engine = path.resolve(import.meta.dir, "..", "..", "..");
const game = path.resolve(values.game);
const work = path.resolve(values.work);
const copy = path.join(work, "game");
const pack = path.join(work, "pack");
const keep = path.join(work, "keep");
const suffix = values.names ? `${values.id}-names` : values.id;

/**
 * Runs a command and stops the build when it fails.
 *
 * @param cwd - Where it runs.
 * @param words - The command and its arguments.
 * @returns Resolves when it ended with code 0.
 * @throws {Error} When the command failed.
 */
async function run(cwd: string, ...words: string[]): Promise<void> {
  console.log(`› ${words.join(" ")}`);

  const child = Bun.spawn(words, { cwd, stdout: "inherit", stderr: "inherit" });

  if ((await child.exited) !== 0) throw new Error(`[stress] ${words[0]} failed in ${cwd}`);
}

/**
 * Replaces one piece of a file's text, and stops when the piece is not there once.
 *
 * @param file - The file.
 * @param from - The text to find.
 * @param to - What stands there afterwards.
 * @throws {Error} When the text is not in the file exactly once.
 */
function patch(file: string, from: string, to: string): void {
  const text = readFileSync(file, "utf8");

  if (text.split(from).length !== 2)
    throw new Error(`[stress] "${from.slice(0, 40)}…" is not once in ${file}`);

  writeFileSync(file, text.replace(from, to));
}

rmSync(copy, { recursive: true, force: true });
rmSync(pack, { recursive: true, force: true });
mkdirSync(pack, { recursive: true });
mkdirSync(keep, { recursive: true });

// The engine of this checkout, as the package a game installs.
await run(engine, "bun", "run", "build");
await run(engine, "bun", "pm", "pack", "--destination", pack);

// The game, without its history, its builds and its tool folders; its installed packages with their own `dist`.
await run(
  work,
  "rsync",
  "-a",
  "--exclude",
  "/.git",
  "--exclude",
  "/dist",
  "--exclude",
  "/dist-native",
  "--exclude",
  "/dist-native-dev",
  "--exclude",
  "/coverage",
  "--exclude",
  "/.claude",
  "--exclude",
  "/.moku",
  "--exclude",
  "/.planning",
  `${game}/`,
  `${copy}/`
);

const manifest = JSON.parse(readFileSync(path.join(copy, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

manifest.dependencies["@moku-labs/game"] = "file:../pack/moku-labs-game-0.0.0.tgz";
delete manifest.scripts.postinstall;
writeFileSync(path.join(copy, "package.json"), JSON.stringify(manifest, undefined, 2));

// The app's own id: its save and its install stand beside the game's, never over them.
const config = path.join(copy, "config.ts");
const identifier = /identifier: "([^"]+)"/.exec(readFileSync(config, "utf8"))?.[1];

if (identifier === undefined)
  throw new Error("[stress] no native identifier in the game's config.ts");

patch(config, `identifier: "${identifier}"`, `identifier: "${identifier}.${values.id}"`);
await run(copy, "bun", "install");

// One ABI: the phone's. Four of them fill the disk for nothing.
patch(
  path.join(copy, "node_modules", "@moku-labs", "native", "dist", "index.mjs"),
  'opts.aab ? "--aab" : "--apk"\n\t];',
  'opts.aab ? "--aab" : "--apk",\n\t\t"--target",\n\t\t"aarch64"\n\t];'
);

if (values.names) {
  patch(
    path.join(copy, "node_modules", "@moku-labs", "game", "dist", "cli.mjs"),
    "minify: true,",
    "minify: false,"
  );
}

await run(copy, "bun", "run", "native", "build", "android", "--debug");
cpSync(
  path.join(copy, "dist-native", "android-debug", "app-universal-release.apk"),
  path.join(keep, `game-${suffix}.apk`)
);
rmSync(path.join(keep, `web-${suffix}`), { recursive: true, force: true });
cpSync(path.join(copy, "dist", "web"), path.join(keep, `web-${suffix}`), { recursive: true });
rmSync(copy, { recursive: true, force: true });
rmSync(pack, { recursive: true, force: true });
const built = path.join(keep, `game-${suffix}.apk`);

console.log(`[stress] ${built}: the app ${identifier}.${values.id}.debug`);
