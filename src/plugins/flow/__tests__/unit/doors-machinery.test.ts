import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { Json } from "../../../model/types";
import { defineCommand, defineSource } from "../../doors/define";
import {
  controlReadOnly,
  controlRefused,
  isAgent,
  isControl,
  isDev,
  notInstalled
} from "../../doors/dev";
import { read, watch } from "../../doors/read";
import { run } from "../../doors/run";
import { cheatsOf, isTainted } from "../../doors/session";
import type { ControlApp, InputOf, Ran } from "../../doors/types";
import type { HeadlessApp } from "../../headless";
import { createDoorsFake } from "./doors-fake";

// ---------------------------------------------------------------------------
// Unit test: the door machinery over a hand-written app
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const positionSource = defineSource({
  id: "test.position",
  title: "Position",
  input: {},
  changes: "edge",
  read: (app: HeadlessApp) => app.flow.state().path
});

const coinsSource = defineSource({
  id: "test.coins",
  title: "Coins",
  input: {},
  changes: "commit",
  read: (app: HeadlessApp & { model: { store: { snapshot(): { player: Json } } } }) =>
    app.model.store.snapshot().player
});

const frameSource = defineSource({
  id: "test.frame",
  title: "Frame",
  input: { plus: "number?" },
  changes: "frame",
  read: (app: HeadlessApp, { plus }) => app.time.snapshot().frame + (plus ?? 0)
});

const tapCommand = defineCommand({
  id: "test.tap",
  title: "Tap",
  input: { intent: "string" },
  effect: "route",
  run: (app: ControlApp, { intent }) => app.flow.gate.answer({ intent })
});

const cheatCommand = defineCommand({
  id: "test.addCoins",
  title: "Add coins",
  input: { coins: "number" },
  effect: "cheat",
  run: async (_app: ControlApp, { coins }) => coins * 2
});

describe("isDev", () => {
  it("is off while the flag is undefined: production is the default", () => {
    expect(isDev()).toBe(false);
  });

  it("is on only when the flag is exactly true", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", false);
    expect(isDev()).toBe(false);

    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    expect(isDev()).toBe(true);
  });

  it("reads the agent and the control flag as on only when each is exactly true", () => {
    expect([isAgent(), isControl()]).toEqual([false, false]);

    vi.stubGlobal("__MOKU_GAME_AGENT__", "true");
    vi.stubGlobal("__MOKU_GAME_CONTROL__", 1);
    expect([isAgent(), isControl()]).toEqual([false, false]);

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    expect([isAgent(), isControl(), isDev()]).toEqual([true, false, false]);

    vi.stubGlobal("__MOKU_GAME_CONTROL__", true);
    expect([isAgent(), isControl(), isDev()]).toEqual([true, true, false]);
  });

  it("builds the refusal in the house error format", () => {
    expect(controlRefused().message).toBe(
      "[game] Control commands run in dev builds only.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
    );
  });
});

describe("notInstalled", () => {
  it("names the source and the missing plugin in the house error format", () => {
    expect(notInstalled("game.sounds", "audioPlugin").message).toBe(
      "[game] The source game.sounds needs audioPlugin.\n  Add audioPlugin to createApp({ plugins })."
    );
  });

  it("names a command when the kind says so", () => {
    expect(notInstalled("game.mute", "audioPlugin", "command").message).toBe(
      "[game] The command game.mute needs audioPlugin.\n  Add audioPlugin to createApp({ plugins })."
    );
  });
});

describe("defineSource and defineCommand", () => {
  it("hand the descriptor back frozen", () => {
    expect(Object.isFrozen(positionSource)).toBe(true);
    expect(Object.isFrozen(positionSource.input)).toBe(true);
    expect(Object.isFrozen(tapCommand)).toBe(true);
    expect(tapCommand.effect).toBe("route");
  });

  it.each([
    "position",
    "Game.position",
    "game.",
    "game..position",
    "game.po-sition",
    "1game.x"
  ])("refuse the id %s", id => {
    const source = () =>
      defineSource({ id, title: "Bad", input: {}, changes: "frame", read: () => 0 });
    const command = () =>
      defineCommand({ id, title: "Bad", input: {}, effect: "read", run: () => 0 });

    expect(source).toThrow(/^\[game] The source id ".*" is not a dotted name\.\n {2}.*\.$/);
    expect(command).toThrow(/^\[game] The command id ".*" is not a dotted name\.\n {2}.*\.$/);
  });

  it.each(["game.position", "mini.jumpToLevel", "game.ui.rect2"])("accept the id %s", id => {
    expect(defineSource({ id, title: "Ok", input: {}, changes: "frame", read: () => 0 }).id).toBe(
      id
    );
  });

  it("infer the input from the schema, optional kinds included", () => {
    type Input = InputOf<{ frames: "number"; deltaMs: "number?"; key: "string?"; on: "boolean" }>;

    expectTypeOf<Input>().toEqualTypeOf<{
      frames: number;
      on: boolean;
      deltaMs?: number | undefined;
      key?: string | undefined;
    }>();
    expectTypeOf<InputOf<{ payload: "json" }>>().toEqualTypeOf<{ payload: Json }>();
  });
});

