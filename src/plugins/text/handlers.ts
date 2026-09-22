/**
 * @file text plugin — the three hooks. None of them does work in place: a bundle brings fonts, a
 * bundle takes them away, a locale change marks the messages. The layout phase of the next frame
 * is where the strings are built again.
 */
import { installFonts, releaseFonts } from "./display";
import { withDeps } from "./lifecycle";
import { markDirty } from "./resolve";
import type { BundleLoaded, BundleUnloaded, KernelSlice, LocaleChanged, TextCtx } from "./types";

/**
 * Creates the three hook handlers. Each one builds the domain context when it first fires, not
 * while this factory runs: the kernel registers hooks before it builds the plugin APIs, so
 * nothing is resolvable yet.
 *
 * @param ctx - Kernel context of the text plugin.
 * @returns The three hooks of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "assets:bundle-loaded": (payload: BundleLoaded) => void;
  "assets:bundle-unloaded": (payload: BundleUnloaded) => void;
  "i18n:locale-changed": (payload: LocaleChanged) => void;
} {
  let text: TextCtx | undefined;

  /**
   * The domain context, built on the first hook that fires.
   *
   * @returns The domain context of the plugin.
   */
  const domain = (): TextCtx => {
    text ??= withDeps(ctx);

    return text;
  };

  return {
    /**
     * Reads the fonts a bundle brought. Bounded by the font keys of the styles, so nothing here
     * grows with the number of files.
     *
     * @param _payload - Which bundle landed. The fonts are looked up by key.
     */
    "assets:bundle-loaded": (_payload: BundleLoaded): void => {
      installFonts(domain());
    },

    /**
     * Lets go of the fonts a bundle took away. The next load installs them again.
     *
     * @param payload - The bundle that left and the asset keys that went with it.
     */
    "assets:bundle-unloaded": (payload: BundleUnloaded): void => {
      releaseFonts(domain(), payload.keys);
    },

    /**
     * Marks every label whose content is a message. The next layout phase resolves them again,
     * and `ui` solves once over the new sizes; no projection is re-run.
     *
     * @param _payload - The locale that is current now. The messages are read from `i18n`.
     */
    "i18n:locale-changed": (_payload: LocaleChanged): void => {
      const tctx = domain();

      markDirty(tctx, true);
      tctx.state.cache.clear();
      tctx.deps.time.wake();
    }
  };
}
