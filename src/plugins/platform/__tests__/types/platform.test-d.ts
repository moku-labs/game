import { expectTypeOf } from "vitest";
import { createApp, screen } from "../../../../index";
import { haptic } from "../../../anim/timeline/steps";
import { platformPlugin } from "../../index";
import type { BackResult, Config, HapticKind, PlatformApi, PlatformProvider } from "../../types";

// ---------------------------------------------------------------------------
// Type-level only. This file is not collected by vitest: `tsc --noEmit` is the
// runner, and every `@ts-expect-error` below fails the build when it stops
// being an error.
// ---------------------------------------------------------------------------

const app = createApp({ plugins: [...screen, platformPlugin] });

expectTypeOf(app.platform.back()).toEqualTypeOf<BackResult>();
expectTypeOf<BackResult>().toEqualTypeOf<"popup" | "intent" | "exit" | "none">();
expectTypeOf<PlatformApi["back"]>().toEqualTypeOf<() => BackResult>();
expectTypeOf<PlatformApi["exit"]>().toEqualTypeOf<() => void>();
expectTypeOf(app.platform.exit()).toEqualTypeOf<void>();
expectTypeOf<Config["provider"]>().toEqualTypeOf<PlatformProvider | undefined>();
expectTypeOf<Config["keepAwake"]>().toEqualTypeOf<boolean>();
expectTypeOf<PlatformProvider["haptic"]>().parameter(0).toEqualTypeOf<HapticKind>();
expectTypeOf<Parameters<PlatformProvider["onBack"]>[0]>().toEqualTypeOf<() => boolean>();

/** Does nothing. */
const noop = (): void => undefined;

/** Subscribes to nothing and hands back a remover that does nothing. */
const subscribe = (): (() => void) => noop;

/** A provider that does nothing, the shape a game fills. */
const quiet: PlatformProvider = {
  onPause: subscribe,
  onResume: subscribe,
  onBack: subscribe,
  haptic: noop,
  keepAwake: noop,
  exit: noop
};

expectTypeOf(quiet).toMatchTypeOf<Config["provider"]>();

// @ts-expect-error — `exit` is missing: a provider fills all six members.
const partial: PlatformProvider = {
  onPause: subscribe,
  onResume: subscribe,
  onBack: subscribe,
  haptic: noop,
  keepAwake: noop
};

expectTypeOf(partial).toMatchTypeOf<PlatformProvider>();

// @ts-expect-error — "buzz" is not one of the seven haptic kinds.
haptic("buzz");

createApp({
  plugins: [...screen, platformPlugin],
  // @ts-expect-error — keepAwake is a boolean.
  pluginConfigs: { platform: { keepAwake: "yes" } }
});
