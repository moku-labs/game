#!/usr/bin/env bun
import { compileStrings, exportStrings, importStrings, runCli } from "../dist/assets.mjs";

process.exitCode = await runCli(process.argv.slice(2), {
  compile: compileStrings,
  exportStrings,
  importStrings
});
