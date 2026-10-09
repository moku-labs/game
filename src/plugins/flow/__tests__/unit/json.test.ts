import { describe, expect, it } from "vitest";
import type { Json } from "../../../model/types";
import { readBookmark } from "../../json";

// ---------------------------------------------------------------------------
// Unit test: the bookmark reader keeps the scene the door wrote and the rest point
// ---------------------------------------------------------------------------

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

const saved = {
  path: "settings/open",
  input: noPayload,
  player: { coins: 7 },
  session: { taps: 0 },
  rng: { seed: 42, streams: { chest: 3 } },
  graph: "0badf00d"
};

describe("readBookmark", () => {
  it("keeps the scene when it is a string", () => {
    expect(readBookmark({ ...saved, scene: "home" })).toEqual({ ...saved, scene: "home" });
  });

  it("leaves the scene key out when the bookmark has none", () => {
    const read = readBookmark(saved);

    expect(read).toEqual(saved);
    expect("scene" in read).toBe(false);
  });

  it.each([
    ["a number", 3],
    ["null", noPayload],
    ["an object", { id: "home" }]
  ])("refuses a scene that is %s", (_name, scene: Json) => {
    expect(() => readBookmark({ ...saved, scene })).toThrow(
      /^\[game] The bookmark is not a flow\.bookmark\(\) value\.\n {2}.*\.$/
    );
  });

  it("keeps the rest point of a bookmark taken at a transit node", () => {
    const taken = { ...saved, path: "info/show", rest: { path: "home", input: noPayload } };

    expect(readBookmark(taken)).toEqual(taken);
  });

  it("keeps the scene and the rest point together, and nothing else of the rest", () => {
    const rest = { path: "board/awaitIntent", input: { level: 3 }, extra: true };

    expect(readBookmark({ ...saved, scene: "home", rest })).toEqual({
      ...saved,
      scene: "home",
      rest: { path: "board/awaitIntent", input: { level: 3 } }
    });
  });

  it("leaves the rest key out when the bookmark has none", () => {
    expect("rest" in readBookmark({ ...saved, scene: "home" })).toBe(false);
  });

  it.each([
    ["a string", "home"],
    ["null", noPayload],
    ["a list", ["home", noPayload]],
    ["without a path", { input: noPayload }],
    ["with a path that is not a string", { path: 7, input: noPayload }],
    ["without an input", { path: "home" }]
  ])("refuses a rest that is %s", (_name, rest: Json) => {
    expect(() => readBookmark({ ...saved, rest })).toThrow(
      /^\[game] The bookmark is not a flow\.bookmark\(\) value\.\n {2}.*\.$/
    );
  });
});
