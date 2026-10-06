/**
 * @file Transit node `show`: the info popup. It counts the opening into the session, plays the
 * swing of the popup and the spark burst from the button of Home, and waits for the popup's
 * answer: OK, or the backdrop. Every one of these is an effect, so without a screen they resolve
 * at once and a test answers the popup with a route step.
 */
import type { Flow } from "@moku-labs/game";
import { play, sfx, type } from "@moku-labs/game";
import { sparkBurst } from "../features/info/animations";
import { InfoPopup } from "../features/info/popup";
import { defineNode, popup } from "../kit";

export const show = defineNode({
  outcomes: { ok: type(), close: type() },
  run: async ({ player, session, fx, out }) => {
    session.opened += 1;
    void fx(sfx("ui.popup"));
    void fx(play(sparkBurst, { from: { projection: "home.screen", key: "info" } }));

    const answered = (await fx(popup(InfoPopup, { count: player.count }))) as
      | Flow.Answer
      | undefined;

    return answered?.intent === "ok" ? out.ok() : out.close();
  }
});
