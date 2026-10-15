import { describe, expect, it } from "vitest";
import { isSceneDefinition, namedBundles } from "../../bundles";
import type { SceneDefinition, SceneState } from "../../types";

/**
 * Builds a scene declaration the way `defineScene` returns it, with an optional `bundles`.
 *
 * @param bundles - What the scene names from the state, or nothing for a flat scene.
 * @returns The scene declaration.
 */
function sceneOf(bundles?: (state: SceneState) => readonly string[]): SceneDefinition {
  return {
    id: "ward",
    bundle: "location",
    music: undefined,
    layers: [],
    projections: [],
    ...(bundles === undefined ? {} : { bundles })
  };
}

const ep01: SceneState = { player: {}, session: { episode: "ep01" } };

/**
 * Reads the episode of a session the test wrote as `{ episode }`.
 *
 * @param state - The committed state.
 * @returns The episode name.
 */
function episodeOf(state: SceneState): string {
  const session = state.session;

  return typeof session === "object" && session !== null && "episode" in session
    ? String(session.episode)
    : "";
}

describe("namedBundles", () => {
  // Bug: the extra bundles are dropped, or the state never reaches `bundles`.
  it("names the scene bundle first, then what bundles returns for the state it is given", () => {
    const scene = sceneOf(state => [episodeOf(state), "ward.extras"]);

    expect(namedBundles(scene, ep01)).toEqual(["location", "ep01", "ward.extras"]);
    expect(namedBundles(scene, { player: {}, session: { episode: "ep02" } })).toEqual([
      "location",
      "ep02",
      "ward.extras"
    ]);
  });

  // Bug: a repeated name is loaded twice and pinned twice.
  it("names each bundle once, also when bundles repeats the scene bundle", () => {
    const scene = sceneOf(() => ["ep01", "location", "ep01"]);

    expect(namedBundles(scene, ep01)).toEqual(["location", "ep01"]);
  });

  // Bug: the flat-game path changes.
  it("names only the scene bundle for a scene without bundles", () => {
    expect(namedBundles(sceneOf(), ep01)).toEqual(["location"]);
  });

  // Bug: a game's typo reaches `assets.load` as a non-name.
  it("throws, naming the scene, when bundles returns a value that is not a list of names", () => {
    const message =
      '[game] Scene "ward": bundles() must return a list of bundle names.\n' +
      '  Return the bundle keys the scene needs, such as ["ep01"].';
    const notAList = sceneOf(() => "ep01" as unknown as readonly string[]);
    const notNames = sceneOf(() => ["ep01", 3] as unknown as readonly string[]);

    expect(() => namedBundles(notAList, ep01)).toThrow(message);
    expect(() => namedBundles(notNames, ep01)).toThrow(message);
  });
});

describe("isSceneDefinition", () => {
  // Bug: an entry whose bundles is a number crashes at the call; a valid scene with bundles is
  // skipped.
  it("refuses an entry whose bundles is not a function, and accepts one whose bundles is a function", () => {
    const entry = { id: "ward", bundle: "location", layers: [], projections: [] };

    expect(isSceneDefinition({ ...entry, bundles: 3 })).toBe(false);
    expect(isSceneDefinition({ ...entry, bundles: ["ep01"] })).toBe(false);
    expect(isSceneDefinition({ ...entry, bundles: () => ["ep01"] })).toBe(true);
    expect(isSceneDefinition({ ...entry, bundles: undefined })).toBe(true);
    expect(isSceneDefinition(entry)).toBe(true);
  });
});
