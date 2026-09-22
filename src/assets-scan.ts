/**
 * @file Asset scanner entry (subpath `./assets-scan`, node and bun only). A game runs it as
 * `bun run assets:keys`; the editor imports the same functions later. Never part of the browser
 * bundle: the only import of `plugins/assets/scan/` in `src/`.
 */
import { main } from "./plugins/assets/scan/cli";

export type { ScanUi } from "./plugins/assets/scan/cli";
export { emitKeys, emitManifest } from "./plugins/assets/scan/emit";
export type { ScanOptions, ScanResult } from "./plugins/assets/scan/scan";
export { scanFeatures } from "./plugins/assets/scan/scan";
// eslint-disable-next-line unicorn/prefer-export-from -- the script block below needs the local binding
export { main };

// Run as a script: `bun src/assets-scan.ts --root .` or the built `dist/assets-scan.mjs`.
if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
