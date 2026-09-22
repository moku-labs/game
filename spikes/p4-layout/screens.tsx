// Spike P4. Two screens, pure functions of state, local view state and viewport.

import type { LocalReader } from "./core";
import { tokens, type Style } from "./styles";
import type { DescriptionNode } from "./ui/node";

export type Reward = { orderId: string; items: string[]; coins: number };
export type Row = { id: string; label: string; value: string };
export const TABS = ["audio", "video", "account"] as const;
export type Tab = (typeof TABS)[number];

const { space, color, radius, font } = tokens;

const panel: Style = {
  direction: "column",
  align: "center",
  gap: space[3],
  padding: space[6],
  width: 800,
  fill: color.panel,
  radius: radius.l,
  when: { landscape: { width: 1000, padding: space[4] } }
};

const primaryButton: Style = {
  width: 320,
  height: 96,
  justify: "center",
  align: "center",
  fill: color.accent,
  radius: radius.m,
  is: { pressed: { fill: color.accentDark }, disabled: { alpha: 0.5 } }
};

/** The reward popup: an overlay over the whole screen, one intent button. */
export function RewardPopup({ reward, phase }: { reward: Reward; phase: "open" | "claimed" }): DescriptionNode {
  return (
    <box key="popup" style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", justify: "center", align: "center", fill: 0x000000, alpha: 0.5 }}>
      <box key="panel" nineSlice="panel" style={panel}>
        <text key="title" style={{ height: 56, fontSize: font.l }} content="Order complete!" />
        <box key="rewards" style={{ direction: "row", gap: space[3] }}>
          {reward.items.map(item => (
            <image key={item} style={{ width: 160, height: 160, aspect: 1, fill: color.rowAlt, radius: radius.m }} texture={item} />
          ))}
        </box>
        <text key="coins" style={{ height: 40, fontSize: font.m }} content={`+${reward.coins} coins`} />
        <button key="claim" intent="claim" payload={{ orderId: reward.orderId }} state={{ disabled: phase === "claimed" }} style={primaryButton}>
          <text key="label" style={{ height: 40, fontSize: font.m }} content="Claim" />
        </button>
      </box>
    </box>
  );
}

const tabButton: Style = {
  grow: 1,
  height: 80,
  justify: "center",
  align: "center",
  fill: color.row,
  radius: radius.s,
  is: { active: { fill: color.accent } }
};

const smallButton: Style = { width: 96, height: 96, justify: "center", align: "center", fill: color.row, radius: radius.s, is: { pressed: { fill: color.accentDark } } };

const rowStyle: Style = { direction: "row", height: 72, gap: space[2], align: "center", padding: [0, space[2]], fill: color.row, radius: radius.s };

/** The settings screen: tabs with local state, a button row, a live counter, a measured row, a scroll list. */
export function Settings({ volume, rows, counter, counterFixed, local }: { volume: number; rows: Row[]; counter: number; counterFixed: boolean; local: LocalReader }): DescriptionNode {
  const tabs = local("tabs", { tab: "audio" as Tab });
  return (
    <box key="settings" style={{ width: "100%", height: "100%", direction: "column", padding: space[4], gap: space[3] }}>
      <box key="tabs" local={{ tab: "audio" }} style={{ direction: "row", gap: space[2], height: 80 }}>
        {TABS.map(id => (
          <button key={id} state={{ active: tabs.tab === id }} local={{ tab: id }} style={tabButton}>
            <text key="label" style={{ height: 32, fontSize: font.s }} content={id} />
          </button>
        ))}
      </box>
      <box key="buttons" style={{ direction: "row", gap: space[2], height: 96, align: "center", when: { landscape: { justify: "end" } } }}>
        <button key="minus" intent="volume" payload={{ delta: -10 }} style={smallButton}>
          <text key="label" style={{ height: 40, fontSize: font.m }} content="-" />
        </button>
        <text key="volume" style={{ width: 160, height: 40, fontSize: font.m }} content={`${volume}%`} />
        <button key="plus" intent="volume" payload={{ delta: 10 }} style={smallButton}>
          <text key="label" style={{ height: 40, fontSize: font.m }} content="+" />
        </button>
      </box>
      <box key="counter-row" style={{ direction: "row", gap: space[2], height: 48, align: "center" }}>
        <text key="counter-label" style={{ width: 200, height: 40, fontSize: font.m }} content="Frames" />
        <text key="counter" style={counterFixed ? { width: 240, height: 40, fontSize: font.m } : { height: 40, fontSize: font.m }} content={String(counter)} bitmap />
      </box>
      <box key="measure-wrap" style={{ direction: "column", align: "start", height: 48 }}>
        <box key="measure-row" style={{ direction: "row", gap: space[2], height: 40, align: "center" }}>
          <image key="icon" style={{ width: 40, height: 40, fill: color.muted }} texture="icon" />
          <text key="measured" style={{ height: 40, fontSize: font.m }} content={`Volume ${volume}`} />
        </box>
      </box>
      <list key="rows" style={{ grow: 1, direction: "column", gap: space[1], overflow: "hidden" }}>
        {rows.map(row => {
          const rowLocal = local(row.id, { selected: false });
          return (
            <box key={row.id} local={{ selected: false }} style={rowStyle}>
              <button key="select" local={{ selected: !rowLocal.selected }} state={{ selected: rowLocal.selected }} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", radius: radius.s, is: { selected: { fill: color.accentDark } } }} />
              <image key="icon" style={{ width: 56, height: 56, fill: color.muted, radius: radius.s }} texture="icon" />
              <text key="label" style={{ height: 32, fontSize: font.s }} content={row.label} />
              <box key="spacer" style={{ grow: 1 }} />
              <text key="value" style={{ width: 120, height: 32, fontSize: font.s }} content={row.value} />
            </box>
          );
        })}
      </list>
    </box>
  );
}

/** Builds `count` rows deterministically. */
export function makeRows(count: number, seed = 1): Row[] {
  const rows: Row[] = [];
  let state = seed;
  for (let index = 0; index < count; index++) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const length = 6 + (state % 12);
    rows.push({ id: `row-${index}`, label: `Setting ${index} ${"x".repeat(length)}`, value: `${state % 100}%` });
  }
  return rows;
}
