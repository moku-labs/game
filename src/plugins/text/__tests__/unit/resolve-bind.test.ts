import { describe, expect, it } from "vitest";
import { component } from "../../../world/ecs/define";
import { bind, Text } from "../../components";
import type { TextValue } from "../../types";
import { createMockText, type MockText } from "./mock-text";

// ---------------------------------------------------------------------------
// The frame step keys a bind once, by the bind object it was seen with, and
// keeps one record per label, overwritten in place. These cases write the label
// the way `ui` does, with `ecs.set` after the layout phase, which marks nothing:
// only the comparison with what was seen can tell the label moved.
// ---------------------------------------------------------------------------

/** The component a HUD counter binds to. */
const Counter = component("Counter", { value: 0 });

/** A started plugin with two messages in its one locale. */
function started(): MockText {
  const mock = createMockText({
    messages: {
      ru: {
        "hud.first": [{ kind: "text", text: "один" }],
        "hud.second": [{ kind: "text", text: "два" }]
      }
    }
  });

  mock.start();

  return mock;
}

/**
 * Writes the label of entity 1 again over what it holds, as `ui` does after the layout phase.
 *
 * @param mock - The mock plugin.
 * @param patch - The fields `ui` writes.
 */
function rewrite(mock: MockText, patch: Partial<TextValue>): void {
  mock.ctx.deps.world.ecs.set(1, Text, patch);
}

describe("the layout system — a bind written again", () => {
  it("formats nothing when an equal bind arrives in a new object", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 95_000 });
    mock.world.put(
      1,
      Text,
      Text({ style: "digits", bind: bind(Counter, "value", { format: "duration" }) }).value
    );
    mock.step();

    rewrite(mock, { bind: bind(Counter, "value", { format: "duration" }) });
    mock.step();
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("ru:95s");
    expect(mock.i18n.durations).toEqual([95_000]);
  });

  it("formats again when only the format changes and the shown unit stands", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 95_000 });
    mock.world.put(
      1,
      Text,
      Text({ style: "digits", bind: bind(Counter, "value", { format: "mm:ss" }) }).value
    );
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("01:35");

    rewrite(mock, { bind: bind(Counter, "value", { format: "h:mm:ss" }) });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("0:01:35");
  });

  it("shows the content again when the bind is taken off", () => {
    const mock = started();

    mock.world.put(1, Counter, { value: 7 });
    mock.world.put(
      1,
      Text,
      Text({ style: "digits", content: "done", bind: bind(Counter, "value") }).value
    );
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("7");

    rewrite(mock, { bind: undefined });
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("done");
  });
});

describe("the layout system — content written again", () => {
  it("formats a new message once, not on every frame after", () => {
    const mock = started();

    mock.world.put(1, Text, Text({ content: { key: "hud.first" } }).value);
    mock.step();
    rewrite(mock, { content: { key: "hud.second" } });
    mock.step();
    mock.step();
    mock.step();

    expect(mock.world.read(1, Text)?.resolved).toBe("два");
    expect(mock.i18n.formatted).toEqual(["hud.first", "hud.second"]);
  });
});
