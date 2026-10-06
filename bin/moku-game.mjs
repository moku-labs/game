#!/usr/bin/env bun
import { runCli } from "../dist/cli.mjs";

process.exitCode = await runCli(process.argv.slice(2));
