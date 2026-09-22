/**
 * @file The settings screen: one component with local state. Which tab is open is local — the
 * save never hears about it, and no node runs when the player looks around. Only the three
 * buttons that change something name an intent, and those are the outcomes of the component.
 */
import { type } from "@moku-labs/game";
import { defineComponent, tr } from "../../kit";
import { buttonRow, settingsPanel, smallButton, tabButton } from "./styles";

/** The two tabs of the screen. */
export type Tab = "audio" | "language";

/** How much one press of louder or quieter moves a bus. */
export const VOLUME_STEP = 0.2;

/** The tabs in the order they are drawn. */
const tabs: readonly Tab[] = ["audio", "language"];

/** What the screen is shown with: the volume of the two buses the player can change. */
export type SettingsProps = { music: number; sfx: number };

/**
 * The volume of one bus as a whole percentage, which is what the label shows.
 *
 * @param volume - The gain, 0..1.
 * @returns The percentage.
 * @example
 * ```ts
 * percentOf(0.6); // 60
 * ```
 */
function percentOf(volume: number): number {
  return Math.round(volume * 100);
}

export const Settings = defineComponent("Settings", {
  local: { tab: "audio" as Tab },
  outcomes: {
    volume: type<{ bus: string; delta: number }>(),
    setLocale: type<{ locale: string }>(),
    close: type()
  },
  view: (props: SettingsProps, local) => (
    <panel key="settings" style={settingsPanel}>
      <text key="title" style="hud.title" content={tr("settings.title")} />
      <row key="tabs" style={buttonRow}>
        {tabs.map(tab => (
          <button key={tab} local={{ tab }} state={{ active: local.tab === tab }} style={tabButton}>
            <text key={`${tab}Label`} style="hud.label" content={tr("settings.tab", { tab })} />
          </button>
        ))}
      </row>
      {local.tab === "audio" ? (
        <row key="audioPane" style={buttonRow}>
          <button
            key="quieter"
            intent="volume"
            payload={{ bus: "music", delta: -VOLUME_STEP }}
            style={smallButton}
          >
            <text key="quieterLabel" style="hud.label" content={tr("settings.quieter")} />
          </button>
          <text
            key="level"
            style="hud.label"
            content={tr("settings.volume", { bus: "music", percent: percentOf(props.music) })}
          />
          <button
            key="louder"
            intent="volume"
            payload={{ bus: "music", delta: VOLUME_STEP }}
            style={smallButton}
          >
            <text key="louderLabel" style="hud.label" content={tr("settings.louder")} />
          </button>
        </row>
      ) : (
        <row key="languagePane" style={buttonRow}>
          <button key="english" intent="setLocale" payload={{ locale: "en" }} style={smallButton}>
            <text key="englishLabel" style="hud.label" content={tr("settings.english")} />
          </button>
          <text
            key="effects"
            style="hud.label"
            content={tr("settings.volume", { bus: "sfx", percent: percentOf(props.sfx) })}
          />
        </row>
      )}
      <button key="close" intent="close" style={smallButton}>
        <text key="closeLabel" style="hud.label" content={tr("settings.close")} />
      </button>
    </panel>
  )
});
