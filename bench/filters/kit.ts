/**
 * @file The authoring helpers bound to the types of the bench, once. The bench has one asset bundle
 * and no strings: every word on its screen is test content, not a message.
 */
import { defineGame } from "../../src/index.ts";
import type { AssetKey, BundleKey } from "./generated/assets";

/** The bench saves nothing and keeps nothing in its session. */
export type Empty = Record<string, never>;

/** The scenes of the graph: what is on them is the bench's own business. `bench-b` is the other side of a `trans-*` arm. */
export type SceneId = "bench" | "bench-b";

export const {
  defineBundles,
  defineEmitter,
  defineFeature,
  defineFlow,
  defineNode,
  defineScene,
  defineTextStyles,
  Emitter
} = defineGame<{
  player: Empty;
  session: Empty;
  assets: AssetKey;
  bundles: BundleKey;
  scenes: SceneId;
  strings: Empty;
  textStyles: "body" | "bench.digits";
  emitters: "fx.ember";
}>();
