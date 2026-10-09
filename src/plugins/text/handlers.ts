/**
 * @file text plugin — the four hooks. None of them draws in place: a bundle brings fonts, a
 * bundle takes them away, a locale change marks the messages, a dev hot swap marks the labels of
 * a replaced font or icon. The layout phase of the next frame is where the strings are built
 * again.
 */
import { applyReplaced, installFonts, releaseFonts } from "./display";
import { withDeps } from "./lifecycle";
import { markDirty } from "./resolve";
import type {
  AssetsReplaced,
  BundleLoaded,
  BundleUnloaded,
  KernelSlice,
  LocaleChanged,
  TextCtx
} from "./types";

/**
 * Creates the four hook handlers. Each one builds the domain context when it first fires, not
 * while this factory runs: the kernel registers hooks before it builds the plugin APIs, so
 * nothing is resolvable yet.
 *
 * @param ctx - Kernel context of the text plugin.
 * @param reload - What a font that a dev hot swap replaced and that cannot be installed calls.
 *   The kernel passes nothing, which means the page reload; a test passes a spy.
 * @returns The four hooks of the plugin.
 */
export function createHandlers(
  ctx: KernelSlice,
  reload?: () => void
): {
  "assets:bundle-loaded": (payload: BundleLoaded) => void;
  "assets:bundle-unloaded": (payload: BundleUnloaded) => void;
  "assets:replaced": (payload: AssetsReplaced) => void;
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
     * Installs the fonts a dev hot swap replaced again and marks the labels drawn with a replaced
     * font or inline icon. The next frame builds each of them again from the new textures.
     *
     * @param payload - The bundle and the asset keys that have new bytes.
     */
    "assets:replaced": (payload: AssetsReplaced): void => {
      applyReplaced(domain(), payload.keys, reload);
    },

    /**
     * Marks every label whose content is a message. The next layout phase resolves them again,
     * and `ui` solves once over the new sizes; no projection is re-run.
     *
     * @param _payload - The locale that is current now. The messages are read from `i18n`.
     */
    "i18n:locale-changed": (_payload: LocaleChanged): void => {
      const tctx = domain();

      markDirty(tctx, label => typeof label.content !== "string");
      tctx.state.cache.clear();
      tctx.deps.time.wake();
    }
  };
}