/** The body of a command the type tests below never run. */
const runNothing = (_app: ControlApp): boolean => true;

/** Six command shapes the overlay cannot use: each must fail to compile, so none is ever built. */
const refusedShapes = () => [
  // @ts-expect-error — a toggle the overlay cannot draw: no value.
  defineCommand({
    id: "t.a",
    title: "A",
    input: { on: "boolean" },
    effect: "cosmetic",
    overlay: "toggle",
    run: runNothing
  }),
  defineCommand({
    id: "t.b",
    title: "B",
    // @ts-expect-error — a toggle runs with { on } only.
    input: { level: "number" },
    effect: "cosmetic",
    overlay: "toggle",
    value: () => true,
    run: runNothing
  }),
  defineCommand({
    id: "t.c",
    title: "C",
    // @ts-expect-error — a toggle takes exactly { on: "boolean" }, nothing beside it.
    input: { on: "boolean", level: "number" },
    effect: "cosmetic",
    overlay: "toggle",
    value: () => true,
    run: runNothing
  }),
  defineCommand({
    id: "t.d",
    title: "D",
    // @ts-expect-error — the overlay runs a button with {}.
    input: { key: "string" },
    effect: "cosmetic",
    overlay: "button",
    run: runNothing
  }),
  // @ts-expect-error — a button has no value.
  defineCommand({
    id: "t.e",
    title: "E",
    input: {},
    effect: "cosmetic",
    overlay: "button",
    value: () => true,
    run: runNothing
  }),
  // @ts-expect-error — a value without the toggle marker draws nothing.
  defineCommand({
    id: "t.f",
    title: "F",
    input: {},
    effect: "cosmetic",
    value: () => true,
    run: runNothing
  })
];

describe("defineCommand with an overlay marker", () => {
  /** What the overlay toggle of the test reads and writes. */
  const glow = { on: true };

  const glowSwitch = defineCommand({
    id: "test.glow",
    title: "Glow",
    input: { on: "boolean" },
    effect: "cosmetic",
    overlay: "toggle",
    value: () => glow.on,
    run: (_app: ControlApp, { on }) => {
      glow.on = on;

      return on;
    }
  });

  const recenter = defineCommand({
    id: "test.recenter",
    title: "Recenter",
    input: { zoom: "number?" },
    effect: "cosmetic",
    overlay: "button",
    run: (_app: ControlApp, { zoom }) => zoom ?? 1
  });

  it("accepts a toggle with input { on: boolean } and a value, and a button with no required input", async () => {
    const fake = createDoorsFake();
    // What the overlay does: a toggle's switch is drawn from its value, told apart by the marker.
    const switchOf = (command: typeof glowSwitch | typeof recenter): boolean | undefined =>
      command.overlay === "toggle" ? command.value(fake.app) : undefined;

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    expect([switchOf(glowSwitch), switchOf(recenter), recenter.overlay]).toEqual([
      true,
      undefined,
      "button"
    ]);
    // The overlay runs a toggle with { on: !value(app) } and a button with {}.
    const toggled = await run(fake.app, glowSwitch, { on: !switchOf(glowSwitch) });
    const pressed = await run(fake.app, recenter, {});

    expect([toggled.value, switchOf(glowSwitch), pressed.value]).toEqual([false, false, 1]);
  });

  it("refuses at compile time a toggle without value, a toggle with another input, a button with a required input or a value, and a value without a toggle", () => {
    expectTypeOf(refusedShapes).toBeFunction();
  });
});

