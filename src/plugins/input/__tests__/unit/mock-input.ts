/**
 * @file input plugin — shared mock kernel context for the unit tests. Not a test file: the unit
 * project only collects `*.test.ts`. The real input modules run over a fake `time`, `flow`,
 * `world` and `renderer`; frames are driven by calling the recorded phase callbacks.
 */
import type { Log } from "@moku-labs/common/browser";
import { type Mock, vi } from "vitest";
import type { Require } from "../../../../config";
import type { Answer, Api as FlowApi } from "../../../flow/types";
import type { Api as RendererApi } from "../../../renderer/types";
import type { FrameCallback, Phase, Time, Api as TimeApi } from "../../../time/types";
import type {
  AnyComponentType,
  AnyComponentValue,
  ComponentType,
  Entity,
  ResourceType,
  TagType,
  WorldMode
} from "../../../world/ecs/types";
import type { Api as WorldApi } from "../../../world/types";
import { initInput, startInput, withDeps } from "../../lifecycle";
import { createInputState } from "../../state";
import type { Config, InputCtx, KernelSlice, State } from "../../types";

/** One `time.onFrame` registration. */
export type FrameRegistration = { phase: Phase; callback: FrameCallback };

/** One rectangle the fake `hitTest` walks. The last box pushed is the topmost. */
export type StubBox = { entity: Entity; x: number; y: number; width: number; height: number };

/** A canvas stub: five listener slots, a style object and the two capture methods. */
export type StubCanvas = {
  element: HTMLCanvasElement;
  style: { touchAction: string; cursor: string };
  names(): string[];
  dispatch(
    name: string,
    event: { pointerType?: string; pointerId: number; clientX: number; clientY: number }
  ): void;
  captured: number[];
  released: number[];
  /** False makes `setPointerCapture` throw, the way a browser does for a pointer that is gone. */
  flags: { capturable: boolean };
};

/** The mock input plugin: the context, the fakes behind it and a frame driver. */
export type MockInput = {
  ctx: KernelSlice;
  input: InputCtx;
  state: State;
  config: Config;
  log: Log.LogApi;
  frames: FrameRegistration[];
  time: Time;
  /** The `time.wake` spy: `record` calls it for every pointer sample. */
  wake: Mock<() => void>;
  /** Every call the plugin made into `world.projection`, `world.ecs` and `flow.gate`, in order. */
  calls: string[];
  /** The fields of every `world.projection.mute` call, in order. */
  muted: Array<readonly string[]>;
  answers: Answer[];
  /** What `flow.gate.answer` returns. */
  gate: { open: boolean };
  /** The effective world mode `ecs.mode()` reports. */
  world: { mode: WorldMode };
  boxes: StubBox[];
  canvas: { current: HTMLCanvasElement | undefined };
  spawn(values: readonly AnyComponentValue[], key?: { projection: string; key: string }): Entity;
  /** Gives an existing entity one more component, the way a commit or a reconcile would. */
  attachTo(entity: Entity, value: AnyComponentValue): void;
  /** Records what `world.projection.restOf` answers for one component of an entity. */
  setRest(entity: Entity, value: AnyComponentValue): void;
  kill(entity: Entity): void;
  read(entity: Entity, component: AnyComponentType): object | true | undefined;
  has(entity: Entity, component: AnyComponentType): boolean;
  /** Runs one frame: every recorded `input` callback. */
  frame(deltaMs?: number): void;
  /** Runs `onInit` and `onStart`, as the kernel does. */
  start(): void;
};

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
 * Creates a canvas stub that records its listeners, its captures and its touch-action.
 *
 * @returns The stub and the element to hand to `attach`.
 */
