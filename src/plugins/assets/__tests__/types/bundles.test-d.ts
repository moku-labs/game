import type { Descriptor } from "../../../flow/types";
import { bundlesFor, defineBundles } from "../../bundles";
import type { BundleCompanion, LoadResult } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only: `tsc --noEmit` is the runner, and every `@ts-expect-error`
// below fails the build when it stops being an error. A bundle declares its
// release and its mipmaps; a companion's `load` is awaited, so it returns a
// promise.
// ---------------------------------------------------------------------------

defineBundles({ ep01: { tier: "lazy", release: "leave", mipmaps: ["items/**"] } });
defineBundles({ ep01: { tier: "lazy", release: "budget", mipmaps: true } });

// @ts-expect-error — a bundle leaves with the budget or with its feature, never "never"
defineBundles({ ep01: { tier: "lazy", release: "never" } });

// @ts-expect-error — one glob is still a list of globs
defineBundles({ ep01: { tier: "lazy", mipmaps: "items/**" } });

// @ts-expect-error — no mipmaps is the key left out, not false
defineBundles({ ep01: { tier: "lazy", mipmaps: false } });

const game = bundlesFor<"ep01" | "ep01.extra">();

game.defineBundles({ ep01: { tier: "lazy", release: "leave" } });

// @ts-expect-error — a game-bound defineBundles takes the bundle keys the scanner wrote only
game.defineBundles({ ep02: { tier: "lazy" } });

game.ready(["ep01", "ep01.extra"]);

// @ts-expect-error — a game-bound ready takes the bundle keys the scanner wrote only
game.ready("ep02");

/** What `await fx(ready(...))` resolves with: `undefined` in an app without assets, hence `=== false`. */
export const answer: Descriptor<boolean | undefined> = game.ready("ep01");

// @ts-expect-error — `ready` is no `load`: it resolves a boolean, not a LoadResult
export const loaded: Descriptor<LoadResult | undefined> = game.ready("ep01");

export const awaited: BundleCompanion = { load: async () => undefined, unload: () => undefined };

// @ts-expect-error — the bundle waits for `load`, so it must return a promise
export const unawaited: BundleCompanion = { load: () => undefined, unload: () => undefined };
