/**
 * @file ui plugin — the app of the text input tests (Delta 8): a Rename popup whose name field
 * submits "save", a confirm popup opened over it, a profile screen whose component keeps a
 * nickname, a field outside every component and a field without `local`. Real flow runner,
 * plain Bun, inert renderer, real Yoga, and a fake `text.measure` of 10 px per character. With
 * `dom`, the renderer hands out a canvas of a fake page, so `ui` makes its hidden input there. A
 * probe lands the body font late, as a page whose fonts load async does.
 */
import { vi } from "vitest";
import { createApp, createPlugin, defineGame, projection, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import type { Answer } from "../../flow/gate/types";
import { i18nPlugin } from "../../i18n";
import type { CompiledMessages, Message } from "../../i18n/types";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { Parent, Shape } from "../../renderer/components";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { Text } from "../../text/components";
import { worldPlugin } from "../../world";
import { popup } from "../components";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { UiNode } from "../jsx/types";
import { createFakeCanvas, createFakeDom, type FakeCanvas, type FakeDom } from "./fake-dom";

/** The player of the fixture: the name the Rename popup saves, and how often it was saved. */
export type FieldPlayer = { name: string; saves: number };

const { defineNode, defineFlow, defineFeature, tr } = defineGame<{
  player: FieldPlayer;
  session: { visits: number };
  assets: string;
  strings: { "rename.hint": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "rename.hint": () => [{ kind: "text", text: "Your name" }]
};

/** The size of every button of the fixture. */
const control = { width: 200, height: 80 } as const;

/** The name field's box: 600 x 100 with 20 of padding. */
export const nameBox = { width: 600, height: 100, padding: 20 } as const;

/** The rename popup: a name field that submits "save", a counter, a note field and two buttons. */
export const Rename = defineComponent("Rename", {
  local: { name: "", note: "" },
  outcomes: { save: type<{ name: string }>(), close: type(), confirm: type() },
  view: (_props: object, local) => (
    <panel key="renamePanel" style={{ width: 800, height: 700, fill: 0x10_10_18 }}>
      <input
        key="nameField"
        local="name"
        maxLength={16}
        submit="save"
        placeholder={tr("rename.hint")}
        style={{ ...nameBox, fill: 0xff_ff_ff, radius: 12 }}
      />
      <text key="count" style={{ width: 200, height: 40 }} content={`${local.name.length}/16`} />
      <input key="noteField" local="note" kind="email" style={{ width: 600, height: 100 }} />
      <button key="ok" intent="save" payload={{ name: local.name }} style={control} />
      <button key="ask" intent="confirm" style={control} />
    </panel>
  )
});

/** The popup opened over the rename popup. */
export const Confirm = defineComponent("Confirm", {
  outcomes: { yes: type(), no: type() },
  view: () => (
    <panel key="confirmPanel" style={{ width: 400, height: 300, fill: 0x20_20_20 }}>
      <button key="no" intent="no" style={control} />
    </panel>
  )
});

/**
 * A screen component that keeps a nickname; the low field sits near the bottom of the screen and
 * names another placeholder once it holds text.
 */
export const Profile = defineComponent("Profile", {
  local: { nick: "", low: "" },
  view: (_props: object, local) => (
    <column key="profileRoot" style={{ width: 1080, height: 1400 }}>
      <input key="nickField" local="nick" maxLength={8} style={{ width: 400, height: 80 }} />
      <text key="nickEcho" style={{ width: 400, height: 40 }} content={`nick:${local.nick}`} />
      <button key="other" local={{ nick: local.nick }} style={control} />
      <input
        key="lowField"
        local="low"
        placeholder={local.low === "" ? "Low" : "Low (typed)"}
        style={{ position: "absolute", left: 0, top: 1300, width: 400, height: 80 }}
      />
    </column>
  )
});

/** One row of a single-root screen. */
type ScreenItem = { id: string };

/** The profile screen. */
export const profileScreen = projection({
  name: "profile",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "profileView" }],
  key: (item: ScreenItem) => item.id,
  view: () => <Profile key="profile" />
});

/** Two fields straight in a projection view, outside every component; one is too small to tap. */
export const looseScreen = projection({
  name: "loose",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "loose" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    <column key="looseRoot" style={{ width: 600, height: 300 }}>
      <input key="looseField" local="free" style={{ width: 300, height: 80 }} />
      <input key="tinyField" local="tiny" style={{ width: 30, height: 30 }} />
    </column>
  )
});

