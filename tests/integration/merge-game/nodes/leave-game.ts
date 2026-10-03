/**
 * @file Transit node `leaveGame`: Back was pressed on Home. The Leave popup asks first; Leave
 * awaits the `exit` effect, which the leave feature's plugin hands to the provider of the native
 * shell, and Stay, the backdrop and Escape answer `stay`. Both go back to Home: on the web page
 * there is no provider, so nothing closes and Home is where the player is.
 */
import type { Flow } from "@moku-labs/game";
import { type } from "@moku-labs/game";
import { Leave } from "../features/leave/leave";
import { showPopup } from "../features/ui/popup";
import { defineNode, popup } from "../kit";

export const leaveGame = defineNode({
  outcomes: { leave: type(), stay: type() },
  run: async ({ fx, out }) => {
    const answered = (await showPopup(fx, popup(Leave, {}))) as Flow.Answer | undefined;

    if (answered?.intent !== "leave") return out.stay();

    await fx({ kind: "exit" });

    return out.leave();
  }
});
