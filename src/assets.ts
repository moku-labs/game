/**
 * @file The node-side door of the engine (subpath `./assets`, node and bun only): asset and file
 * work that has no place in a browser bundle. It holds the asset key scanner and the string
 * compiler; a game runs both as `bun run assets:keys`, the editor imports the same functions later.
 * Re-exports only: the code lives in `plugins/assets/scan/` and `plugins/i18n/compile/`, and this is
 * the one door to them in `src/`.
 */
import { runCli } from "./plugins/assets/scan/cli";

export type { ScanUi } from "./plugins/assets/scan/cli";
export { emitKeys, emitManifest } from "./plugins/assets/scan/emit";
export type { ScanOptions, ScanResult } from "./plugins/assets/scan/scan";
export { scanAssets } from "./plugins/assets/scan/scan";
export type { CompileOptions, CompileReport } from "./plugins/i18n/compile/compile";
export { checkStrings, compileStrings } from "./plugins/i18n/compile/compile";
// eslint-disable-next-line unicorn/prefer-export-from -- the script block below needs the local binding
export { runCli };

// Run as a script: `bun src/assets.ts --root src --manifest public/assets/manifest.json --keys src/generated/assets.ts` or the built `dist/assets.mjs`.
if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
