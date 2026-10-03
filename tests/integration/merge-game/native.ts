/**
 * @file The native app of the fixture game on `@moku-labs/native`: Timber Town as a Tauri app,
 * held in portrait, on the dark of the page, with the packed fixture as its web build. The page
 * talks to the shell through the system app of `web/main.ts`. Run from the root of the repository:
 *
 * - `bun run fixture:native ios --simulator` builds the simulator app into `dist/native/ios/`.
 * - `bun run fixture:native ios` builds a device archive, `android` an installable `.apk`.
 * - `--page <html>` packs another page around `web/main.ts`, as the e2e station does with its
 *   probe.
 *
 * The web build packs the assets, then bundles the page with them into `dist/web/`. The generated
 * Tauri project lives in `dist/tauri/`. Both are build output and never committed.
 */
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";
import type { Target } from "@moku-labs/native";
import { createApp, TARGETS } from "@moku-labs/native";

/** What the command line asks for: the target, the simulator slice, and another page. */
type NativeOptions = {
  /** The target the first argument names, `undefined` when it names none. */
  target: Target | undefined;
  /** The first argument as given, for the error. */
  given: string;
  /** iOS: build the simulator slice instead of a device archive. */
  simulator: boolean;
  /** The absolute path of another page to pack, `undefined` for `web/index.html`. */
  page: string | undefined;
};

/** The folder of the fixture game. */
const gameFolder = new URL(".", import.meta.url).pathname;

/**
 * Reads the command line: the target first, then `--simulator` and `--page <html>`.
 *
 * @param argv - The arguments after the script.
 * @returns The target, whether to build the simulator slice, and the page.
 */
function optionsOf(argv: readonly string[]): NativeOptions {
  const at = argv.indexOf("--page");
  const page = at === -1 ? undefined : argv[at + 1];

  return {
    target: TARGETS.find(target => target === argv[0]),
    given: argv[0] ?? "",
    simulator: argv.includes("--simulator"),
    page: page === undefined ? undefined : path.resolve(page)
  };
}

/**
 * Builds the native app for one target.
 *
 * @param target - The target to build.
 * @param options - The simulator slice and the page.
 */
async function build(target: Target, options: NativeOptions): Promise<void> {
  const page = options.page === undefined ? "" : ` --page ${JSON.stringify(options.page)}`;
  const native = createApp({
    config: {
      app: {
        name: "Лесной городок",
        identifier: "com.mokulabs.timber",
        orientation: "portrait",
        backgroundColor: "#10161d"
      },
      web: {
        cwd: path.join(gameFolder, "../../.."),
        build: `bun run fixture:pack && bun tests/integration/merge-game/web/build.ts${page}`,
        devCommand: "bun tests/integration/merge-game/web/serve.ts --port 5173",
        devUrl: "http://localhost:5173",
        dist: "tests/integration/merge-game/dist/web"
      },
      // lifecycle and keepAwake need no row: the webview's own events and wake lock serve them.
      system: [{ name: "back" }, { name: "haptics" }],
      targets: [target],
      projectDir: path.join(gameFolder, "dist/tauri"),
      outDir: path.join(gameFolder, "dist/native")
    }
  });

  await native.start();

  try {
    await native.cli.build({ target, simulator: options.simulator });
  } catch {
    // The cli has printed the failure with the last lines of the toolchain.
    process.exitCode = 1;
  } finally {
    await native.stop();
  }
}

const options = optionsOf(process.argv.slice(2));

if (options.target === undefined) {
  createBrandConsole().error(
    `no target "${options.given}".\n` +
      `Name one of ${TARGETS.join(", ")}: bun run fixture:native ios --simulator.`
  );
  process.exitCode = 1;
} else {
  await build(options.target, options);
}
