/**
 * @file assets plugin — shared fakes for the unit tests. Not a test file: the unit project only
 * collects `*.test.ts`. The real plugin files run over a fake `flow`, a fake `renderer` and a fake
 * `AssetsIo`, so nothing touches the network, a GPU or Pixi.
 */
import type { Log } from "@moku-labs/common/browser";
import { type Mock, vi } from "vitest";
import type { Require } from "../../../../config";
import type { FeatureDescription } from "../../../flow/features/types";
import type { Frame } from "../../../flow/runner/types";
import type {
  EnterCallback,
  Api as FlowApi,
  FlowGraph,
  FlowState,
  FxHandler,
  Stage
} from "../../../flow/types";
import type { Api as RendererApi, TextureProvider } from "../../../renderer/types";
import type { Api as TimeApi } from "../../../time/types";
import { createAssetsApi } from "../../api";
import { connectAssets, startAssets, withDeps } from "../../lifecycle";
import { createAssetsState } from "../../state";
import type {
  Api,
  AssetsCtx,
  AssetsIo,
  Config,
  CreateTextureOptions,
  DecodedImage,
  FetchResponse,
  KernelSlice,
  Manifest,
  Texture
} from "../../types";

/** A texture the fake io handed out. `from` is the URL its bytes came from. */
export type FakeTexture = { id: string; from: string; nine: CreateTextureOptions["nine"] };

/** One fetch the fake io is holding back. */
export type Held = { url: string; resolve: () => void; reject: (error: unknown) => void };

/** The fake I/O seam: a scripted network and a texture factory that counts. */
export type FakeIo = AssetsIo & {
  created: FakeTexture[];
  destroyed: FakeTexture[];
  fetched: string[];
  /** URL to the status the fake answers with. Missing means `200`. */
  status: Map<string, number>;
  /** URL to the text a `.fnt` fetch answers with. Missing means the URL itself. */
  texts: Map<string, string>;
  /** URL to the bytes an `.mp3` fetch answers with. Missing means the URL as UTF-8. */
  bodies: Map<string, ArrayBuffer>;
  /** While `gated` is true every fetch waits for `release`. */
  control: { gated: boolean };
  held: Held[];
  release(match: (url: string) => boolean): void;
  releaseAll(): void;
};

/**
 * Builds the abort error a cancelled fetch rejects with.
 *
 * @returns An error whose `name` is `"AbortError"`.
 */
function abortError(): Error {
  const error = new Error("aborted");

  error.name = "AbortError";

  return error;
}

/**
 * Creates the fake I/O seam.
 *
 * @param manifest - What a fetch of the manifest URL answers with.
 * @returns The fake io plus its recordings.
 */
export function createFakeIo(manifest?: unknown): FakeIo {
  const created: FakeTexture[] = [];
  const destroyed: FakeTexture[] = [];
  const fetched: string[] = [];
  const status = new Map<string, number>();
  const texts = new Map<string, string>();
  const bodies = new Map<string, ArrayBuffer>();
  const control = { gated: false };
  const held: Held[] = [];

  const io: FakeIo = {
    created,
    destroyed,
    fetched,
    status,
    texts,
    bodies,
    control,
    held,
    release: (match: (url: string) => boolean): void => {
      const pending = held.filter(entry => match(entry.url));

      for (const entry of pending) {
        const at = held.indexOf(entry);

        if (at !== -1) held.splice(at, 1);
        entry.resolve();
      }
    },
    releaseAll: (): void => {
      const pending = held.splice(0);

      for (const entry of pending) entry.resolve();
    },
    fetch: async (url: string, init: { signal: AbortSignal }): Promise<FetchResponse> => {
      fetched.push(url);

      if (control.gated) {
        await new Promise<void>((resolve, reject) => {
          held.push({ url, resolve, reject });
          init.signal.addEventListener("abort", () => reject(abortError()), { once: true });
        });
      }

      if (init.signal.aborted) throw abortError();

      const code = status.get(url) ?? 200;

      return {
        ok: code < 400,
        status: code,
        json: async () => manifest,
        blob: async () => new Blob([url]),
        text: async () => texts.get(url) ?? url,
        arrayBuffer: async () => bodies.get(url) ?? new TextEncoder().encode(url).buffer
      };
    },
    decode: async (blob: Blob): Promise<DecodedImage> =>
      ({ url: await blob.text() }) as unknown as DecodedImage,
    createTexture: (image: DecodedImage, options?: CreateTextureOptions): Texture => {
      const texture: FakeTexture = {
        id: `t${created.length + 1}`,
        from: (image as unknown as { url?: string }).url ?? "",
        nine: options?.nine
      };

      created.push(texture);

      return texture as unknown as Texture;
    },
    destroyTexture: (texture: Texture): void => {
      destroyed.push(texture as unknown as FakeTexture);
    }
  };

  return io;
}

/** What the fake `renderer` recorded. */
export type FakeRenderer = {
  ready: boolean;
  invalidated: string[][];
  providers: TextureProvider[];
  api: RendererApi;
};

/** The fake `time`: the one member `assets` calls when a load settles. */
export type FakeTime = { wake: Mock<() => void>; api: TimeApi };

/** What the fake `flow` recorded and what it answers with. */
export type FakeFlow = {
  graph: FlowGraph;
  stack: Frame[];
  mode: "live" | "fast";
  path: string;
  features: Array<{ name: string; description: FeatureDescription }>;
  enter: Array<{ stage: Stage; callback: EnterCallback }>;
  handlers: Map<string, { run: FxHandler; runInFast: boolean }>;
  api: FlowApi;
};

