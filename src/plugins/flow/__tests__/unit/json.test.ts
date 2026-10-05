import { describe, expect, it } from "vitest";
import type { Json } from "../../../model/types";
import { readBookmark } from "../../json";

// ---------------------------------------------------------------------------
// Unit test: the bookmark reader keeps the scene the door wrote
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
});
