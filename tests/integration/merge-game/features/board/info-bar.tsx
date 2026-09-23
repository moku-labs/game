/**
 * @file The sawmill info bar (design §6 B4): a wooden pill anchored above the bottom safe edge
 * with the sawmill icon, its name, one pip per charge and the count, "3/4". The charges come from
 * the save and the maximum from the generator table, so the bar says what a tap would find.
 */
import { defineStyle, tr } from "../../kit";
import type { Player } from "../../state";
import { generatorId, tables } from "../../tables";
import { theme } from "../ui/kit";

/**
 * The sawmill as the bar reads it: the charges it has and the charges it can hold.
 *
 * @example
 * ```ts
 * const sawmill: SawmillView = { charges: 3, max: 4 };
 * ```
 */
export type SawmillView = { charges: number; max: number };

/** The bar: 160 tall, 40 units above the bottom safe edge (design §5.6). */
const barStyle = defineStyle({
  direction: "row",
  align: "center",
  justify: "center",
  gap: 20,
  width: 760,
  height: 160,
  margin: { bottom: 40 },
  padding: { left: 32, right: 40 },
  nineSlice: "ui.hud-pill"
});

/** The sawmill picture at the left end of the bar. */
const iconStyle = defineStyle({ width: 112, height: 112 });

/** The row of charge pips. */
const pipsStyle = defineStyle({ direction: "row", align: "center", gap: 8 });

/** One pip: a small disc with an ink rim. */
const pip = { width: 30, height: 30, radius: 15, stroke: theme.color.ink, strokeWidth: 3 } as const;

/** A charge the sawmill still has: honey. */
const fullPip = defineStyle({ ...pip, fill: theme.color.honey });

/** A charge it spent: walnut. */
const emptyPip = defineStyle({ ...pip, fill: theme.color.walnut });

/**
 * Reads the sawmill out of the save.
 *
 * @param player - The saved player.
 * @returns Its charges and its maximum.
 */
export function sawmillOf(player: Player): SawmillView {
  const max = tables.generators[generatorId].maxCharges;

  return { charges: player.merge.generators[generatorId]?.charges ?? max, max };
}

/**
 * The info bar: what the sawmill is called and how many taps it has left.
 *
 * @param props - What the bar shows.
 * @param props.sawmill - The charges of the sawmill.
 * @returns The row element of the bar.
 */
export function InfoBar(props: { sawmill: SawmillView }) {
  const { charges, max } = props.sawmill;

  return (
    <row key="infoBar" style={barStyle}>
      <image key="infoIcon" texture="board.generator" style={iconStyle} />
      <text key="infoName" style="ui.button" content={tr("board.sawmill")} />
      <row key="infoPips" style={pipsStyle}>
        {Array.from({ length: max }, (_unused, index) => (
          <stack key={`infoPip${index}`} style={index < charges ? fullPip : emptyPip} />
        ))}
      </row>
      <text key="infoCharges" style="ui.number" content={`${charges}/${max}`} />
    </row>
  );
}
