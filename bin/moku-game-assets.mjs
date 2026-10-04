#!/usr/bin/env bun
import { compileStrings, runCli } from "../dist/assets.mjs";

process.exitCode = await runCli(process.argv.slice(2), compileStrings);
