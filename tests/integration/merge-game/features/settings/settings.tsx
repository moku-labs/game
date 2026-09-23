/**
 * @file The settings popup (design §6 E2, D1): the plaque "Настройки", the X, two folder tabs that
 * stand on the parchment, and the pane under them — Music and Effects on two lines each (the name
 * and the percent, then −, a 10-segment level bar and +), or the two language planks with a check
 * on the current one — and the "Сбросить прогресс" link with its wave.
 *
 * Which tab is open is local state of the component: the save never hears about it and no node
 * runs when the player looks around. The buttons that change something name the four outcomes;
 * the backdrop and the X answer `close`.
 */
import { type } from "@moku-labs/game";
import type { AssetKey } from "../../generated/assets";
import { defineComponent, tr } from "../../kit";
import { Parchment, PlankButton, Signboard } from "../ui/kit";
import { PopupScreen } from "../ui/popup";
import {
  barTrack,
  glyphAcross,
  glyphDown,
  glyphJoin,
  languageColumn,
  linkStyle,
  linkWave,
  rowIcon,
  rowName,
  rowPercent,
  segmentOff,
  segmentOn,
  settingsTop,
  stepGlyph,
  stepStyle,
  tabIdle,
  tabOpen,
  tabRow,
  volumeControls,
  volumeLine,
  volumeRow
} from "./styles";

/** The two tabs of the popup. */
export type Tab = "audio" | "language";

/** The two buses the player sets. */
export type Bus = "music" | "sfx";

/** The intent that changes a bus, and what it carries. */
export type VolumeInput = { bus: string; delta: number };

/** The intent that switches the language. */
export type LocaleInput = { locale: string };

/** How many segments the level bar has: one per step. */
export const SEGMENTS = 10;

/** How much one press of − or + moves a bus: one segment. */
export const VOLUME_STEP = 1 / SEGMENTS;

/** The tabs in the order they are drawn. */
const tabs: readonly Tab[] = ["audio", "language"];

/** The two buses in the order they are drawn, with their icons. */
const buses: readonly { bus: Bus; icon: AssetKey }[] = [
  { bus: "music", icon: "ui.icon-music" },
  { bus: "sfx", icon: "ui.icon-sound" }
];

/** The languages the player may choose, in the order they are drawn. */
const languages = [
  { locale: "ru", label: tr("settings.russian") },
  { locale: "en", label: tr("settings.english") }
] as const;

/** Every segment index, built once. */
const segments = Array.from({ length: SEGMENTS }, (_unused, index) => index);

/** What the popup is shown with: the two volumes and the current language. */
export type SettingsProps = { music: number; sfx: number; locale: string };

/**
 * How many segments of the bar a volume lights.
 *
 * @param volume - The gain, 0..1.
 * @returns The lit segments, 0..10.
 * @example
 * ```ts
 * litOf(0.6); // 6
 * ```
 */
function litOf(volume: number): number {
  return Math.round(volume * SEGMENTS);
}

/**
 * One folder tab. It writes the tab into the local state of the popup; the open one is the paper
 * tab that reaches down over the border of the parchment.
 *
 * @param props - The tab and whether it is on show.
 * @param props.tab - The tab.
 * @param props.open - Whether its pane is the one on show.
 * @returns The button element, keyed `tab<Name>`.
 */
function TabButton(props: { tab: Tab; open: boolean }) {
  const key = props.tab === "audio" ? "tabSound" : "tabLanguage";

  return (
    <button
      key={key}
      local={{ tab: props.tab }}
      state={{ selected: props.open }}
      style={props.open ? tabOpen : tabIdle}
    >
      <text
        key={`${key}Label`}
        style={props.open ? "ui.tab" : "ui.button"}
        content={tr("settings.tab", { tab: props.tab })}
      />
    </button>
  );
}

/**
 * The bold cream − or + of a step button, drawn as bars with an ink outline (design §6 E2). The
 * plus lays the cream of its horizontal bar over the crossing once more, so it has one outline.
 *
 * @param props - The glyph.
 * @param props.id - The key of the button; the glyph is keyed `<id>Glyph`.
 * @param props.plus - Whether it is the plus.
 * @returns The stack element.
 */
function StepGlyph(props: { id: string; plus: boolean }) {
  const key = `${props.id}Glyph`;

  return (
    <stack key={key} style={stepGlyph}>
      <stack key={`${key}Across`} style={glyphAcross} />
      {props.plus ? <stack key={`${key}Down`} style={glyphDown} /> : undefined}
      {props.plus ? <stack key={`${key}Join`} style={glyphJoin} /> : undefined}
    </stack>
  );
}

