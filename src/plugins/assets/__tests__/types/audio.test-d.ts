import { expectTypeOf } from "vitest";
import type { Api, AudioAsset, AudioMime } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error. It guards what delta 10 changed: `audio(key)` answers the
// bytes together with the MIME type of their container, not the bytes alone.
// ---------------------------------------------------------------------------

declare const assets: Api;

expectTypeOf(assets.audio).returns.toEqualTypeOf<AudioAsset | undefined>();
expectTypeOf<AudioAsset>().toEqualTypeOf<{ bytes: ArrayBuffer; mime: AudioMime }>();
expectTypeOf<AudioMime>().toEqualTypeOf<"audio/mpeg" | "audio/mp4">();

const asset = assets.audio("ui.click");

// @ts-expect-error — the answer is the record, not the bytes themselves
export const bytes: ArrayBuffer | undefined = asset;

// @ts-expect-error — only the two containers every WebView decodes are a type
export const ogg: AudioMime = "audio/ogg";