/** Everything a unit test drives the plugin with. */
export type MockAssets = {
  ctx: KernelSlice;
  assetsCtx: AssetsCtx;
  /** The same object `ctx.config` points at, writable: a test moves the budget or the depth. */
  config: Config;
  api: Api;
  io: FakeIo;
  log: Log.LogApi;
  emitted: Array<{ name: string; payload: unknown }>;
  flow: FakeFlow;
  renderer: FakeRenderer;
  time: FakeTime;
  connect(): void;
  start(): Promise<void>;
};

/**
 * Creates the fake `time`: `wake` is a spy, so a test sees that a settled load woke the loop.
 *
 * @returns The fake time and its spy.
 */
function createFakeTime(): FakeTime {
  const wake: Mock<() => void> = vi.fn();

  return { wake, api: { wake } as unknown as TimeApi };
}

/**
 * Creates the engine log as spies.
 *
 * @returns A log whose every method is a spy.
 */
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

/**
 * Creates the fake `renderer`: no Pixi, only the four texture members and `host.ready()`.
 *
 * @param io - The fake io whose texture factory the renderer hands out.
 * @returns The fake renderer and its recordings.
 */
function createFakeRenderer(io: FakeIo): FakeRenderer {
  const fake: FakeRenderer = {
    ready: false,
    invalidated: [],
    providers: [],
    api: undefined as unknown as RendererApi
  };

  fake.api = {
    host: { ready: () => fake.ready, kind: () => "none", canvas: () => undefined },
    sync: {
      hitTest: () => undefined,
      displayOf: () => undefined,
      textures: {
        provide: (fn: TextureProvider): (() => void) => {
          fake.providers.push(fn);

          return () => {
            const at = fake.providers.indexOf(fn);

            if (at !== -1) fake.providers.splice(at, 1);
          };
        },
        create: io.createTexture,
        destroy: io.destroyTexture,
        invalidate: (keys: readonly string[]): void => {
          fake.invalidated.push([...keys]);
        }
      }
    }
  } as unknown as RendererApi;

  return fake;
}

/**
 * Creates the fake `flow`: the five members `assets` calls, each backed by a field a test writes.
 *
 * @returns The fake flow and its recordings.
 */
function createFakeFlow(): FakeFlow {
  const fake: FakeFlow = {
    graph: { main: "main", flows: {}, slots: {} },
    stack: [],
    mode: "live",
    path: "",
    features: [],
    enter: [],
    handlers: new Map(),
    api: undefined as unknown as FlowApi
  };

  fake.api = {
    describe: () => fake.graph,
    state: (): FlowState => ({
      running: true,
      path: fake.path,
      stack: fake.stack,
      pending: {},
      mode: fake.mode
    }),
    onEnter: (stage: Stage, callback: EnterCallback): (() => void) => {
      const registration = { stage, callback };

      fake.enter.push(registration);

      return () => {
        const at = fake.enter.indexOf(registration);

        if (at !== -1) fake.enter.splice(at, 1);
      };
    },
    features: { all: () => fake.features },
    fx: {
      handle: (kind: string, run: FxHandler, options?: { runInFast?: boolean }): (() => void) => {
        fake.handlers.set(kind, { run, runInFast: options?.runInFast === true });

        return (): void => {
          fake.handlers.delete(kind);
        };
      }
    }
  } as unknown as FlowApi;

  return fake;
}

/**
 * Creates the mock plugin: the real state, the real API and the real lifecycle over the fakes.
 *
 * @param options - Config overrides. `io` defaults to the fake io.
 * @param manifestResponse - What a fetch of a manifest URL answers with.
 * @returns The context, the API, the fakes and the two lifecycle steps.
 */
export function createMockAssets(
  options: Partial<Config> = {},
  manifestResponse?: unknown
): MockAssets {
  const io = createFakeIo(manifestResponse);
  const config: Config = {
    manifest: undefined,
    textureBudgetMb: 192,
    preloadDepth: 2,
    baseUrl: undefined,
    io,
    ...options
  };
  const state = createAssetsState();
  const log = createMockLog();
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const flow = createFakeFlow();
  const renderer = createFakeRenderer(io);
  const time = createFakeTime();
  const apis: Record<string, unknown> = {
    flow: flow.api,
    renderer: renderer.api,
    time: time.api
  };

  const ctx: KernelSlice = {
    config,
    state,
    emit: ((name: string, payload: unknown): void => {
      emitted.push({ name, payload });
    }) as unknown as KernelSlice["emit"],
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  };

  return {
    ctx,
    config,
    assetsCtx: withDeps(ctx),
    api: createAssetsApi(ctx),
    io,
    log,
    emitted,
    flow,
    renderer,
    time,
    connect: (): void => connectAssets(ctx),
    start: (): Promise<void> => startAssets(ctx)
  };
}

/**
 * Builds a manifest with one file per key, each 128×128 (0.063 MB).
 *
 * @param bundles - Bundle name to its feature, tier and asset keys.
 * @returns A manifest ready for the config.
 */
export function manifestOf(
  bundles: Record<string, { feature: string; tier: string; keys: readonly string[] }>
): Manifest {
  const entries = Object.entries(bundles).map(([name, spec]) => {
    const files = spec.keys.map(key => ({
      key,
      path: `features/${spec.feature}/assets/${key.split(".").slice(1).join("/")}.png`,
      width: 128,
      height: 128,
      mb: 0.063
    }));

    return [
      name,
      {
        feature: spec.feature,
        tier: spec.tier,
        mb: Number((files.length * 0.063).toFixed(3)),
        files
      }
    ];
  });

  return { version: 1, bundles: Object.fromEntries(entries) } as Manifest;
}
