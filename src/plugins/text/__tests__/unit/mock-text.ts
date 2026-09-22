/**
 * @file text plugin — shared fakes for the unit tests. Not a test file: the unit project only
 * collects `*.test.ts`. The real state, API, handlers and lifecycle run over a fake world store,
 * a fake `i18n`, a fake `renderer` whose Pixi module is four tiny classes, a fake `assets` and a
 * fake `flow`, so every case runs in plain Bun. The real `world` runs the same code in the
 * integration test.
 */
import type { Log } from "@moku-labs/common/browser";
import { vi } from "vitest";
import type { Require } from "../../../../config";
import type { Api as AssetsApi, FontAsset } from "../../../assets/types";
import type { FeatureDescription, Api as FlowApi } from "../../../flow/types";
import type { I18nApi, Message, Part } from "../../../i18n/types";
import type { DisplayAdapter } from "../../../renderer/sync/types";
import type { PixiModule, PixiTexture, Api as RendererApi } from "../../../renderer/types";
import type { Api as TimeApi } from "../../../time/types";
import type {
  AnyComponent,
  AnyComponentType,
  AnySystem,
  ComponentHandle,
  Entity
} from "../../../world/ecs/types";
import type { Api as WorldApi } from "../../../world/types";
import { createTextApi } from "../../api";
import { createHandlers } from "../../handlers";
import { startText, stopText, withDeps } from "../../lifecycle";
import { createTextState } from "../../state";
import type { Config, State, TextApi, TextCtx, TextValue } from "../../types";

/** One display object of the fake Pixi module. */
export type FakeObject = {
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  skew: { x: number; y: number };
  texture: PixiTexture | undefined;
  options: Record<string, unknown>;
  children: FakeObject[];
  destroyed: boolean;
  destroyOptions: unknown;
  addChild(child: FakeObject): FakeObject;
  removeChildren(): FakeObject[];
  destroy(options?: unknown): void;
};

/**
 * Creates one display object of the fake Pixi module.
 *
 * @param kind - Which class made it: `Container`, `BitmapText` or `Sprite`.
 * @param options - What the constructor was handed.
 * @returns The fake object.
 */
function makeObject(kind: string, options: Record<string, unknown> = {}): FakeObject {
  const object: FakeObject = {
    kind,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    skew: { x: 0, y: 0 },
    texture: undefined,
    options,
    children: [],
    destroyed: false,
    destroyOptions: undefined,
    addChild: (child: FakeObject): FakeObject => {
      object.children.push(child);

      return child;
    },
    removeChildren: (): FakeObject[] => object.children.splice(0),
    destroy: (destroyOptions?: unknown): void => {
      object.destroyed = true;
      object.destroyOptions = destroyOptions;
    }
  };

  return object;
}

/**
 * Creates the fake Pixi module: the three classes the adapter builds with, and the empty texture
 * an icon without art falls back to.
 *
 * @returns A module shaped like the part of Pixi the engine uses.
 */
function createFakePixi(): PixiModule {
  const module = {
    Container: function Container(): FakeObject {
      return makeObject("Container");
    },
    BitmapText: function BitmapText(options: Record<string, unknown>): FakeObject {
      return makeObject("BitmapText", options);
    },
    Sprite: function Sprite(texture: PixiTexture | undefined): FakeObject {
      const object = makeObject("Sprite");

      object.texture = texture;

      return object;
    },
    Texture: { EMPTY: { label: "empty" } }
  };

  return module as unknown as PixiModule;
}

/** The fake world store: what `text` wrote, and what a test put there. */
export type FakeWorld = {
  api: WorldApi;
  systems: AnySystem[];
  writes: Array<{ entity: Entity; component: string; patch: Record<string, unknown> }>;
  /** Writes a component value and fires the `onAdded` listeners of that component. */
  put(entity: Entity, component: ComponentHandle<object>, value: object): void;
  /** Removes a component and fires the `onRemoved` listeners. */
  drop(entity: Entity, component: ComponentHandle<object>): void;
  /** The stored value of a component, as the plugin left it. */
  read(entity: Entity, component: ComponentHandle<object>): Record<string, unknown> | undefined;
};

/**
 * Creates the fake world: one store per component name, the six `ecs` members `text` calls, and
 * the structural listeners it registers.
 *
 * @returns The fake world.
 */
