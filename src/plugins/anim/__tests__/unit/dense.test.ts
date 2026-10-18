import { describe, expect, it } from "vitest";
import { dropEnded } from "../../dense";

describe("anim dense lists", () => {
  it("drops the ended items in place and keeps the start order of the rest", () => {
    const first = { id: 1, ended: false };
    const second = { id: 2, ended: true };
    const third = { id: 3, ended: false };
    const fourth = { id: 4, ended: true };
    const list = [first, second, third, fourth];

    dropEnded(list);

    expect(list).toEqual([first, third]);
  });

  it("leaves a list with nothing ended as it was", () => {
    const list = [
      { id: 1, ended: false },
      { id: 2, ended: false }
    ];
    const before = [...list];

    dropEnded(list);

    expect(list).toEqual(before);
  });
});
