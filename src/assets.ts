/**
 * @file The node-side door of the engine (subpath `./assets`, node and bun only): asset and file
 * work that has no place in a browser bundle. It holds the asset key scanner, the production
 * packer, the string compiler and the exchange with translators; a game runs them as
 * `bun run assets:keys` (`--pseudo` for the pseudo-locale), `bun run assets:pack` (`--pack <dir>`),
 * `bun run assets:export` (`--export <dir>`) and `bun run assets:import` (`--import <dir>`), the
 * editor imports the same functions later. Re-exports only: the code lives in
 * `plugins/assets/scan/` and `plugins/i18n/compile/`, and this is the one door to them in `src/`.
 */
import { runCli } from "./plugins/assets/scan/cli";
import { compileStrings } from "./plugins/i18n/compile/compile";
import { exportStrings, importStrings } from "./plugins/i18n/compile/exchange";

export type {
  ScanUi,
  StringsCompiler,
  StringsExporter,
  StringsImporter,
  StringsReport,
  StringsTools
} from "./plugins/assets/scan/cli";
export { emitKeys, emitManifest } from "./plugins/assets/scan/emit";
export type { PackOptions, PackResult } from "./plugins/assets/scan/pack/pack";
export { packAssets } from "./plugins/assets/scan/pack/pack";
export type { ScanOptions, ScanResult } from "./plugins/assets/scan/scan";
export { scanAssets } from "./plugins/assets/scan/scan";
export type { CompileOptions, CompileReport } from "./plugins/i18n/compile/compile";
export { checkStrings } from "./plugins/i18n/compile/compile";
export type {
  ExchangeOptions,
  ExportReport,
  ImportOptions,
  ImportReport
} from "./plugins/i18n/compile/exchange";
// eslint-disable-next-line unicorn/prefer-export-from -- the script block below needs the local bindings
export { compileStrings, exportStrings, importStrings, runCli };

// Run as a script: `bun src/assets.ts --root src --manifest public/assets/manifest.json --keys src/generated/assets.ts`
// (add `--pack dist/assets` for the production pack, `--export translations` or
// `--import translations` for the translators) or the built `dist/assets.mjs`.
if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2), {
    compile: compileStrings,
    exportStrings,
    importStrings
  });
}
