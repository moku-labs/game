#!/usr/bin/env bun
import { runCli } from "../dist/project.mjs";

process.exitCode = await runCli(process.argv.slice(2));
