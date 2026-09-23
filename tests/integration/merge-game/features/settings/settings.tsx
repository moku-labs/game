/**
 * @file The settings popup (design §6 E2, D1): the header "Настройки", the X, two folder tabs, and
 * the pane under them — Music and Effects with −, a 10-segment level bar, + and the percent, or
 * the two language planks with a check on the current one — and the "Сбросить прогресс" link.
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
  languageColumn,
  linkStyle,
  rowIcon,
  rowName,
  rowPercent,
  segmentOff,
  segmentOn,
  stepStyle,
  tabRow,
  tabStyle,
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
 * One folder tab. It writes the tab into the local state of the popup; the paper tab is the one
 * on show.
 *
 * @param props - The tab and whether it is on show.
 * @param props.tab - The tab.
 * @param props.open - Whether its pane is the one on show.
 * @returns The button element, keyed `tab<Name>`.
 */
function TabButton(props: { tab: Tab; open: boolean }) {
  const key = props.tab === "audio" ? "tabSound" : "tabLanguage";

  return (
    <button key={key} local={{ tab: props.tab }} state={{ selected: props.open }} style={tabStyle}>
      <text
        key={`${key}Label`}
        style={props.open ? "ui.name" : "ui.button"}
        content={tr("settings.tab", { tab: props.tab })}
      />
    </button>
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
      <text key={`${props.id}Label`} style="ui.button" content={props.delta < 0 ? "-" : "+"} />
    </button>
  );
}

/**
 * One sound row (design §6 E2): the icon, the name, −, the level bar, + and the percent. − is
 * disabled at 0 %, + at 100 %.
 *
 * @param props - The bus and its volume.
 * @param props.bus - The bus.
 * @param props.icon - The icon of the bus.
 * @param props.volume - Its gain, 0..1.
 * @returns The row element, keyed `<bus>Row`.
 */
function VolumeRow(props: { bus: Bus; icon: AssetKey; volume: number }) {
  const { bus } = props;
  const lit = litOf(props.volume);

  return (
    <row key={`${bus}Row`} style={volumeRow}>
      <icon key={`${bus}Icon`} name={props.icon} style={rowIcon} />
      <column key={`${bus}Name`} style={rowName}>
        <text key={`${bus}Label`} style="ui.name" content={tr("settings.bus", { bus })} />
      </column>
      <StepButton id={`${bus}Down`} bus={bus} delta={-VOLUME_STEP} disabled={lit <= 0} />
      <row key={`${bus}Bar`} style={barTrack}>
        {segments.map(index => (
          <stack key={`${bus}Segment${index}`} style={index < lit ? segmentOn : segmentOff} />
        ))}
      </row>
      <StepButton id={`${bus}Up`} bus={bus} delta={VOLUME_STEP} disabled={lit >= SEGMENTS} />
      <column key={`${bus}PercentBox`} style={rowPercent}>
        <text
          key={`${bus}Percent`}
          style="ui.name"
          content={tr("settings.percent", { percent: lit * (100 / SEGMENTS) })}
        />
      </column>
    </row>
  );
}

/**
 * The language pane: one plank per language, the current one green with a check.
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
          size="large"
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
        width={1080}
        height={1040}
        hung
        close="close"
      >
        <row key="settingsTabs" style={tabRow}>
          {tabs.map(tab => (
            <TabButton tab={tab} open={local.tab === tab} />
          ))}
        </row>
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
        </Parchment>
        <button key="settingsReset" intent="reset" style={linkStyle}>
          <text key="settingsResetLabel" style="ui.link" content={tr("settings.reset")} />
        </button>
      </Signboard>
    </PopupScreen>
  )
});
