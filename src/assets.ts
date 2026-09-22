/**
 * @file The node-side door of the engine (subpath `./assets`, node and bun only): asset and file
 * work that has no place in a browser bundle. Today it holds the asset key scanner; a game runs it
 * as `bun run assets:keys`, the editor imports the same functions later. Re-exports only: the code
 * lives in `plugins/assets/scan/`, and this is the one import of it in `src/`.
 */
import { runCli } from "./plugins/assets/scan/cli";

export type { ScanUi } from "./plugins/assets/scan/cli";
export { emitKeys, emitManifest } from "./plugins/assets/scan/emit";
export type { ScanOptions, ScanResult } from "./plugins/assets/scan/scan";
export { scanAssets } from "./plugins/assets/scan/scan";
// eslint-disable-next-line unicorn/prefer-export-from -- the script block below needs the local binding
export { runCli };

// Run as a script: `bun src/assets.ts --root src --manifest public/assets/manifest.json --keys src/generated/assets.ts` or the built `dist/assets.mjs`.
if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
