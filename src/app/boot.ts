/**
 * @file The fade of the boot picture, `config.ts` `page.boot`: the `<img id="moku-boot">` the
 * generated page shows from its first paint goes once the first scene drew. Pure over the parts it
 * gets: no `document`, no global but the timer. `startPage` calls it; not exported from any entry.
 */

/** The part of `app.time` the fade uses: one render callback. */
type BootTime = { onFrame(phase: "render", callback: () => void): () => void };

/** The part of `app.scenes` the fade reads: the mounted scene, `undefined` before the first. */
type BootScenes = { current(): string | undefined };

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
