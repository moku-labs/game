import { describe, expect, it } from "vitest";
import { isSceneDefinition, namedBundles } from "../../bundles";
import type { NamedMemo, SceneDefinition, SceneState } from "../../types";

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

/**
 * A scene that counts how often it was asked.
 *
 * @returns The scene and the count.
 */
function counted(): { scene: SceneDefinition; asked: { count: number } } {
  const asked = { count: 0 };
  const scene = sceneOf(state => {
    asked.count += 1;

    return [episodeOf(state)];
  });

  return { scene, asked };
}

describe("namedBundles with a memo (F194)", () => {
  // Bug: every rest asks every scene of the look-ahead again, with the same committed state (F194: the ward's
  // `bundles` built hundreds of MB of rows a minute while windows opened and closed).
  it("asks a scene once while the committed trees stay the same", () => {
    const { scene, asked } = counted();
    const memo = new WeakMap<SceneDefinition, NamedMemo>();
    const first = namedBundles(scene, { ...ep01 }, memo);

    expect(namedBundles(scene, { ...ep01 }, memo)).toBe(first);
    expect(first).toEqual(["location", "ep01"]);
    expect(asked.count).toBe(1);
  });

  // Bug: the memo answers the old list after a commit replaced the session.
  it("asks again once a commit replaced the session or the player", () => {
    const { scene, asked } = counted();
    const memo = new WeakMap<SceneDefinition, NamedMemo>();
    const player = {};

    namedBundles(scene, { player, session: { episode: "ep01" } }, memo);

    expect(namedBundles(scene, { player, session: { episode: "ep02" } }, memo)).toEqual([
      "location",
      "ep02"
    ]);
    namedBundles(scene, { player: {}, session: { episode: "ep02" } }, memo);
    expect(asked.count).toBe(3);
  });

  // Bug: a hot swap's new declaration of the same scene id reads the old declaration's answer.
  it("keeps the answer of each declaration apart", () => {
    const memo = new WeakMap<SceneDefinition, NamedMemo>();
    const old = sceneOf(() => ["ep01"]);
    const swapped = sceneOf(() => ["ep02"]);

    namedBundles(old, ep01, memo);

    expect(namedBundles(swapped, ep01, memo)).toEqual(["location", "ep02"]);
  });

  // Bug: a cached list is handed out writable, and one caller's edit changes what the next one reads.
  it("hands out a frozen list", () => {
    const { scene } = counted();

    expect(Object.isFrozen(namedBundles(scene, ep01, new WeakMap()))).toBe(true);
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