/** A field that names no local field. */
export const bareScreen = projection({
  name: "bare",
  layer: "ui",
  from: (): ScreenItem[] => [{ id: "bare" }],
  key: (item: ScreenItem) => item.id,
  view: () => (
    // @ts-expect-error — an input without `local` is the case under test.
    <input key="bareField" style={{ width: 300, height: 80 }} />
  )
});

const home = defineNode({ rest: true, outcomes: { rename: type() } });

const renaming = defineNode({
  rest: true,
  outcomes: { save: type<{ name: string }>(), close: type(), confirm: type() },
  run: async ({ fx, out }) => {
    const answer = (await fx(popup(Rename, {}))) as Answer | undefined;
    const payload = answer?.payload as { name?: string } | undefined;

    if (answer?.intent === "save") return out.save({ name: payload?.name ?? "" });
    if (answer?.intent === "confirm") return out.confirm();

    return out.close();
  }
});

const named = defineNode({
  input: type<{ name: string }>(),
  outcomes: { done: type() },
  run: ({ input, player, out }) => {
    player.name = input.name;
    player.saves += 1;

    return out.done();
  }
});

const confirming = defineNode({
  outcomes: { yes: type(), no: type() },
  run: async ({ fx, out }) => {
    const answer = (await fx(popup(Confirm, {}, { over: "Rename" }))) as Answer | undefined;

    return answer?.intent === "yes" ? out.yes() : out.no();
  }
});

const main = defineFlow("main", {
  nodes: { home, renaming, named, confirming },
  start: "home",
  outcomes: {},
  edges: {
    home: { rename: "renaming" },
    renaming: { save: "named", close: "home", confirm: "confirming" },
    named: { done: "home" },
    confirming: { yes: "home", no: "renaming" }
  }
});

/** The feature of the text input fixture. */
export const fieldFeature = defineFeature("fields", {
  flows: [main],
  projections: [profileScreen, looseScreen, bareScreen],
  ui: [Rename, Confirm, Profile],
  strings: { en: english }
});

/** The body font key of `text`, the font every field of the fixture is drawn in. */
const BODY_FONT = "ui.font-body";

/** A BMFont of the body font, for `text` to read when the probe lands it. */
const bodyFont = JSON.stringify({
  info: { face: "body", size: 32 },
  common: { lineHeight: 40, base: 32 },
  chars: [{ id: 65, char: "A", xadvance: 20 }]
});

