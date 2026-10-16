/**
 * @file The native verbs of `moku-game`: a game's `config.ts` as the config of `@moku-labs/native`,
 * and one verb run over it. Node only, no package export: the bin bundles it. The only file of the
 * engine that imports `@moku-labs/native`, and only with `import()`, so a web-only game never
 * loads it.
 */
import path from "node:path";
import type { Cli, Config, Target } from "@moku-labs/native";
import type { DebugLevel } from "./build";
import type { ResolvedGameConfig } from "./types";

/** The port of the dev server Tauri's shell starts and loads. */
const DEV_PORT = 5173;

/** A native verb of `moku-game native`. */
export type NativeVerb = "build" | "dev" | "doctor" | "clean";

/** Where the game lives, and how Tauri's shell runs `moku-game` again for the web build. */
export type NativeWhere = {
  /** The game folder, absolute. */
  cwd: string;
  /** The command that runs `moku-game`, with the runner flags (`--preload`, `--serve-plugin`) in it. */
  command: string;
};

/** What the command line adds to a verb. */
export type NativeVerbOptions = {
  /** The target the command line names, unchecked. */
  target?: string;
  /** iOS: build the simulator slice instead of a device archive. */
  simulator?: boolean;
  /** Build a debug app: the web page with the editor agent and its control profile; `native build` on Android only. */
  debug?: DebugLevel;
  /** The `host:port` the page agent of the debug app dials, when `--editor` gave one. */
  editor?: string;
};

/** The debug profile of a native build: the web build's `--debug` level and its `--editor`. */
type NativeDebug = { level: DebugLevel; editor?: string | undefined };

/**
 * What `cli.build` of `@moku-labs/native` takes: the target, the iOS simulator slice, and the
 * debug profile, which native's `BuildFlavor.debug` reads (the debug app installs beside the store
 * app; the engine renames nothing).
 */
type BuildOptions = { target: Target | undefined; simulator: boolean | undefined; debug?: true };

/** The part of the `@moku-labs/native` config a game's `config.ts` decides. */
export type NativeConfig = Pick<Config, "app" | "web" | "system" | "projectDir" | "outDir"> & {
  /** The targets the native app ships. Left out, native builds for the host. */
  targets?: readonly Target[];
};

/**
 * The native section of a resolved config.
 *
 * @param settings - The resolved `config.ts` of the game.
 * @returns The native section.
 * @throws {Error} When `config.ts` has no native section.
 */
function nativeSectionOf(settings: ResolvedGameConfig): NonNullable<ResolvedGameConfig["native"]> {
  if (settings.native === undefined) {
    throw new Error(
      "[game] config.ts has no native section.\n  Add native: { name, identifier } to config.ts."
    );
  }

  return settings.native;
}

/**
 * The system rows native packages: one per system plugin that needs a Tauri capability. The
 * webview's own events and wake lock serve `lifecycle` and `keepAwake`, so they need no row. A
 * `"store"` save needs the store row even when `system` leaves it out.
 *
 * @param settings - The resolved `config.ts` of the game.
 * @returns The rows, in the order of `config.system`.
 */
function systemRowsOf(settings: ResolvedGameConfig): Config["system"] {
  const names: string[] = settings.system.filter(
    name => name !== "lifecycle" && name !== "keepAwake"
  );

  if (settings.save === "store" && !names.includes("store")) {
    names.push("store");
  }

  return names.map(name => ({ name }));
}

/**
 * The web build command native runs: `moku-game build`, with the debug profile and the editor
 * address of a debug app.
 *
 * @param where - The game folder and the command that runs `moku-game`.
 * @param debug - The debug profile, or `undefined` for a store app.
 * @returns The command.
 * @example
 * ```ts
 * webBuildOf({ cwd: "/g", command: '"bun" "/g/bin/moku-game.mjs"' }, { level: "full", editor: "192.168.1.20:47600" }); // '"bun" "/g/bin/moku-game.mjs" build --debug --editor 192.168.1.20:47600'
 * ```
 */
function webBuildOf(where: NativeWhere, debug: NativeDebug | undefined): string {
  if (debug === undefined) return `${where.command} build`;

  // `--debug` is the full profile; the read-only one is spelled out.
  const level = debug.level === "full" ? "--debug" : "--debug=read";
  const editor = debug.editor === undefined ? "" : ` --editor ${debug.editor}`;

  return `${where.command} build ${level}${editor}`;
}

/**
 * Maps a game's resolved `config.ts` to the config of `@moku-labs/native`: the app from `native`
 * and `page`, the web build through `moku-game`, the system rows, the targets, and the Tauri
 * project and output folders under the game. An Android app composes native's `shell` system
 * first, the one that sets `globalThis.__MOKU_NATIVE__`. A debug app builds its web page with the
 * same profile and `--editor`; its name and identifier stay the game's.
 *
 * @param settings - The resolved `config.ts` of the game.
 * @param where - The game folder and the command that runs `moku-game`.
 * @param target - The target of the verb, used when `config.ts` names no targets.
 * @param debug - The debug profile of a debug app; left out for a store app.
 * @returns The config for `createApp({ config })` of `@moku-labs/native`.
 * @throws {Error} When `config.ts` has no native section.
 * @example
 * ```ts
 * const where = { cwd: "/g", command: '"/usr/local/bin/bun" "/g/node_modules/@moku-labs/game/bin/moku-game.mjs" "--root" "/g"' };
 * nativeConfigOf(resolveConfig({ page: { title: "T" }, native: { name: "T", identifier: "com.x.t" } }), where, "ios").web.dist; // "/g/dist/web"
 * ```
 */