export function createStubCanvas(): StubCanvas {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const style = { touchAction: "auto", cursor: "" };
  const captured: number[] = [];
  const released: number[] = [];
  const flags = { capturable: true };
  const stub = {
    style,
    addEventListener: (name: string, fn: (event: unknown) => void): void => {
      const list = listeners.get(name) ?? [];

      list.push(fn);
      listeners.set(name, list);
    },
    removeEventListener: (name: string, fn: (event: unknown) => void): void => {
      const list = listeners.get(name) ?? [];
      const at = list.indexOf(fn);

      if (at !== -1) list.splice(at, 1);
      if (list.length === 0) listeners.delete(name);
      else listeners.set(name, list);
    },
    setPointerCapture: (pointerId: number): void => {
      if (!flags.capturable) throw new Error("no such pointer");
      captured.push(pointerId);
    },
    releasePointerCapture: (pointerId: number): void => {
      released.push(pointerId);
    }
  };

  return {
    element: stub as unknown as HTMLCanvasElement,
    style,
    captured,
    released,
    flags,
    names: () => [...listeners.keys()].toSorted(),
    dispatch: (name, event) => {
      for (const fn of listeners.get(name) ?? []) fn(event);
    }
  };
}

/**
 * Creates the mock input plugin.
 *
 * @param options - Config overrides of the plugin.
 * @returns The context, the fakes and the frame driver.
 */
