/**
 * @file The Home screen: the counter of the save, the note with the spark inside it, and the round
 * info button, which answers the `home` gate with the intent `info` and glows.
 */
import { projection, tr } from "../../kit";
import type { Player } from "../../state";
import { infoButton, infoGlow, screenStyle } from "./styles";

/**
 * Home as the view reads it: the counter.
 *
 * @example
 * ```ts
 * const view: HomeView = { count: 3 };
 * ```
 */
export type HomeView = { count: number };

/** The Home screen: one item, so the projection needs no key. */
export const homeScreen = projection({
  name: "home.screen",
  layer: "ui",
  from: (player: Player): HomeView => ({ count: player.count }),
  view: item => (
    <screen key="homeScreen" style={screenStyle}>
      <text key="counter" style="ui.counter" content={`${item.count}`} />
      <text key="note" style="ui.note" content={tr("home.note")} />
      <button key="info" intent="info" style={infoButton.disc} components={[infoGlow]}>
        <image key="infoIcon" texture="ui.fx-spark" style={infoButton.picture} />
      </button>
    </screen>
  )
});
