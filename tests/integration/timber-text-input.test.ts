/**
 * @file The text input of Timber Town, headless (V5): the Name tab of Settings shows the player's
 * name, and its plank opens the Rename popup stacked on the settings. The name field writes the
 * local of the popup, the counter follows it in the same frame, Enter and the Save plank answer
 * the gate with the name, and the node commits it to the save. Typing goes in through
 * `app.ui.fill` and the keys through `app.input.pressKey`, the doors an agent and the visual tests
 * use; nothing here needs a page.
 */

import { describe, expect, it } from "vitest";
import type { Player } from "./merge-game/state";
import type { Game } from "./timber-helpers";
import {
  elementOf,
  frames,
  nodeOf,
  player,
  playerOf,
  resolvedOf,
  shows,
  startOnHome,
  tap,
  tick
} from "./timber-helpers";

/**
 * Presses one key and lets the flow and the frames follow it.
 *
 * @param game - The running game.
 * @param key - The key, as `KeyboardEvent.key` names it.
 * @returns Whether a listener handled the key.
 */
async function press(game: Game, key: string): Promise<boolean> {
  const handled = game.app.input.pressKey(key);

  await tick();
  await frames(game, 30);

  return handled;
}

/**
 * Types into a field the way `app.ui.fill` does, and runs the two frames in which the popup
 * re-renders and its labels resolve.
 *
 * @param game - The running game.
 * @param key - The key of the field.
 * @param value - The text.
 * @returns Whether the field took the text.
 */
async function fill(game: Game, key: string, value: string): Promise<boolean> {
  const filled = game.app.ui.fill(key, value);

  await frames(game, 2);

  return filled;
}

/**
 * Opens the Name tab of the settings popup. A tab writes the local state of the popup and answers
 * nothing, so the tap is not taken by the gate.
 *
 * @param game - The running game, with the settings popup open.
 */
async function openNameTab(game: Game): Promise<void> {
  game.app.input.tap(elementOf(game, "tabProfile"));
  await tick();
  await frames(game);
}

/**
 * Opens Settings from Home, its Name tab, and the Rename popup from there.
 *
 * @param start - The player a new save starts from.
 * @returns The game, resting in the Rename popup.
 */
async function openRename(start: Player = player): Promise<Game> {
  const game = await startOnHome(start);

  await tap(game, "homeSettings");
  await openNameTab(game);
  await tap(game, "profileRename");

  return game;
}

/**
 * What the name field shows: its value, the text of its mirror while it is edited.
 *
 * @param game - The running game.
 * @returns The value of the field.
 */
function fieldValue(game: Game): string | undefined {
  return nodeOf(game.app.ui.tree(), "nameField")?.value;
}

describe("timber-text-input — the Name tab of Settings", () => {
  it("shows the player's name, or a line that says there is none yet", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");
    await openNameTab(game);

    expect(resolvedOf(game, "tabProfileLabel")).toBe("Имя");
    expect(resolvedOf(game, "profileName")).toBe("Без имени");
    expect(resolvedOf(game, "profileRenameLabel")).toBe("Сменить имя");
    // The tab is local state of the popup: the save hears nothing.
    expect(game.app.flow.state().path).toBe("settings/open");

    await game.app.stop();

    const named = await startOnHome({ ...player, name: "Mia" });

    await tap(named, "homeSettings");
    await openNameTab(named);

    expect(resolvedOf(named, "profileName")).toBe("Mia");

    await named.app.stop();
  });
});