function createFakeWorld(): FakeWorld {
  const stores = new Map<string, Map<Entity, Record<string, unknown>>>();
  const types = new Map<string, AnyComponent>();
  const added = new Map<string, Array<(entity: Entity, value: object) => void>>();
  const removed = new Map<string, Array<(entity: Entity, value: object) => void>>();
  const systems: AnySystem[] = [];
  const writes: FakeWorld["writes"] = [];

  const storeOf = (name: string): Map<Entity, Record<string, unknown>> => {
    const store = stores.get(name) ?? new Map<Entity, Record<string, unknown>>();

    stores.set(name, store);

    return store;
  };

  const listeners = (
    table: Map<string, Array<(entity: Entity, value: object) => void>>,
    name: string
  ): Array<(entity: Entity, value: object) => void> => {
    const list = table.get(name) ?? [];

    table.set(name, list);

    return list;
  };

  const subscribe = (
    table: Map<string, Array<(entity: Entity, value: object) => void>>,
    component: { componentName: string },
    fn: (entity: Entity, value: object) => void
  ): (() => void) => {
    const list = listeners(table, component.componentName);

    list.push(fn);

    return (): void => {
      const at = list.indexOf(fn);

      if (at !== -1) list.splice(at, 1);
    };
  };

  const ecs = {
    system: (definition: AnySystem): (() => void) => {
      systems.push(definition);

      return (): void => {
        const at = systems.indexOf(definition);

        if (at !== -1) systems.splice(at, 1);
      };
    },
    get: (entity: Entity, component: { componentName: string }): object | undefined =>
      storeOf(component.componentName).get(entity),
    set: (
      entity: Entity,
      component: { componentName: string },
      patch: Record<string, unknown>
    ): void => {
      const stored = storeOf(component.componentName).get(entity) ?? {};

      writes.push({ entity, component: component.componentName, patch });
      storeOf(component.componentName).set(entity, { ...stored, ...patch });
    },
    has: (entity: Entity, component: { componentName: string }): boolean =>
      storeOf(component.componentName).has(entity),
    typeOf: (name: string): AnyComponent | undefined => types.get(name),
    query: function* (...terms: AnyComponentType[]): Iterable<unknown[]> {
      const first = terms[0];

      if (first === undefined) return;

      for (const [entity, value] of storeOf(first.componentName)) {
        if (terms.every(term => storeOf(term.componentName).has(entity))) {
          yield [
            entity,
            value,
            ...terms.slice(1).map(term => storeOf(term.componentName).get(entity))
          ];
        }
      }
    },
    onAdded: (
      component: { componentName: string },
      fn: (entity: Entity, value: object) => void
    ): (() => void) => subscribe(added, component, fn),
    onRemoved: (
      component: { componentName: string },
      fn: (entity: Entity, value: object) => void
    ): (() => void) => subscribe(removed, component, fn)
  };

  return {
    api: { ecs } as unknown as WorldApi,
    systems,
    writes,
    put: (entity: Entity, component: ComponentHandle<object>, value: object): void => {
      types.set(component.componentName, component as unknown as AnyComponent);
      storeOf(component.componentName).set(entity, { ...value } as Record<string, unknown>);

      for (const fn of listeners(added, component.componentName)) fn(entity, value);
    },
    drop: (entity: Entity, component: ComponentHandle<object>): void => {
      const value = storeOf(component.componentName).get(entity) ?? {};

      storeOf(component.componentName).delete(entity);

      for (const fn of listeners(removed, component.componentName)) fn(entity, value);
    },
    read: (
      entity: Entity,
      component: ComponentHandle<object>
    ): Record<string, unknown> | undefined => storeOf(component.componentName).get(entity)
  };
}

/** The fake `i18n`: one table of parts per locale, switched by hand. */
export type FakeI18n = {
  api: I18nApi;
  locale: string;
  messages: Record<string, Record<string, Part[]>>;
  formatted: string[];
};

/**
 * Creates the fake `i18n` over a table of already formatted parts.
 *
 * @param messages - Parts per locale and key.
 * @returns The fake i18n.
 */
function createFakeI18n(messages: Record<string, Record<string, Part[]>>): FakeI18n {
  const fake: FakeI18n = {
    api: undefined as unknown as I18nApi,
    locale: "ru",
    messages,
    formatted: []
  };

  fake.api = {
    locale: (): string => fake.locale,
    format: (message: Message): readonly Part[] => {
      fake.formatted.push(message.key);

      return (
        fake.messages[fake.locale]?.[message.key] ?? [{ kind: "text", text: `⟦${message.key}⟧` }]
      );
    },
    plain: (message: Message): string =>
      fake.api
        .format(message)
        .map(part => (part.kind === "text" ? part.text : ""))
        .join("")
  } as unknown as I18nApi;

  return fake;
}

/** The fake `assets`: the fonts and textures a test put there. */
export type FakeAssets = {
  api: AssetsApi;
  fonts: Map<string, FontAsset>;
  textures: Map<string, PixiTexture>;
};

/**
 * Creates the fake `assets`, empty: a test adds a font when it wants the real advance table.
 *
 * @returns The fake assets.
 */