describe("read", () => {
  it("reads a source with no input", () => {
    const fake = createDoorsFake();

    expect(read(fake.app, positionSource)).toBe("home");
  });

  it("passes an empty input when every field is optional and none is given", () => {
    const fake = createDoorsFake();

    expect(read(fake.app, frameSource)).toBe(0);
    expect(read(fake.app, frameSource, { plus: 5 })).toBe(5);
  });

  it("types the input: required fields cannot be left out", () => {
    const fake = createDoorsFake();
    const keyed = defineSource({
      id: "test.keyed",
      title: "Keyed",
      input: { key: "string" },
      changes: "frame",
      read: (_app, { key }) => key.length
    });

    expect(read(fake.app, keyed, { key: "play" })).toBe(4);
    // @ts-expect-error -- the key is required.
    expect(() => read(fake.app, keyed)).toThrow(TypeError);
  });

  it("types the app: a source that needs more than the headless app refuses a smaller one", () => {
    const fake = createDoorsFake();
    const screen = defineSource({
      id: "test.screen",
      title: "Screen",
      input: {},
      changes: "frame",
      read: (app: HeadlessApp & { ui: { tree(): string } }) => app.ui.tree()
    });
    const withUi = { ...fake.app, ui: { tree: () => "root" } };

    expect(read(withUi, screen)).toBe("root");
    // @ts-expect-error -- the fake app has no ui.
    expect(() => read(fake.app, screen)).toThrow(TypeError);
  });
});

