/**
 * @file The five nodes of the settings sub-flow. `enter` plays the swing sound of the popup once,
 * as the flow comes in. `open` shows the popup and rests there, so a volume step or a language
 * switch goes out through a transit node that commits and comes back to the same popup: the
 * engine keeps its root while the flow is in transit, and nothing swings in again, so nothing
 * sounds. `confirmReset` asks before the save starts over, with the confirm stacked on the
 * settings.
 *
 * A node has no audio and no i18n in its context: the volume is committed and `audio` reads it
 * back on the commit, and the language goes out as an effect the feature's own plugin handles.
 */
import type { Flow } from "@moku-labs/game";
import { schedule, type } from "@moku-labs/game";
import { defineNode, popup } from "../../kit";
import { rules } from "../../rules";
import { startProgressOver } from "../../state";
import { tables } from "../../tables";
import { popupSound, showPopup } from "../ui/popup";
import { Confirm } from "./confirm";
import type { LocaleInput, VolumeInput } from "./settings";
import { Settings } from "./settings";

/** The quietest and the loudest a bus can be set to from the popup. */
const range = { min: 0, max: 1 };

/**
 * Keeps a volume inside its range and on two decimals, so a save never holds the rounding error
 * of a step: 0.6 minus 0.1 is 0.5 in the file the player carries around.
 *
 * @param value - The volume after the step was added.
 * @returns The volume the save takes.
 * @example
 * ```ts
 * clamp(0.6 - 0.1); // 0.5
 * clamp(1.1); // 1
 * ```
 */
function clamp(value: number): number {
  const inside = Math.min(range.max, Math.max(range.min, value));

  return Math.round(inside * 100) / 100;
}

/**
 * Reads the volume change out of the answer of the popup.
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
 * Reads the locale out of the answer of the popup.
 *
 * @param payload - What the button carried.
 * @returns The locale, `en` when the answer carried none.
 */
function localeOf(payload: unknown): LocaleInput {
  const answer = payload as Partial<LocaleInput> | undefined;

  return { locale: typeof answer?.locale === "string" ? answer.locale : "en" };
}

/**
 * Transit node `enter`: the settings come in, so their board swings in with its sound. The popup
 * of `open` is taken back after every step, so `open` itself plays nothing.
 */
export const enter = defineNode({
  outcomes: { done: type() },
  run: ({ fx, out }) => {
    void fx(popupSound);

    return out.done();
  }
});

/**
 * Rest node `open`: shows the settings popup and waits. A tab press is local state of the
 * component and never reaches this node; the backdrop and the X answer `close`.
 */
export const open = defineNode({
  rest: true,
  outcomes: {
    volume: type<VolumeInput>(),
    setLocale: type<LocaleInput>(),
    reset: type(),
    close: type()
  },
  run: async ({ player, fx, out }) => {
    const { audio, locale } = player.settings;
    const answered = (await fx(popup(Settings, { music: audio.music, sfx: audio.sfx, locale }))) as
      | Flow.Answer
      | undefined;

    if (answered?.intent === "volume") return out.volume(volumeOf(answered.payload));
    if (answered?.intent === "setLocale") return out.setLocale(localeOf(answered.payload));
    if (answered?.intent === "reset") return out.reset();

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

/**
 * Transit node `confirmReset`: the confirm stacked on the settings. Cancel goes back to the same
 * settings popup; Reset writes a fresh save — board, coins, orders and the gift start over, the
 * volumes and the language stay — and arms the clock for it.
 */
export const confirmReset = defineNode({
  outcomes: { reset: type(), cancel: type() },
  run: async ({ player, fx, out }) => {
    const answered = (await showPopup(fx, popup(Confirm, {}, { over: "Settings" }))) as
      | Flow.Answer
      | undefined;

    if (answered?.intent !== "reset") return out.cancel();

    startProgressOver(player);
    await fx(schedule(rules.nextDue(player.merge, tables)));

    return out.reset();
  }
});
