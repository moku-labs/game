/**
 * @file The info popup: a dim backdrop that answers `close`, and a panel with the spark, the
 * counter and the OK button, which answers `ok`. The panel is a plain component that takes its
 * key as the prop `id`, so the keys of its parts are patterns the project index reads: the
 * panel `infoPanel` keys its spark `infoPanelSpark`.
 */
import { type } from "@moku-labs/game";
import { defineComponent, defineStyle } from "../../kit";

/** The root of the popup: the whole viewport, the panel in the middle. */
const popupScreen = defineStyle({
  width: "100%",
  height: "100%",
  direction: "column",
  align: "center",
  justify: "center"
});

/** The dim behind the popup. */
const backdropStyle = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  fill: 0x10_16_1d,
  alpha: 0.6,
  reason: "the backdrop dims the whole screen behind the panel"
});

/** The panel: a dark plate with the spark on top. */
const panelStyle = defineStyle({
  width: 640,
  direction: "column",
  align: "center",
  gap: 32,
  padding: 48,
  radius: 32,
  fill: 0x2f_5a_3b
});

/** The spark on top of the panel. */
const panelSparkStyle = defineStyle({ width: 120, height: 120 });

/** The OK button: a honey plate as wide as a thumb is. */
const okStyle = defineStyle({ width: 320, height: 120, radius: 24, fill: 0xf2_b4_3d });

/** What a panel takes. */
export type PanelProps = {
  /** The key of the panel; its spark is keyed `<id>Spark`. */
  id: string;
  /** What the panel holds under the spark. */
  children?: unknown;
};

/**
 * The panel of a popup: the spark, then what it holds.
 *
 * @param props - The panel as the popup declares it.
 * @returns The column element.
 */
export function Panel(props: PanelProps) {
  return (
    <column key={props.id} style={panelStyle}>
      <image key={`${props.id}Spark`} texture="ui.fx-spark" style={panelSparkStyle} />
      {props.children as never}
    </column>
  );
}

/** What the popup is shown with: the counter of the save. */
export type InfoPopupProps = { count: number };

export const InfoPopup = defineComponent("InfoPopup", {
  outcomes: { ok: type(), close: type() },
  view: (props: InfoPopupProps) => (
    <screen key="infoScreen" style={popupScreen}>
      <button key="infoBackdrop" intent="close" escape style={backdropStyle} />
      <Panel id="infoPanel">
        <text key="infoCount" style="ui.counter" content={`${props.count}`} />
        <button key="infoOk" intent="ok" style={okStyle} />
      </Panel>
    </screen>
  )
});
