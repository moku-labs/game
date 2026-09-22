/**
 * @file The three nodes of the settings: the one that shows the screen and waits for an answer,
 * and the two that write what the player chose into the save. A node has no audio and no i18n in
 * its context — the volume is committed and `audio` reads it back on the commit, and the language
 * goes out as an effect the feature's own plugin handles.
 */
import type { Flow } from "@moku-labs/game";
import { type } from "@moku-labs/game";
import { defineNode, popup } from "../../kit";
import { Settings } from "./settings";

/** The quietest and the loudest a bus can be set to from the screen. */
const range = { min: 0, max: 1 };

/** The intent that changes a bus, and what it carries. */
export type VolumeInput = { bus: string; delta: number };

/** The intent that switches the language. */
export type LocaleInput = { locale: string };

/**
 * Keeps a volume inside its range and on two decimals, so a save never holds the rounding error
 * of a step: 0.6 minus 0.2 is 0.4 in the file the player carries around.
 *
 * @param value - The volume after the step was added.
 * @returns The volume the save takes.
 * @example
 * ```ts
 * clamp(0.6 - 0.2); // 0.4
 * clamp(1.2); // 1
 * ```
 */
function clamp(value: number): number {
  const inside = Math.min(range.max, Math.max(range.min, value));

  return Math.round(inside * 100) / 100;
}

/**
 * Reads the volume change out of the answer of the screen.
 *
 * @param payload - What the button carried.
 * @returns The bus and the step, `music` and nothing when the answer carried neither.
 */
function volumeOf(payload: unknown): VolumeInput {
  const answer = payload as Partial<VolumeInput> | undefined;

  return {
    bus: typeof answer?.bus === "string" ? answer.bus : "music",
    delta: typeof answer?.delta === "number" ? answer.delta : 0
  };
}

/**
 * Reads the locale out of the answer of the screen.
 *
 * @param payload - What the button carried.
 * @returns The locale, `en` when the answer carried none.
 */
function localeOf(payload: unknown): LocaleInput {
  const answer = payload as Partial<LocaleInput> | undefined;

  return { locale: typeof answer?.locale === "string" ? answer.locale : "en" };
}

/**
 * Transit node `openSettings`: shows the settings screen and waits. The gate is open for the
 * three outcomes of the component while the popup is up, so a tab press — which is local state —
 * never reaches this node.
 */
export const openSettings = defineNode({
  outcomes: {
    volume: type<VolumeInput>(),
    setLocale: type<LocaleInput>(),
    close: type()
  },
  run: async ({ player, fx, out }) => {
    const audio = player.settings.audio;
    const answered = (await fx(popup(Settings, { music: audio.music, sfx: audio.sfx }))) as
      | Flow.Answer
      | undefined;

    if (answered?.intent === "volume") return out.volume(volumeOf(answered.payload));
    if (answered?.intent === "setLocale") return out.setLocale(localeOf(answered.payload));

    return out.close();
  }
});

/**
 * Transit node `setVolume`: writes the new gain into the save. Nothing calls the audio plugin —
 * `pluginConfigs.audio.volumes` reads the committed player and applies it.
 */
export const setVolume = defineNode({
  input: type<VolumeInput>(),
  outcomes: { done: type() },
  run: ({ input, player, out }) => {
    const audio = player.settings.audio;

    if (input.bus === "sfx") audio.sfx = clamp(audio.sfx + input.delta);
    else audio.music = clamp(audio.music + input.delta);

    return out.done();
  }
});

/**
 * Transit node `setLocale`: writes the language into the save and asks the feature's plugin to
 * switch it. The effect is awaited, so the node ends after every label has been resolved again.
 */
export const setLocale = defineNode({
  input: type<LocaleInput>(),
  outcomes: { done: type() },
  run: async ({ input, player, fx, out }) => {
    player.settings.locale = input.locale;

    await fx({ kind: "locale", payload: { locale: input.locale } });

    return out.done();
  }
});
