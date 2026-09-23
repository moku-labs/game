/**
 * @file The swing sound of a popup (design §6 F1, delta F2): `showPopup` plays `ui.popup` once and
 * then awaits the popup, the settings sub-flow plays it once as it comes in, the settings popup
 * shown again after a volume step does not play it again, and Out of energy, Reward and Daily gift
 * each play it once as they swing in.
 */
import type { Flow } from "@moku-labs/game";
import { describe, expect, it, vi } from "vitest";
import { dailyGift } from "../../../nodes/daily-gift";
import { energy } from "../../../nodes/energy";
import { show } from "../../../nodes/show";
import { startingPlayer } from "../../../state";
import { enter, open } from "../../settings/nodes";
import { popupSound, showPopup } from "../popup";

/**
 * A node's effects as a spy: every descriptor it was given, and an answer for the popup.
 *
 * @param answer - What an awaited popup answers.
 * @returns The fake `fx` and the list of what it was given.
 */
function fakeFx(answer?: Flow.Answer) {
  const given: Flow.Descriptor[] = [];
  const fx = Object.assign(
    vi.fn((descriptor: Flow.Descriptor) => {
      given.push(descriptor);

      return Promise.resolve(descriptor.kind === "popup" ? answer : undefined);
    }),
    { emit: vi.fn() }
  );

  return { fx, given };
}

/**
 * The body of a node, failing the test when the node has none.
 *
 * @param run - The `run` of a node definition.
 * @returns The body.
 */
function bodyOf<Run>(run: Run | undefined): Run {
  if (run === undefined) throw new Error("the node has no body");

  return run;
}

/** A popup descriptor as `popup(Settings, …)` builds it, reduced to what the spy reads. */
const settingsPopup: Flow.Descriptor = { kind: "popup", payload: { component: "Settings" } };

describe("popup sound", () => {
  it("is the `ui.popup` sound effect", () => {
    expect(popupSound).toMatchObject({ kind: "sfx", payload: { key: "ui.popup" } });
  });

  it("plays the swing sound once, then awaits the popup and hands back its answer", async () => {
    const { fx, given } = fakeFx({ intent: "claim" });

    await expect(showPopup(fx, settingsPopup)).resolves.toEqual({ intent: "claim" });
    expect(given).toEqual([popupSound, settingsPopup]);
  });

  it("sounds once as the settings come in, and never on the popup shown again", async () => {
    const entered = fakeFx();
    const enterBody = bodyOf(enter.run);
    const result = await enterBody({
      fx: entered.fx,
      out: { done: () => ({ outcome: "done" }) }
    } as unknown as Parameters<typeof enterBody>[0]);

    expect(result).toEqual({ outcome: "done" });
    expect(entered.given).toEqual([popupSound]);

    // `open` runs after every volume step: it shows the popup and plays nothing.
    const shown = fakeFx({ intent: "close" });

    const openBody = bodyOf(open.run);

    await openBody({
      fx: shown.fx,
      player: { settings: { audio: { master: 1, music: 0.6, sfx: 1 }, locale: "ru" } },
      out: { close: () => ({ outcome: "close" }) }
    } as unknown as Parameters<typeof openBody>[0]);

    expect(shown.given.map(descriptor => descriptor.kind)).toEqual(["popup"]);
  });

  it("sounds once as Out of energy, Reward and Daily gift swing in, before each popup", async () => {
    const out = {
      later: () => ({ outcome: "later" }),
      watch: () => ({ outcome: "watch" }),
      claim: () => ({ outcome: "claim" }),
      close: () => ({ outcome: "close" })
    };
    const cases = [
      { run: bodyOf(energy.run), component: "OutOfEnergy", outcome: "later" },
      { run: bodyOf(show.run), component: "RewardPopup", outcome: "claim" },
      { run: bodyOf(dailyGift.run), component: "DailyGift", outcome: "close" }
    ];

    for (const entry of cases) {
      const { fx, given } = fakeFx();
      const result = await entry.run({
        fx,
        out,
        now: 0,
        player: structuredClone(startingPlayer)
      } as never);
      const sounds = given.filter(descriptor => descriptor.kind === "sfx");
      const firstPopup = given.findIndex(descriptor => descriptor.kind === "popup");

      expect(result).toEqual({ outcome: entry.outcome });
      expect(sounds.filter(sound => sound === popupSound)).toHaveLength(1);
      expect(given[firstPopup - 1]).toBe(popupSound);
      expect(given[firstPopup]).toMatchObject({ payload: { component: entry.component } });
    }
  });
});