describe("timber-text-input — the Rename popup", () => {
  it("opens over the settings with an empty field, its hint and a grey Save", async () => {
    const game = await openRename();

    expect(game.app.flow.state().path).toBe("settings/rename");
    expect(shows(game, "renameScreen")).toBe(true);
    // Settings stays beneath, covered.
    expect(nodeOf(game.app.ui.tree(), "settingsBoard")?.state.covered).toBe(true);
    expect(resolvedOf(game, "renameBoardTitle")).toBe("Твоё имя");
    expect(fieldValue(game)).toBe("");
    expect(resolvedOf(game, "nameCount")).toBe("0/16");
    expect(nodeOf(game.app.ui.tree(), "renameSave")?.state.disabled).toBe(true);

    await game.app.stop();
  });

  it("saves the name typed into the field with Enter: the counter reads 4/16, the player is Alex", async () => {
    const game = await openRename();

    expect(await fill(game, "nameField", "Alex")).toBe(true);
    expect(fieldValue(game)).toBe("Alex");
    expect(resolvedOf(game, "nameCount")).toBe("4/16");
    expect(nodeOf(game.app.ui.tree(), "renameSave")?.state.disabled).toBe(false);
    // Typing is local state: the graph still waits in the popup and the save is untouched.
    expect(game.app.flow.state().path).toBe("settings/rename");
    expect(playerOf(game).name).toBe("");

    expect(await press(game, "Enter")).toBe(true);

    expect(playerOf(game).name).toBe("Alex");
    expect(game.app.flow.state().path).toBe("settings/open");
    expect(shows(game, "renameScreen")).toBe(false);
    expect(resolvedOf(game, "profileName")).toBe("Alex");

    await game.app.stop();
  });

  it("cuts a name at 16 characters", async () => {
    const game = await openRename();

    expect(await fill(game, "nameField", "Alexander the Great")).toBe(true);
    expect(fieldValue(game)).toBe("Alexander the Gr");
    expect(resolvedOf(game, "nameCount")).toBe("16/16");

    await press(game, "Enter");

    expect(playerOf(game).name).toBe("Alexander the Gr");

    await game.app.stop();
  });

  // Found by exploratory QA: 15 letters and an emoji are 17 UTF-16 units; the field keeps the
  // emoji out whole, as the browser's own `maxlength` does, so the save is always well formed.
  it("never cuts an emoji in half at 16 characters", async () => {
    const game = await openRename();

    await fill(game, "nameField", "aaaaaaaaaaaaaaa😀");

    expect(fieldValue(game)).toBe("aaaaaaaaaaaaaaa");

    await press(game, "Enter");

    expect(playerOf(game).name.isWellFormed()).toBe(true);

    await game.app.stop();
  });

  it("keeps the typed name when Escape ends the editing, and Save saves it", async () => {
    const game = await openRename();

    await fill(game, "nameField", "Mia");

    expect(await press(game, "Escape")).toBe(true);
    // Escape ended the editing only: the popup is open and the field keeps the name.
    expect(game.app.flow.state().path).toBe("settings/rename");
    expect(fieldValue(game)).toBe("Mia");
    expect(resolvedOf(game, "nameCount")).toBe("3/16");

    await tap(game, "renameSave");

    expect(playerOf(game).name).toBe("Mia");
    expect(game.app.flow.state().path).toBe("settings/open");

    await game.app.stop();
  });

  it("keeps the old name when the popup is closed, and trims the spaces of a new one", async () => {
    const game = await openRename({ ...player, name: "Mia" });

    await fill(game, "nameField", "Bob");
    // The first Escape ends the editing, the second closes the popup like its backdrop.
    await press(game, "Escape");
    await press(game, "Escape");

    expect(game.app.flow.state().path).toBe("settings/open");
    expect(playerOf(game).name).toBe("Mia");

    await tap(game, "profileRename");
    await fill(game, "nameField", "  Bob ");
    await press(game, "Enter");

    expect(playerOf(game).name).toBe("Bob");

    await game.app.stop();
  });

  it("keeps the old name when Enter submits an empty field", async () => {
    const game = await openRename({ ...player, name: "Mia" });

    await fill(game, "nameField", "   ");
    await press(game, "Enter");

    expect(game.app.flow.state().path).toBe("settings/open");
    expect(playerOf(game).name).toBe("Mia");

    await game.app.stop();
  });
});
