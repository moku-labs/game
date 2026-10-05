/**
 * @file The project door of the engine (subpath `./project`, node and bun only): the static index
 * of a game's sources. `openProject` parses the game with TypeScript (an optional peer, loaded on
 * the first open) and maps every engine id (flows, nodes, features, scenes, projections, emitters,
 * text styles, styles and JSX keys) to anchors; `find` reads the line of a key from the file on
 * disk at the call, `watch` keeps the index fresh while agents edit files. The package bin
 * `moku-game-index` runs `runCli`. Re-exports only: the code lives in `project/`, and this is the
 * one door to it in `src/`.
 */
import { runCli } from "./project/cli";

export { openProject } from "./project/open";
export type {
  Anchor,
  Found,
  IndexUi,
  JsxKind,
  ProjectApi,
  ProjectChange,
  ProjectIndex,
  ProjectOptions
} from "./project/types";
// eslint-disable-next-line unicorn/prefer-export-from -- the script block below needs the local binding
export { runCli };

// Run as a script: `bun src/project.ts --root tests/integration/merge-game where node:board/merge`
// or the built `dist/project.mjs`.
if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
