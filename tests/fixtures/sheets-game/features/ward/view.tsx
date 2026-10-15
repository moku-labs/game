/**
 * @file The ward: a full-screen root, a frosted backdrop in it (the built-in `Blur` on a filled child that spans the
 * screen, so a picture of it is "blurred"), three glints that twinkle forever, the energy label under every sheet, and the
 * buttons that open the sheets. The inspected object goes transparent while the inspection is open.
 */
import { Blur, defineMotion } from "@moku-labs/game";
import { projection } from "../../kit";
import type { Player, Session } from "../../state";
import { buttonAt, fullScreen, pinned } from "./styles";

/** One glint's endless twinkle: a turn to 0.3 rad and back, every 900 ms. */
export const twinkle = defineMotion({
  keyframes: {
    twinkle: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 0.5, Transform: { rotation: 0.3 } },
      { at: 1, Transform: { rotation: 0 } }
    ]
  },
  transition: { ms: 900 },
  loop: { track: "twinkle", ms: 900 },
  on: {}
});

/**
 * The ward as its view reads it.
 *
 * @example
 * ```ts
 * const view: WardView = { energy: 5, inspecting: false };
 * ```
 */
export type WardView = { energy: number; inspecting: boolean };

/** The three glints, by key and place. */
const GLINTS = [
  { key: "glintA", left: 120, top: 300 },
  { key: "glintB", left: 520, top: 520 },
  { key: "glintC", left: 820, top: 260 }
] as const;

export const wardRoot = projection({
  name: "ward.root",
  layer: "scene",
  from: (player: Player, session: Session): WardView => ({
    energy: player.energy,
    inspecting: session.sheet === "inspect"
  }),
  view: item => (
    <stack key="wardRoot" style={fullScreen}>
      <stack
        key="wardFrost"
        style={{ ...pinned, fill: 0x2a_3d_4f }}
        components={[Blur({ strength: 4 })]}
      >
        {GLINTS.map(glint => (
          <panel
            key={glint.key}
            motion={twinkle}
            style={{ ...buttonAt(glint.left, glint.top, 0xf2_d4_7a), width: 60, height: 60 }}
          />
        ))}
      </stack>
      <text key="wardEnergy" style="ui.count" content={`${item.energy}`} />
      <button
        key="wardObject"
        intent="inspect"
        style={{ ...buttonAt(460, 900, 0x8d_6e_4f), alpha: item.inspecting ? 0 : 1 }}
      />
      <button key="wardCase" intent="casefile" style={buttonAt(120, 1300, 0x5a_7d_9a)} />
      <button key="wardBoard" intent="board" style={buttonAt(800, 1300, 0x4f_8d_5a)} />
    </stack>
  )
});