export function nativeConfigOf(
  settings: ResolvedGameConfig,
  where: NativeWhere,
  target: Target | undefined,
  debug?: NativeDebug
): NativeConfig {
  const native = nativeSectionOf(settings);
  const rows = systemRowsOf(settings);
  const config: NativeConfig = {
    app: {
      name: native.name,
      identifier: native.identifier,
      orientation: settings.page.orientation,
      backgroundColor: settings.page.background
    },
    web: {
      cwd: where.cwd,
      build: webBuildOf(where, debug),
      devCommand: `${where.command} dev --port ${DEV_PORT}`,
      devUrl: `http://127.0.0.1:${DEV_PORT}`,
      dist: path.join(where.cwd, "dist/web")
    },
    // Every Android build composes the native shell once, first.
    system:
      target === "android"
        ? [{ name: "shell" }, ...rows.filter(row => row.name !== "shell")]
        : rows,
    projectDir: path.join(where.cwd, ".moku/tauri"),
    outDir: path.join(where.cwd, "dist-native")
  };
  const targets = native.targets ?? (target === undefined ? undefined : [target]);

  if (native.icon !== undefined) {
    config.app.icon = native.icon;
  }

  if (targets !== undefined) {
    config.targets = targets;
  }

  return config;
}

/**
 * Checks the target of a verb against the targets native knows. `build` and `dev` need one.
 *
 * @param known - The `TARGETS` of `@moku-labs/native`.
 * @param verb - The native verb.
 * @param given - The target the command line names, unchecked.
 * @returns The target, or `undefined` for a `doctor` or `clean` over every target.
 * @throws {Error} When the target is unknown, or `build` or `dev` names none.
 */
function targetOf(
  known: readonly Target[],
  verb: NativeVerb,
  given: string | undefined
): Target | undefined {
  const target = known.find(name => name === given);

  if (given !== undefined && target === undefined) {
    throw new Error(`[game] No native target "${given}".\n  Name one of ${known.join(", ")}.`);
  }

  if (target === undefined && verb === "build") {
    throw new Error(
      "[game] moku-game native build needs a target.\n  Run: moku-game native build ios --simulator."
    );
  }

  if (target === undefined && verb === "dev") {
    throw new Error(
      "[game] moku-game native dev needs a target.\n  Run: moku-game native dev ios."
    );
  }

  return target;
}

/**
 * Runs one verb on the cli of a started native app.
 *
 * @param cli - The cli of the native app.
 * @param verb - The native verb.
 * @param target - The checked target.
 * @param options - The simulator flag, and the debug profile of a debug app.
 * @returns The boolean of `doctor`, true for the other verbs once they finish.
 */
async function runVerb(
  cli: Cli.Api,
  verb: NativeVerb,
  target: Target | undefined,
  options: NativeVerbOptions
): Promise<boolean> {
  switch (verb) {
    case "build": {
      const build: BuildOptions = {
        target,
        simulator: options.simulator,
        ...(options.debug === undefined ? {} : { debug: true })
      };

      await cli.build(build);
      return true;
    }
    case "dev": {
      await cli.dev({ target });
      return true;
    }
    case "doctor": {
      return cli.doctor({ target });
    }
    case "clean": {
      await cli.clean({ target });
      return true;
    }
  }
}

/**
 * Runs one native verb through `@moku-labs/native` over the game's config. Native's cli prints
 * the progress and the failure itself.
 *
 * @param verb - The native verb: build, dev, doctor or clean.
 * @param settings - The resolved `config.ts` of the game.
 * @param where - The game folder and the command that runs `moku-game`.
 * @param options - The target, the simulator flag, and the debug profile of a debug app.
 * @returns True when the verb succeeded, false when it failed.
 * @throws {Error} When `config.ts` has no native section, `@moku-labs/native` is not installed, or
 * the target is unknown or missing.
 */
export async function runNative(
  verb: NativeVerb,
  settings: ResolvedGameConfig,
  where: NativeWhere,
  options: NativeVerbOptions
): Promise<boolean> {
  nativeSectionOf(settings);

  const native = await import("@moku-labs/native").catch((error: unknown) => {
    throw new Error(
      "[game] moku-game native needs @moku-labs/native.\n  Install it: bun add -d @moku-labs/native@^0.3.9.",
      { cause: error }
    );
  });
  const target = targetOf(native.TARGETS, verb, options.target);
  const debug =
    options.debug === undefined ? undefined : { level: options.debug, editor: options.editor };
  const app = native.createApp({ config: nativeConfigOf(settings, where, target, debug) });

  await app.start();

  try {
    return await runVerb(app.cli, verb, target, options);
  } catch {
    // Native's cli has printed the failure with the last lines of the toolchain.
    return false;
  } finally {
    await app.stop();
  }
}
