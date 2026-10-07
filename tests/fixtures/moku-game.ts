/**
 * @file The `moku-game` bin of the engine repo: the package bin runs the built `dist/cli.mjs`,
 * this one runs the source. `bun tests/fixtures/moku-game.ts dev --root tests/fixtures/mini-game`
 * serves the mini game, `bun run mini:dev` names it, and the integration tests spawn it.
 */
import { runCli } from "../../src/cli";

process.exitCode = await runCli(process.argv.slice(2));
