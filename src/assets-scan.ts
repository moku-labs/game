/**
 * @file Asset scanner entry (subpath `./assets-scan`, node and bun only). A game runs it as
 * `bun run assets:keys`; the editor imports the same functions later. Never part of the browser
 * bundle: the only import of `plugins/assets/scan/` in `src/`.
 */
import { runCli } from "./plugins/assets/scan/cli";

export type { ScanUi } from "./plugins/assets/scan/cli";
export { emitKeys, emitManifest } from "./plugins/assets/scan/emit";
export type { ScanOptions, ScanResult } from "./plugins/assets/scan/scan";
export { scanAssets } from "./plugins/assets/scan/scan";
// eslint-disable-next-line unicorn/prefer-export-from -- the script block below needs the local binding
export { runCli };

// Run as a script: `bun src/assets-scan.ts --root src --manifest public/assets/manifest.json --keys src/generated/assets.ts` or the built `dist/assets-scan.mjs`.
if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