function createFakeAssets(): FakeAssets {
  const fonts = new Map<string, FontAsset>();
  const textures = new Map<string, PixiTexture>();

  const api = {
    font: (key: string): FontAsset | undefined => fonts.get(key),
    texture: (key: string): PixiTexture | undefined => textures.get(key)
  } as unknown as AssetsApi;

  return { api, fonts, textures };
}

/** The fake `renderer`: the display registry and the font registry `text` writes into. */
export type FakeRenderer = {
  api: RendererApi;
  ready: boolean;
  installed: string[];
  provided: Array<{ component: string; adapter: DisplayAdapter<TextValue> }>;
  removedDisplays: number;
};

/**
 * Creates the fake `renderer`, inert: `ready()` is false and `pixi()` answers nothing until a
 * test turns the screen on.
 *
 * @returns The fake renderer.
 */
function createFakeRenderer(): FakeRenderer {
  const pixi = createFakePixi();
  const fake: FakeRenderer = {
    api: undefined as unknown as RendererApi,
    ready: false,
    installed: [],
    provided: [],
    removedDisplays: 0
  };

  fake.api = {
    host: {
      ready: (): boolean => fake.ready,
      pixi: (): PixiModule | undefined => (fake.ready ? pixi : undefined)
    },
    sync: {
      displays: {
        provide: (
          component: { componentName: string },
          adapter: DisplayAdapter<TextValue>
        ): (() => void) => {
          fake.provided.push({ component: component.componentName, adapter });

          return (): void => {
            fake.removedDisplays += 1;
          };
        }
      },
      fonts: {
        install: (key: string): void => {
          fake.installed.push(key);
        },
        installed: (key: string): boolean => fake.installed.includes(key)
      }
    }
  } as unknown as RendererApi;

  return fake;
}

/** Everything a unit test drives the plugin with. */
export type MockText = {
  ctx: TextCtx;
  state: State;
  api: TextApi;
  log: Log.LogApi;
  world: FakeWorld;
  i18n: FakeI18n;
  assets: FakeAssets;
  renderer: FakeRenderer;
  wake: ReturnType<typeof vi.fn>;
  hooks: ReturnType<typeof createHandlers>;
  start(): void;
  stop(): void;
  /** Runs the one world system `text` registered, the way `world` runs a phase. */
  step(): void;
};

/** Creates the engine log as spies. */
function createMockLog(): Log.LogApi {
  return {
    addSink: vi.fn(),
    clearSinks: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    expect: vi.fn(),
    info: vi.fn(),
    reset: vi.fn(),
    trace: vi.fn(() => []),
    warn: vi.fn()
  };
}

/** The config defaults, as `index.ts` declares them. */
function defaultConfig(): Config {
  return { fonts: { body: "ui.font-body", digits: "ui.font-digits" }, missingGlyph: "□" };
}

/**
 * Creates the mock plugin: the real state, API, handlers and lifecycle over the fakes.
 *
 * @param options - Config overrides, the features `flow` answers with, and the message tables.
 * @param options.config - Config overrides.
 * @param options.features - What `flow.features.all()` answers.
 * @param options.messages - Formatted parts per locale and message key.
 * @returns The mock plugin.
 */
export function createMockText(
  options: {
    config?: Partial<Config>;
    features?: Array<{ name: string; description: FeatureDescription }>;
    messages?: Record<string, Record<string, Part[]>>;
  } = {}
): MockText {
  const config: Config = { ...defaultConfig(), ...options.config };
  const state = createTextState();
  const log = createMockLog();
  const world = createFakeWorld();
  const i18n = createFakeI18n(options.messages ?? {});
  const assets = createFakeAssets();
  const renderer = createFakeRenderer();
  const wake = vi.fn();
  const flow = {
    features: { all: () => options.features ?? [] }
  } as unknown as FlowApi;
  const time = { wake } as unknown as TimeApi;

  const apis: Record<string, unknown> = {
    time,
    flow,
    world: world.api,
    renderer: renderer.api,
    assets: assets.api,
    i18n: i18n.api
  };

  const kernel = {
    config,
    state,
    emit: (): undefined => undefined,
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  };

  const ctx = withDeps(kernel as unknown as Parameters<typeof withDeps>[0]);

  return {
    ctx,
    state,
    api: createTextApi(kernel as unknown as Parameters<typeof createTextApi>[0]),
    log,
    world,
    i18n,
    assets,
    renderer,
    wake,
    hooks: createHandlers(kernel as unknown as Parameters<typeof createHandlers>[0]),
    start: (): void => startText(kernel as unknown as Parameters<typeof startText>[0]),
    stop: (): void => stopText(state),
    step: (): void => {
      for (const definition of world.systems) {
        definition.run(
          world.api.ecs.query(...definition.query) as Iterable<readonly unknown[]>,
          undefined as unknown as Parameters<AnySystem["run"]>[1]
        );
      }
    }
  };
}
