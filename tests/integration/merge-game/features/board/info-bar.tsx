/**
 * @file The sawmill info bar (design §6 B4, §7, p2): a light wooden plank right under the tray
 * that names the selected thing in ink. For the sawmill, and while nothing is selected: its icon, its
 * name, one pip per charge and the count, "3/4". The charges come from the save and the maximum
 * from the generator table, so the bar says what a tap would find. For a selected item: its
 * picture, its name and its level, "Доска · Уровень 3".
 */
import { defineStyle, tr } from "../../kit";
import type { Player, Session } from "../../state";
import { generatorId, tables } from "../../tables";
import { nameOf, pictureOf } from "../../view/items";
import { selectedOf } from "../../view/selection";
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

/**
 * What the bar shows: the sawmill with its charges, or the selected item.
 *
 * @example
 * ```ts
 * const sawmill: InfoView = { kind: "sawmill", charges: 3, max: 4 };
 * const plank: InfoView = { kind: "item", chain: "wood", level: 3 };
 * ```
 */
export type InfoView =
  | ({ kind: "sawmill" } & SawmillView)
  | { kind: "item"; chain: string; level: number };

/**
 * The bar: a light plank 830 wide and 160 tall, 66 units under the tray. The order cards hang
 * over the tray, which rises 42 units under the strip; the bar keeps its place in p2.
 */
const barStyle = defineStyle({
  direction: "row",
  align: "center",
  justify: "center",
  gap: 24,
  width: 830,
  height: 160,
  margin: { top: 66 },
  padding: { left: 40, right: 48, bottom: 8 },
  nineSlice: "ui.button-wood"
});

/** The sawmill picture at the left end of the bar. */
const iconStyle = defineStyle({ width: 120, height: 120 });

/** The row of charge pips. */
const pipsStyle = defineStyle({ direction: "row", align: "center", gap: 10 });

/** One pip: a small disc with an ink rim. */
const pip = { width: 24, height: 24, radius: 12, stroke: theme.color.ink, strokeWidth: 3 } as const;

/** A charge the sawmill still has: honey. */
const fullPip = defineStyle({ ...pip, fill: theme.color.honey });

/** A charge it spent: parchment, only the rim shows. */
const emptyPip = defineStyle({ ...pip, fill: theme.color.parchment });

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
 * Reads what the bar shows: the selected item, or the sawmill when the sawmill or nothing is
 * selected.
 *
 * @param player - The saved player.
 * @param session - The session, which keeps the selected id.
 * @returns The view of the bar.
 */
export function infoOf(player: Player, session: Session): InfoView {
  const selected = selectedOf(player, session);

  if (selected?.kind === "item") {
    return { kind: "item", chain: selected.chain, level: selected.level };
  }

  return { kind: "sawmill", ...sawmillOf(player) };
}

/**
 * The words and pips of the sawmill: its name, one pip per charge and the count.
 *
 * @param sawmill - The charges of the sawmill.
 * @returns The elements after the icon.
 */
function sawmillWords(sawmill: SawmillView) {
  const { charges, max } = sawmill;

  return [
    <text key="infoName" style="ui.tab" content={tr("board.sawmill")} />,
    <row key="infoPips" style={pipsStyle}>
      {Array.from({ length: max }, (_unused, index) => (
        <stack key={`infoPip${index}`} style={index < charges ? fullPip : emptyPip} />
      ))}
    </row>,
    <text key="infoCharges" style="ui.tab" content={`${charges}/${max}`} />
  ];
}

/**
 * The words of a selected item: its name and its level.
 *
 * @param level - The level of the item, from 1.
 * @returns The elements after the icon.
 */
function itemWords(level: number) {
  return [
    <text key="infoName" style="ui.tab" content={tr("board.item", { item: nameOf(level) })} />,
    <text key="infoLevel" style="ui.tab" content={tr("board.level", { level })} />
  ];
}

/**
 * The info bar: what the selected thing is called, and how many taps the sawmill has left or
 * which level the item is.
 *
 * @param props - What the bar shows.
 * @param props.info - The sawmill or the selected item.
 * @returns The row element of the bar.
 */
export function InfoBar(props: { info: InfoView }) {
  const info = props.info;
  const texture = info.kind === "item" ? pictureOf(info.chain, info.level) : "board.generator";

  return (
    <row key="infoBar" style={barStyle}>
      <image key="infoIcon" texture={texture} style={iconStyle} />
      {info.kind === "item" ? itemWords(info.level) : sawmillWords(info)}
    </row>
  );
}
