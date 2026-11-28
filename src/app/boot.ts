/**
 * @file The boot picture of `config.ts` `page.boot` and the launch signal. `fadeBoot`: the
 * `<img id="moku-boot">` the generated page shows from its first paint goes once the first scene
 * drew. `bootPlacement`: where a placed picture stands in a window, the TypeScript twin of the CSS
 * the page writes. `signalLaunch`: one call, in the first frame with a scene, that tells a native
 * shell to drop its launch still. Pure over the parts they get: no `document`, no global but the
 * timer. `startPage` calls them; not exported from any entry.
 */

import { fitFrame } from "../plugins/renderer/viewport/fit";
import type { Rect } from "../plugins/renderer/viewport/types";
import type { ResolvedPageBoot } from "./types";

/** The part of `app.time` the fade and the signal use: one render callback. */
type BootTime = { onFrame(phase: "render", callback: () => void): () => void };

/** The part of `app.scenes` the fade and the signal read: the mounted scene, `undefined` before the first. */
type BootScenes = { current(): string | undefined };

/** The placement of a boot picture, as `resolveConfig` gives it. */
type BootPlace = NonNullable<ResolvedPageBoot["place"]>;

/** The part of the `<img id="moku-boot">` element the fade uses. */
type BootElement = {
  style: { opacity: string };
  addEventListener(type: "transitionend", listener: () => void, options: { once: true }): void;
  remove(): void;
};

/** How long after the fade the timer removes a picture whose transition never ended, ms. */
const FALLBACK_MS = 100;

/**
 * Fades the boot picture out after the first scene drew. It adds one render callback: in the
 * first render frame with a mounted scene it sets the opacity to 0, so the page's CSS transition
 * fades it over `fadeMs`, and unsubscribes. The picture is removed on `transitionend`, or by a
 * timer `fadeMs + 100` ms later for a page in the background, where no transition ends: whichever
 * comes first removes it and clears the other, and a second removal does nothing. `fadeMs` 0
 * removes it in that frame. Before the first scene the callback is one `current()` read a frame.
 *
 * @param time - `app.time`: the render phase runs after the frame's draw.
 * @param scenes - `app.scenes`: `current()` is set before the frame that first draws the scene.
 * @param element - The `<img id="moku-boot">` of the page.
 * @param fadeMs - The fade of `page.boot`, ms.
 */
export function fadeBoot(
  time: BootTime,
  scenes: BootScenes,
  element: BootElement,
  fadeMs: number
): void {
  const off = time.onFrame("render", () => {
    // The first scene has not drawn yet: one read a frame.
    if (scenes.current() === undefined) return;

    off();

    // No fade: the picture goes in the frame the scene drew.
    if (fadeMs === 0) {
      element.remove();

      return;
    }

    // A fade: removed on its end, or by the timer on a page in the background, where no transition ends.
    let removed = false;
    const remove = (): void => {
      if (removed) return;

      removed = true;
      clearTimeout(timer);
      element.remove();
    };
    const timer = setTimeout(remove, fadeMs + FALLBACK_MS);

    element.addEventListener("transitionend", remove, { once: true });
    element.style.opacity = "0";
  });
}

/**
 * Where a placed boot picture stands in a window, in CSS pixels: the game frame `fitFrame` fits
 * into the window, `place.frame` laid over it like CSS `cover`, centred, and `place.rect` on that.
 * The CSS `bootRule` writes computes the same.
 *
 * @param viewport - The window, CSS pixels.
 * @param viewport.width - CSS width of the window.
 * @param viewport.height - CSS height of the window.
 * @param place - `page.boot.place` of the resolved config.
 * @returns The box of the picture.
 * @example
 * ```ts
 * bootPlacement({ width: 360, height: 1000 }, { frame: { width: 1024, height: 1536 }, rect: { x: 215, y: 402, width: 600, height: 640 }, aspect: { min: 4 / 3, max: 21 / 9 }, orientation: "portrait" }); // { x: 17.578125, y: 299.84375, width: 328.125, height: 350 }
 * ```
 */
export function bootPlacement(viewport: { width: number; height: number }, place: BootPlace): Rect {
  const frame = fitFrame(viewport, place.aspect, place.orientation);
  const scale = Math.max(frame.width / place.frame.width, frame.height / place.frame.height);
  const centreX = frame.x + frame.width / 2;
  const centreY = frame.y + frame.height / 2;

  return {
    x: centreX + scale * (place.rect.x - place.frame.width / 2),
    y: centreY + scale * (place.rect.y - place.frame.height / 2),
    width: scale * place.rect.width,
    height: scale * place.rect.height
  };
}

/**
 * Signals the launch once: one render callback that, in the first render frame with a mounted
 * scene (the moment `fadeBoot` acts), calls `ready` and unsubscribes. A throwing `ready` is handed
 * to `report` and the frame goes on. Before the first scene the callback is one `current()` read a
 * frame.
 *
 * @param time - `app.time`: the render phase runs after the frame's draw.
 * @param scenes - `app.scenes`: `current()` is set before the frame that first draws the scene.
 * @param ready - The signal, such as the native shell's `__mokuLaunch.ready()`.
 * @param report - Where a throwing `ready` goes.
 */
export function signalLaunch(
  time: BootTime,
  scenes: BootScenes,
  ready: () => void,
  report: (error: unknown) => void
): void {
  const off = time.onFrame("render", () => {
    // The first scene has not drawn yet: one read a frame.
    if (scenes.current() === undefined) return;

    off();

    // A broken bridge must not stop the frame of a running game.
    try {
      ready();
    } catch (error) {
      report(error);
    }
  });
}