/**
 * One step button of a sound row: − or +. It is disabled at the end of the range it moves to.
 *
 * @param props - The step.
 * @param props.id - The key of the button.
 * @param props.bus - The bus it moves.
 * @param props.delta - How far it moves the bus.
 * @param props.disabled - Whether the bus is already at that end.
 * @returns The button element.
 */
function StepButton(props: { id: string; bus: Bus; delta: number; disabled: boolean }) {
  return (
    <button
      key={props.id}
      intent="volume"
      payload={{ bus: props.bus, delta: props.delta }}
      state={{ disabled: props.disabled }}
      style={stepStyle}
    >
      <StepGlyph id={props.id} plus={props.delta > 0} />
    </button>
  );
}

/**
 * One sound row (design §6 E2) on two lines: the icon and the name with the percent at the right
 * end, then −, the level bar that fills the rest, and +. − is disabled at 0 %, + at 100 %.
 *
 * @param props - The bus and its volume.
 * @param props.bus - The bus.
 * @param props.icon - The icon of the bus.
 * @param props.volume - Its gain, 0..1.
 * @returns The column element, keyed `<bus>Row`.
 */
function VolumeRow(props: { bus: Bus; icon: AssetKey; volume: number }) {
  const { bus } = props;
  const lit = litOf(props.volume);

  return (
    <column key={`${bus}Row`} style={volumeRow}>
      <row key={`${bus}Line`} style={volumeLine}>
        <row key={`${bus}Name`} style={rowName}>
          <icon key={`${bus}Icon`} name={props.icon} style={rowIcon} />
          <text key={`${bus}Label`} style="ui.body" content={tr("settings.bus", { bus })} />
        </row>
        <column key={`${bus}PercentBox`} style={rowPercent}>
          <text
            key={`${bus}Percent`}
            style="ui.tab"
            content={tr("settings.percent", { percent: lit * (100 / SEGMENTS) })}
          />
        </column>
      </row>
      <row key={`${bus}Controls`} style={volumeControls}>
        <StepButton id={`${bus}Down`} bus={bus} delta={-VOLUME_STEP} disabled={lit <= 0} />
        <row key={`${bus}Bar`} style={barTrack}>
          {segments.map(index => (
            <stack key={`${bus}Segment${index}`} style={index < lit ? segmentOn : segmentOff} />
          ))}
        </row>
        <StepButton id={`${bus}Up`} bus={bus} delta={VOLUME_STEP} disabled={lit >= SEGMENTS} />
      </row>
    </column>
  );
}

/**
 * The language pane: one plank per language across the paper, the current one green with a check.
 *
 * @param props - The current language.
 * @param props.locale - The locale the save holds.
 * @returns The column element.
 */
function LanguagePane(props: { locale: string }) {
  return (
    <column key="languagePane" style={languageColumn}>
      {languages.map(language => (
        <PlankButton
          id={`language${language.locale === "ru" ? "Russian" : "English"}`}
          intent="setLocale"
          payload={{ locale: language.locale }}
          look="wood"
          size="full"
          selected={props.locale === language.locale}
          label={language.label}
        />
      ))}
    </column>
  );
}

export const Settings = defineComponent("Settings", {
  local: { tab: "audio" as Tab },
  outcomes: {
    volume: type<VolumeInput>(),
    setLocale: type<LocaleInput>(),
    reset: type(),
    close: type()
  },
  view: (props: SettingsProps, local) => (
    <PopupScreen id="settings" dismiss="close">
      <Signboard
        id="settingsBoard"
        title={tr("settings.title")}
        width={950}
        height={1060}
        top={settingsTop}
        hung
        close="close"
      >
        <Parchment id="settingsPane">
          {local.tab === "audio" ? (
            buses.map(entry => (
              <VolumeRow
                bus={entry.bus}
                icon={entry.icon}
                volume={entry.bus === "music" ? props.music : props.sfx}
              />
            ))
          ) : (
            <LanguagePane locale={props.locale} />
          )}
          <row key="settingsTabs" style={tabRow}>
            {tabs.map(tab => (
              <TabButton tab={tab} open={local.tab === tab} />
            ))}
          </row>
        </Parchment>
        <button key="settingsReset" intent="reset" style={linkStyle}>
          <text key="settingsResetLabel" style="ui.link" content={tr("settings.reset")} />
          <image key="settingsResetWave" texture="ui.link-wave" fit="fill" style={linkWave} />
        </button>
      </Signboard>
    </PopupScreen>
  )
});