export function createMockInput(options: Partial<Config> = {}): MockInput {
  const config: Config = {
    tapSlopPx: 12,
    longPressMs: 450,
    dragStartPx: 8,
    swipeMinPx: 48,
    swipeMaxMs: 300,
    heldScale: 1,
    cursor: { control: "pointer", idle: "" },
    ...options
  };
  const state = createInputState({ config });
  const log = createMockLog();
  const frames: FrameRegistration[] = [];
  const time: Time = { delta: 16, elapsed: 0, scale: 1, frame: 0, idle: false };
  const stores = new Map<Entity, Map<string, object | true>>();
  const resources = new Map<string, object>();
  const keys = new Map<Entity, { projection: string; key: string }>();
  const rests = new Map<Entity, Map<string, object>>();
  const calls: string[] = [];
  const muted: Array<readonly string[]> = [];
  const answers: Answer[] = [];
  const gate = { open: true };
  const world = { mode: "live" as WorldMode };
  const boxes: StubBox[] = [];
  const canvas: { current: HTMLCanvasElement | undefined } = { current: undefined };
  const wake: Mock<() => void> = vi.fn();
  let nextEntity = 1;

  const ecs = {
    get: (entity: Entity, component: ComponentType<object>): object | undefined => {
      const value = stores.get(entity)?.get(component.componentName);

      return value === true ? undefined : value;
    },
    set: (entity: Entity, component: ComponentType<object>, patch: object): void => {
      const store = stores.get(entity);
      const current = store?.get(component.componentName);

      if (store === undefined || current === undefined || current === true) {
        throw new Error("input test: the entity does not carry the component");
      }

      store.set(component.componentName, { ...current, ...patch });
      calls.push(`set:${component.componentName}`);
    },
    add: (entity: Entity, value: AnyComponentValue): void => {
      stores.get(entity)?.set(value.type.componentName, value.value);
      calls.push(`add:${value.type.componentName}`);
    },
    remove: (entity: Entity, component: AnyComponentType): void => {
      stores.get(entity)?.delete(component.componentName);
      calls.push(`remove:${component.componentName}`);
    },
    has: (entity: Entity, component: AnyComponentType): boolean =>
      stores.get(entity)?.has(component.componentName) ?? false,
    tag: (entity: Entity, tagType: TagType): void => {
      stores.get(entity)?.set(tagType.componentName, true);
      calls.push(`tag:${tagType.componentName}`);
    },
    untag: (entity: Entity, tagType: TagType): void => {
      stores.get(entity)?.delete(tagType.componentName);
      calls.push(`untag:${tagType.componentName}`);
    },
    resource: (resourceType: ResourceType<object>): object => {
      const existing = resources.get(resourceType.resourceName);

      if (existing !== undefined) return existing;

      const fresh = { ...resourceType.defaults };

      resources.set(resourceType.resourceName, fresh);

      return fresh;
    },
    mode: () => world.mode
  };

  const projection = {
    keyOf: (entity: Entity) => keys.get(entity),
    entityOf: (name: string, key: string): Entity | undefined => {
      for (const [entity, value] of keys) {
        if (value.projection === name && value.key === key) return entity;
      }

      return undefined;
    },
    mute: (
      _entity: Entity,
      _component: AnyComponentType,
      fields: readonly string[]
    ): (() => void) => {
      calls.push("mute");
      muted.push(fields);

      return () => calls.push("unmute");
    },
    lift: (_entity: Entity, on: boolean): void => {
      calls.push(`lift:${String(on)}`);
    },
    settle: (): void => {
      calls.push("settle");
    },
    restOf: (entity: Entity, component: AnyComponentType): object | undefined =>
      rests.get(entity)?.get(component.componentName)
  };

  const worldApi = { ecs, projection } as unknown as WorldApi;

  const rendererApi = {
    host: { canvas: () => canvas.current },
    viewport: { toReference: (x: number, y: number) => ({ x, y }) },
    sync: {
      hitTest: (x: number, y: number, accept: (entity: Entity) => boolean): Entity | undefined => {
        for (let index = boxes.length - 1; index >= 0; index -= 1) {
          const box = boxes[index];

          if (box === undefined) continue;
          if (x < box.x || x > box.x + box.width) continue;
          if (y < box.y || y > box.y + box.height) continue;
          if (accept(box.entity)) return box.entity;
        }

        return undefined;
      }
    }
  } as unknown as RendererApi;

  const flowApi = {
    gate: {
      answer: (answer: Answer): boolean => {
        answers.push(answer);
        calls.push("answer");

        return gate.open;
      },
      pointer: (active: boolean): void => {
        calls.push(`pointer:${String(active)}`);
      }
    }
  } as unknown as FlowApi;

  const timeApi = {
    onFrame: (phase: Phase, callback: FrameCallback): (() => void) => {
      const registration = { phase, callback };

      frames.push(registration);

      return () => {
        const at = frames.indexOf(registration);

        if (at !== -1) frames.splice(at, 1);
      };
    },
    snapshot: () => ({ ...time }),
    setScale: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: () => false,
    isRunning: () => false,
    step: vi.fn(),
    wake
  } as unknown as TimeApi;

  const apis: Record<string, unknown> = {
    time: timeApi,
    flow: flowApi,
    world: worldApi,
    renderer: rendererApi
  };

  const ctx: KernelSlice = {
    config,
    state,
    emit: () => undefined,
    global: {},
    log,
    require: ((plugin: { name: string }): unknown => apis[plugin.name]) as unknown as Require
  };

  return {
    ctx,
    input: withDeps(ctx),
    state,
    config,
    log,
    frames,
    time,
    wake,
    calls,
    muted,
    answers,
    gate,
    world,
    boxes,
    canvas,
    spawn: (values, key) => {
      const entity = nextEntity;
      const store = new Map<string, object | true>();

      nextEntity += 1;
      for (const value of values) {
        store.set(value.type.componentName, value.value);
      }
      stores.set(entity, store);
      if (key !== undefined) keys.set(entity, key);

      return entity;
    },
    attachTo: (entity, value) => {
      stores.get(entity)?.set(value.type.componentName, value.value);
    },
    setRest: (entity, value) => {
      const table = rests.get(entity) ?? new Map<string, object>();

      table.set(value.type.componentName, value.value as object);
      rests.set(entity, table);
    },
    kill: entity => {
      stores.delete(entity);
      keys.delete(entity);

      const at = boxes.findIndex(box => box.entity === entity);

      if (at !== -1) boxes.splice(at, 1);
    },
    read: (entity, component) => stores.get(entity)?.get(component.componentName),
    has: (entity, component) => stores.get(entity)?.has(component.componentName) ?? false,
    frame: (deltaMs = 16) => {
      time.frame += 1;
      time.delta = deltaMs;
      time.elapsed += deltaMs;

      // eslint-disable-next-line unicorn/no-useless-spread -- a stop inside a frame splices the list
      for (const registration of [...frames]) {
        if (registration.phase === "input") registration.callback({ ...time });
      }
    },
    start: () => {
      initInput(ctx);
      startInput(ctx);
    }
  };
}
