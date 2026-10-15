/**
 * @file The inspection: its root is the overlay (dim 0.4 over 270 ms, the root plays no motion), a full-screen tap
 * target back, a window that flies in and out over 340 ms, and the viewer of its page above the root. The root goes
 * when its window has gone back, and the picture of the ward lasts until then.
 */
import { defineMotion } from "@moku-labs/game";
import { Overlay, projection } from "../../kit";
import type { Session } from "../../state";
import { buttonAt, fullScreen, pinned } from "../ward/styles";

/** The window flies in from half its size over 340 ms, and back out. */
export const windowFly = defineMotion({
  states: { away: { Transform: { scale: 0.5 }, Shape: { alpha: 0 } } },
  transition: { ms: 340 },
  on: { enter: "away", exit: "away" }
});

export const inspectSheet = projection({
  name: "inspect.sheet",
  layer: "ui",
  from: (_player: unknown, session: Session) =>
    session.sheet === "inspect" ? [{ id: "inspect", page: session.page }] : [],
  key: (item: { id: string }) => item.id,
  view: (item: { id: string; page: boolean }) => (
    <stack key="inspectOverlay" style={fullScreen} components={[Overlay({ dim: 0.4, fade: 270 })]}>
      <button key="inspectBack" intent="close" escape style={pinned} />
      <panel
        key="inspectWindow"
        motion={windowFly}
        style={{ ...buttonAt(190, 500, 0xf0_f0_e8), width: 700, height: 800 }}
      >
        <button key="openPage" intent="page" style={buttonAt(270, 560, 0x3a_6a_9a)} />
      </panel>
      {item.page ? (
        <panel
          key="inspectViewer"
          style={{ ...buttonAt(240, 600, 0x22_22_22), width: 600, height: 300 }}
        />
      ) : undefined}
    </stack>
  )
});