describe("watch", () => {
  it("registers on the signals phase and calls on the first frame", () => {
    const fake = createDoorsFake();
    const seen: string[] = [];

    watch(fake.app, positionSource, undefined, path => seen.push(path));

    expect(fake.phases).toEqual(["signals"]);
    expect(seen).toEqual([]);

    fake.frame();

    expect(seen).toEqual(["home"]);
  });

  it("reads an edge source again only when the flow state changed", () => {
    const fake = createDoorsFake();
    const reader = vi.fn((app: HeadlessApp) => app.flow.state().path);
    const source = defineSource({
      id: "test.path",
      title: "Path",
      input: {},
      changes: "edge",
      read: reader
    });
    const seen: string[] = [];

    watch(fake.app, source, undefined, path => seen.push(path));
    fake.frame();
    fake.frame();
    fake.frame();

    expect(seen).toEqual(["home"]);
    expect(reader).toHaveBeenCalledTimes(1);

    fake.moveGraph("board/awaitIntent");
    fake.frame();
    fake.frame();

    expect(seen).toEqual(["home", "board/awaitIntent"]);
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("reads a commit source again only when the snapshot changed", () => {
    const fake = createDoorsFake();
    const seen: Json[] = [];

    watch(fake.app, coinsSource, undefined, player => seen.push(player));
    fake.frame();
    fake.moveGraph("board/awaitIntent");
    fake.frame();

    expect(seen).toEqual([{ coins: 0 }]);

    fake.commit({ coins: 3 });
    fake.frame();

    expect(seen).toEqual([{ coins: 0 }, { coins: 3 }]);
  });

  it("reads a frame source on every frame, with its input", () => {
    const fake = createDoorsFake();
    const seen: number[] = [];

    watch(fake.app, frameSource, { plus: 100 }, frame => seen.push(frame));
    fake.frame();
    fake.frame();

    expect(seen).toEqual([101, 102]);
  });

  it("stops with the returned function", () => {
    const fake = createDoorsFake();
    const seen: number[] = [];
    const stop = watch(fake.app, frameSource, undefined, frame => seen.push(frame));

    fake.frame();
    stop();
    fake.frame();

    expect(seen).toEqual([1]);
    expect(fake.callbacks()).toBe(0);
  });
});

describe("run", () => {
  it("refuses without the dev flag", async () => {
    const fake = createDoorsFake();

    await expect(run(fake.app, tapCommand, { intent: "play" })).rejects.toThrow(
      "[game] Control commands run in dev builds only.\n  Define __MOKU_GAME_DEV__ as true in the dev build."
    );
    expect(fake.answers).toEqual([]);
  });

  it("refuses with the flag set to false", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", false);
    const fake = createDoorsFake();

    await expect(run(fake.app, tapCommand, { intent: "play" })).rejects.toThrow(
      "Control commands run in dev builds only"
    );
  });

  it("with only AGENT true runs a read and a cosmetic command, and refuses route, cheat and raw as read-only", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const fake = createDoorsFake();
    const ranWith = (effect: "read" | "cosmetic" | "route" | "cheat" | "raw") =>
      run(
        fake.app,
        defineCommand({
          id: `test.${effect}`,
          title: "Effect",
          input: {},
          effect,
          run: () => effect
        })
      );

    await expect(ranWith("read")).resolves.toMatchObject({ value: "read" });
    await expect(ranWith("cosmetic")).resolves.toMatchObject({ value: "cosmetic" });

    for (const effect of ["route", "cheat", "raw"] as const) {
      const refused = await ranWith(effect).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(refused).toBeInstanceOf(Error);
      expect(Reflect.get(Object(refused), "reason")).toBe("read-only");
      expect((refused as Error).message).toBe(
        `[game] The command test.${effect} changes the game: this debug build runs read and cosmetic commands only.\n  Build with moku-game build --debug=full to run it.`
      );
    }

    await expect(run(fake.app, tapCommand, { intent: "play" })).rejects.toThrow(
      controlReadOnly("test.tap").message
    );
    expect(fake.answers).toEqual([]);
    expect(cheatsOf(fake.app)).toEqual([]);
  });

  it("with AGENT and CONTROL true runs a route and a raw command", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("__MOKU_GAME_CONTROL__", true);
    const fake = createDoorsFake();

    await expect(run(fake.app, tapCommand, { intent: "play" })).resolves.toMatchObject({
      value: true
    });
    await expect(run(fake.app, cheatCommand, { coins: 3 })).resolves.toMatchObject({
      state: { tainted: true }
    });
    expect(fake.answers).toEqual([{ intent: "play" }]);
  });

  it("runs the command and wraps its value in the envelope read after it", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();
    const moving = defineCommand({
      id: "test.play",
      title: "Play",
      input: {},
      effect: "route",
      run: (app: ControlApp) => app.flow.walk([{ at: "home", intent: "play" }])
    });

    fake.frame();
    fake.frame();

    const ran = await run(fake.app, moving);

    expect(ran.value.path).toBe("board/awaitIntent");
    expect(ran.state).toEqual({ path: "board/awaitIntent", frame: 2, tainted: false });
  });

  it("types the envelope from the command's value", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();
    const ran = await run(fake.app, cheatCommand, { coins: 2 });

    expectTypeOf(ran).toEqualTypeOf<Ran<number>>();
    expect(ran.value).toBe(4);
  });

  it("keeps a route command's session clean", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    const ran = await run(fake.app, tapCommand, { intent: "play" });

    expect(ran.value).toBe(true);
    expect(ran.state.tainted).toBe(false);
    expect(isTainted(fake.app)).toBe(false);
    expect(cheatsOf(fake.app)).toEqual([]);
  });

  it.each([
    "cheat",
    "raw"
  ] as const)("taints the session and journals a %s command", async effect => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();
    const other = createDoorsFake();
    const command = defineCommand({
      id: "test.write",
      title: "Write",
      input: { coins: "number" },
      effect,
      run: () => "written"
    });

    fake.frame();
    const ran = await run(fake.app, command, { coins: 9 });

    expect(ran.state.tainted).toBe(true);
    expect(isTainted(fake.app)).toBe(true);
    expect(cheatsOf(fake.app)).toEqual([{ id: "test.write", input: { coins: 9 }, frame: 1 }]);
    expect(isTainted(other.app)).toBe(false);
  });

  it("journals a cheat before it runs, so a failing cheat still taints", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();
    const failing = defineCommand({
      id: "test.fail",
      title: "Fail",
      input: {},
      effect: "raw",
      run: (): number => {
        throw new Error("[game] The write failed.\n  Try again.");
      }
    });

    await expect(run(fake.app, failing)).rejects.toThrow("The write failed");
    expect(isTainted(fake.app)).toBe(true);
    expect(cheatsOf(fake.app)).toHaveLength(1);
  });

  it("keeps the last 500 cheats, oldest dropped, as a frozen list", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();

    for (let coins = 0; coins < 502; coins += 1) {
      await run(fake.app, cheatCommand, { coins });
    }

    const cheats = cheatsOf(fake.app);

    expect(cheats).toHaveLength(500);
    expect(cheats[0]?.input).toEqual({ coins: 2 });
    expect(cheats.at(-1)?.input).toEqual({ coins: 501 });
    expect(Object.isFrozen(cheats)).toBe(true);
  });

  it("copies the journaled input, so the caller cannot rewrite the journal", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const fake = createDoorsFake();
    const input = { coins: 1 };

    await run(fake.app, cheatCommand, input);
    input.coins = 99;

    expect(cheatsOf(fake.app)[0]?.input).toEqual({ coins: 1 });
  });
});
