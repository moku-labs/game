import { describe, expect, it } from "vitest";
import { changedPaths, isAssetStamps, stampsOf } from "../../stamp";
import { createAssetsState } from "../../state";
import type { AssetStamps } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: the stamp of the keys watch. Telling it from any other module,
// reading it out of a `ui:hot-swap`, and which files one stamp changed.
// ---------------------------------------------------------------------------

/** The path the hot footer reports for the stamp module. */
const STAMP = "/game/.moku/assets-stamp.ts";

const CELL = "features/board/assets/cell.png";
const ICON = "features/ui/assets/icon.png";

/** The stamp after a save of the cell. */
const stamps: AssetStamps = { files: { [CELL]: "200:2", [ICON]: "100:1" }, changed: [CELL] };

describe("isAssetStamps", () => {
  it("takes the stamp the keys watch writes", () => {
    expect(isAssetStamps({ files: {}, changed: [] })).toBe(true);
    expect(isAssetStamps(stamps)).toBe(true);
  });

  it.each([
    ["nothing", undefined],
    // eslint-disable-next-line unicorn/no-null -- a module may export null; it is no stamp.
    ["null", null],
    ["the sha1 the stamp was before", "3f2a9c"],
    ["an object without changed", { files: {} }],
    ["an object without files", { changed: [] }],
    ["files that is a list", { files: [], changed: [] }],
    // eslint-disable-next-line unicorn/no-null -- JSON may carry null; it is no file map.
    ["files that is null", { files: null, changed: [] }],
    ["a stamp that is not a string", { files: { [CELL]: 200 }, changed: [] }],
    ["changed that is a map", { files: {}, changed: {} }],
    ["a changed path that is not a string", { files: {}, changed: [7] }]
  ])("refuses %s", (_name, value) => {
    expect(isAssetStamps(value)).toBe(false);
  });
});

describe("stampsOf", () => {
  it("reads the stamp out of the hot swap of the stamp module", () => {
    expect(stampsOf({ file: STAMP, module: { default: stamps } })).toBe(stamps);
  });

  it("knows the stamp module by a Windows path too", () => {
    const file = String.raw`C:\game\.moku\assets-stamp.ts`;

    expect(stampsOf({ file, module: { default: stamps } })).toBe(stamps);
  });

  it("answers nothing for another module, whatever it exports", () => {
    expect(stampsOf({ file: "/game/features/hud/view.tsx", module: {} })).toBeUndefined();
    expect(
      stampsOf({ file: "/game/generated/assets-stamp.ts", module: { default: stamps } })
    ).toBeUndefined();
  });

  it("answers nothing for a stamp module that carries no stamp", () => {
    expect(stampsOf({ file: STAMP, module: {} })).toBeUndefined();
    expect(stampsOf({ file: STAMP, module: { default: "3f2a9c" } })).toBeUndefined();
  });
});

describe("changedPaths", () => {
  it("takes the changed list of the first stamp and keeps its map", () => {
    const state = createAssetsState();

    expect(changedPaths(state, stamps)).toEqual([CELL]);
    expect(state.stamps).toBe(stamps.files);
  });

  it("compares a later stamp with the map it kept, not with its changed list", () => {
    const state = createAssetsState();
    const badge = "features/ui/assets/badge.png";
    const later: AssetStamps = {
      files: { [CELL]: "200:2", [ICON]: "300:3", [badge]: "50:5" },
      changed: [CELL]
    };

    changedPaths(state, stamps);

    // The icon moved and the badge is new; the cell stands as it was applied.
    expect(changedPaths(state, later)).toEqual([ICON, badge]);
    expect(state.stamps).toBe(later.files);
  });
});