/** Sends `assets:bundle-loaded` the way `assets` does, so `text` reads the fonts it can find. */
const fontProbe = createPlugin("fontProbe", {
  depends: [assetsPlugin],
  api: ctx => ({
    land: (bundle: string): void => {
      ctx.emit("assets:bundle-loaded", { bundle, tier: "lazy", mb: 0, reason: "request" });
    }
  })
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * The fake measure of the fixture: 10 px per character of a plain string, a 40 px line.
 *
 * @param content - What is measured.
 * @returns The size.
 */
function measure(content: string | Message): { width: number; height: number } {
  return { width: typeof content === "string" ? content.length * 10 : 0, height: 40 };
}

/** The page of an app started with `dom`. */
export type FieldPage = { dom: FakeDom; canvas: FakeCanvas };

/**
 * Makes a fake page and a canvas on it.
 *
 * @param innerHeight - The window height in CSS px.
 * @returns The page.
 */
function pageOf(innerHeight: number | undefined): FieldPage {
  const dom = createFakeDom(innerHeight);

  return { dom, canvas: createFakeCanvas(dom) };
}

/**
 * Starts the screen set plus `ui` headless, with the flow resting on `home`.
 *
 * @param options - `dom` gives the renderer a canvas of a fake page; `innerHeight` sizes it.
 * @param options.dom - Whether `ui` finds a page through the canvas.
 * @param options.innerHeight - The window height of the fake page in CSS px.
 * @returns The started app, one frame in, and the fake page when there is one.
 */
export async function startFieldApp(options: { dom?: boolean; innerHeight?: number } = {}) {
  const app = createApp({
    plugins: [
      worldPlugin,
      rendererPlugin,
      inputPlugin,
      assetsPlugin,
      scenesPlugin,
      animPlugin,
      i18nPlugin,
      textPlugin,
      uiPlugin,
      fontProbe,
      fieldFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { name: "", saves: 0 }, initialSession: { visits: 0 }, seed: 1 }
    }
  });
  const page = options.dom ? pageOf(options.innerHeight) : undefined;

  if (page !== undefined)
    vi.spyOn(app.renderer.host, "canvas").mockReturnValue(page.canvas.element);

  vi.spyOn(app.text, "measure").mockImplementation(measure);

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.time.step(16);

  return { app, page };
}

/** The app `startFieldApp` builds. */
export type FieldApp = Awaited<ReturnType<typeof startFieldApp>>["app"];

/**
 * Lands the body font after the fields were placed: `assets` answers for it, a bundle-loaded
 * reaches `text`, and the fake measure answers 20 px per character from now on, as the real
 * advances replace the fallback metrics.
 *
 * @param app - The running app.
 */
export function landBodyFont(app: FieldApp): void {
  vi.spyOn(app.assets, "font").mockImplementation(key =>
    key === BODY_FONT ? { fnt: bodyFont, texture: undefined as never } : undefined
  );
  vi.mocked(app.text.measure).mockImplementation(content => ({
    width: typeof content === "string" ? content.length * 20 : 0,
    height: 40
  }));
  app.fontProbe.land("fonts");
}

/**
 * Lets the runner move, then runs frames, so the next node is entered and the screen follows.
 *
 * @param app - The running app.
 * @param frames - How many frames to step after the runner moved.
 */
export async function settle(app: FieldApp, frames = 2): Promise<void> {
  await tick();

  for (let frame = 0; frame < frames; frame += 1) app.time.step(16);
}

/**
 * Mounts one screen of the fixture and gives it the two frames of a reconcile and a solve.
 *
 * @param app - The running app.
 * @param name - The projection name.
 */
export function mountScreen(app: FieldApp, name: string): void {
  app.world.projection.mount([name], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);
}

/**
 * Opens the rename popup from `home` and lets it mount.
 *
 * @param app - The running app.
 */
export async function openRename(app: FieldApp): Promise<void> {
  app.flow.gate.answer({ intent: "rename" });
  await settle(app, 3);
}

/**
 * The entity of a keyed element, or a failure when it is not on screen.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
export function find(app: FieldApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  if (entity === undefined) throw new Error(`no element "${key}" on screen`);

  return entity;
}

/** The four parts of a field, told apart by what they draw. */
export type Parts = {
  selection: number | undefined;
  text: number | undefined;
  caret: number | undefined;
  composing: number | undefined;
  all: number[];
};

/**
 * The part entities a field carries: every entity whose `Parent` is the field. The text part draws
 * a `Text`; the selection is the shape in the selection colour; of the two caret-coloured shapes
 * the composing underline is the 3 u tall one.
 *
 * @param app - The running app.
 * @param field - The field entity.
 * @returns The parts.
 */
export function partsOf(app: FieldApp, field: number): Parts {
  const ecs = app.world.ecs;
  const all = [...ecs.query(Parent)]
    .filter(([, parent]) => parent.entity === field)
    .map(([entity]) => entity);
  const shapes = all.filter(entity => ecs.has(entity, Shape));
  const selection = shapes.find(entity => ecs.get(entity, Shape)?.fill === 0x33_90_ff);
  const others = shapes.filter(entity => entity !== selection);

  return {
    selection,
    text: all.find(entity => ecs.has(entity, Text)),
    caret: others.find(entity => ecs.get(entity, Shape)?.h !== 3),
    composing: others.find(entity => ecs.get(entity, Shape)?.h === 3),
    all
  };
}

/**
 * The alpha of a part's shape, or -1 when the part draws none.
 *
 * @param app - The running app.
 * @param part - The part entity.
 * @returns The alpha.
 */
export function alphaOf(app: FieldApp, part: number | undefined): number {
  return part === undefined ? -1 : (app.world.ecs.get(part, Shape)?.alpha ?? -1);
}

/**
 * Finds a keyed node in a snapshot.
 *
 * @param node - Where the search starts.
 * @param key - The key of the element.
 * @returns The node, or `undefined`.
 */
export function nodeOf(node: UiNode, key: string): UiNode | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeOf(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * The payloads of every log entry of one event so far.
 *
 * @param app - The running app.
 * @param event - The event name.
 * @returns The payloads, in order.
 */
export function logged(app: FieldApp, event: string): unknown[] {
  return app.log
    .trace()
    .filter(entry => entry.event === event)
    .map(entry => entry.data);
}
