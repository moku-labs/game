/**
 * @file audio plugin — the fake WebAudio context and the fake `window` of the tests. Not a test
 * file: the unit project only collects `*.test.ts`. Everything the plugin schedules is recorded
 * here as plain data, so no test needs a sound card, a browser or a timer.
 *
 * The autoplay policy follows what Chrome 148 does to a page script. A page that got no gesture
 * creates the context `"suspended"` and its `resume()` stays pending: it does not reject, and it
 * settles once a `resume()` called after a gesture went through. A shell that asks for no gesture
 * creates the context `"running"`, and `resume()` fulfils.
 */
import { vi } from "vitest";
import type { AudioContextLike } from "../types";

/** One scheduled value of a gain: the value and the moment on the context clock. */
export type Ramp = [number, number];

/** A recorded `AudioParam`: the current value and every schedule call in order. */
export type FakeParam = {
  value: number;
  sets: Ramp[];
  ramps: Ramp[];
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
};

/** A recorded gain node. It is handed to the plugin as a `GainNode`, so the plugin writes here. */
export type FakeGain = {
  gain: FakeParam;
  connectedTo: unknown;
  disconnects: number;
  connect(target: unknown): void;
  disconnect(): void;
};

/**
 * A recorded buffer source. `startedAt` and `stoppedAt` are the arguments the plugin passed.
 * `ended` holds the `"ended"` listeners the plugin added; `end()` is the source reaching its end,
 * which a test calls because the fake clock never runs: every listener is called once and removed,
 * as `{ once: true }` asks.
 */
export type FakeSource = {
  buffer: AudioBuffer | undefined;
  loop: boolean;
  connectedTo: unknown;
  startedAt: number | undefined;
  stoppedAt: number | undefined;
  ended: Array<() => void>;
  connect(target: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
  addEventListener(type: string, listener: () => void, options?: unknown): void;
  end(): void;
};

/** A recorded media element source: the element it reads and where its output goes. */
export type FakeMediaSource = {
  element: unknown;
  connectedTo: unknown;
  disconnects: number;
  connect(target: unknown): void;
  disconnect(): void;
};

/** The decoded buffer of the fake: the text of the bytes it was decoded from. */
export type FakeBuffer = { key: string };

/** The fake context, plus the recordings and the switches a test steers it with. */
export type FakeContext = {
  destination: AudioDestinationNode;
  currentTime: number;
  state: AudioContext["state"] | "interrupted";
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  createMediaElementSource(element: HTMLMediaElement): MediaElementAudioSourceNode;
  resume(): Promise<void>;
  close(): Promise<void>;
  /** Every gain the plugin made, in creation order: master, music, sfx, then one per track. */
  gains: FakeGain[];
  /** Every source the plugin made, in creation order. */
  sources: FakeSource[];
  /** Every media element source the plugin made, in creation order. */
  mediaSources: FakeMediaSource[];
  /** The text of every buffer that reached `decodeAudioData`. */
  decodes: string[];
  resumes: number;
  closes: number;
  /** Set by a test: the shell asks for no gesture, so `resume()` settles without one. */
  autoplay: boolean;
  /** Set by a test: a `resume()` the page may call rejects instead of resolving. */
  resumeFails: boolean;
  /** Set by a test: the state a `resume()` the page may call leaves the context in. */
  resumeState: AudioContext["state"] | "interrupted";
};

/** How a test wants the context to be born. Nothing set: `"suspended"`, and a gesture is needed. */
export type FakeShell = {
  /** The state at creation. Chrome without the gesture requirement creates it `"running"`. */
  state?: FakeContext["state"];
  /** The start value of `autoplay`: `resume()` settles without a gesture. */
  autoplay?: boolean;
};

/** A `window` a test can dispatch on, without a DOM. */
export type FakeWindow = {
  /** The page got a gesture. Sticky, like the user activation of a browser. */
  activated: boolean;
  listeners: Array<{ type: string; handler: (event: unknown) => void; once: boolean }>;
  addEventListener(type: string, handler: (event: unknown) => void, options?: unknown): void;
  removeEventListener(type: string, handler: (event: unknown) => void): void;
  dispatch(type: string): void;
};

/** The events a browser counts as a user gesture. Dispatching one activates the fake page. */
const GESTURES: ReadonlySet<string> = new Set([
  "keydown",
  "mousedown",
  "pointerdown",
  "pointerup",
  "touchend"
]);

/**
 * Tells whether the page of the test got a gesture: the fake `window` is the global one and a
 * gesture was dispatched on it. A test without a window never activates, so its context stays
 * locked unless it sets `autoplay`.
 */
function pageActivated(): boolean {
  const page = globalThis.window as Partial<FakeWindow> | undefined;

  return page?.activated === true;
}

/** The bytes of the `.mp3` an asset key stands for in the tests. */
export function bytesOf(key: string): ArrayBuffer {
  return new TextEncoder().encode(key).buffer as ArrayBuffer;
}

/** The key a decoded fake buffer came from. */
export function keyOf(buffer: AudioBuffer | undefined): string | undefined {
  return buffer === undefined ? undefined : (buffer as unknown as FakeBuffer).key;
}

/** Creates one recorded gain node. The plugin holds this very object as a `GainNode`. */
function createFakeGain(): FakeGain {
  const param: FakeParam = {
    value: 1,
    sets: [],
    ramps: [],
    setValueAtTime: (value: number, time: number): void => {
      param.sets.push([value, time]);
      param.value = value;
    },
    linearRampToValueAtTime: (value: number, time: number): void => {
      param.ramps.push([value, time]);
    }
  };

  const gain: FakeGain = {
    gain: param,
    connectedTo: undefined,
    disconnects: 0,
    connect: (target: unknown): void => {
      gain.connectedTo = target;
    },
    disconnect: (): void => {
      gain.disconnects += 1;
    }
  };

  return gain;
}

/** Creates one recorded buffer source. */
function createFakeSource(): FakeSource {
  const source: FakeSource = {
    buffer: undefined,
    loop: false,
    connectedTo: undefined,
    startedAt: undefined,
    stoppedAt: undefined,
    ended: [],
    connect: (target: unknown): void => {
      source.connectedTo = target;
    },
    start: (when?: number): void => {
      source.startedAt = when ?? 0;
    },
    stop: (when?: number): void => {
      source.stoppedAt = when ?? 0;
    },
    addEventListener: (type: string, listener: () => void): void => {
      if (type === "ended") source.ended.push(listener);
    },
    end: (): void => {
      for (const listener of source.ended.splice(0)) listener();
    }
  };

  return source;
}

/** Creates one recorded media element source over the element the plugin handed in. */
function createFakeMediaSource(element: unknown): FakeMediaSource {
  const source: FakeMediaSource = {
    element,
    connectedTo: undefined,
    disconnects: 0,
    connect: (target: unknown): void => {
      source.connectedTo = target;
    },
    disconnect: (): void => {
      source.disconnects += 1;
    }
  };

  return source;
}

/**
 * Creates the fake context: three counters, two lists and a `decodeAudioData` that answers with
 * the text of the bytes it got. Bytes whose text is `"bad"` reject, which is how a test plays an
 * undecodable file.
 *
 * `resume()` without a gesture on the page and without `autoplay` returns a pending promise and
 * leaves the state alone. Every later `resume()` the page may call that reaches `"running"`
 * settles the pending ones first, in the order they were made, the way a browser does.
 */
export function createFakeContext(shell: FakeShell = {}): FakeContext {
  const gains: FakeGain[] = [];
  const sources: FakeSource[] = [];
  const decodes: string[] = [];
  const mediaSources: FakeMediaSource[] = [];
  const waiting: Array<() => void> = [];

  const context: FakeContext = {
    destination: { id: "destination" } as unknown as AudioDestinationNode,
    currentTime: 0,
    state: shell.state ?? "suspended",
    gains,
    sources,
    mediaSources,
    decodes,
    resumes: 0,
    closes: 0,
    autoplay: shell.autoplay ?? false,
    resumeFails: false,
    resumeState: "running",
    createGain: (): GainNode => {
      const gain = createFakeGain();

      gains.push(gain);

      return gain as unknown as GainNode;
    },
    createBufferSource: (): AudioBufferSourceNode => {
      const source = createFakeSource();

      sources.push(source);

      return source as unknown as AudioBufferSourceNode;
    },
    decodeAudioData: (data: ArrayBuffer): Promise<AudioBuffer> => {
      const text = new TextDecoder().decode(data);

      decodes.push(text);

      if (text.includes("bad")) return Promise.reject(new Error("cannot decode"));

      return Promise.resolve({ key: text } as unknown as AudioBuffer);
    },
    createMediaElementSource: (element: HTMLMediaElement): MediaElementAudioSourceNode => {
      const source = createFakeMediaSource(element);

      mediaSources.push(source);

      return source as unknown as MediaElementAudioSourceNode;
    },
    resume: (): Promise<void> => {
      context.resumes += 1;

      if (!context.autoplay && !pageActivated()) {
        return new Promise<void>(resolve => {
          waiting.push(resolve);
        });
      }

      if (context.resumeFails) return Promise.reject(new Error("blocked"));

      context.state = context.resumeState;

      if (context.state === "running") for (const settle of waiting.splice(0)) settle();

      return Promise.resolve();
    },
    close: (): Promise<void> => {
      context.closes += 1;
      context.state = "closed";

      return Promise.resolve();
    }
  };

  return context;
}

/** The fake context as the config seam sees it. */
export function contextSeam(context: FakeContext): () => AudioContextLike {
  return () => context;
}

/** Creates the fake `window` and installs it as the global one. */
export function installFakeWindow(): FakeWindow {
  const listeners: FakeWindow["listeners"] = [];

  const fake: FakeWindow = {
    activated: false,
    listeners,
    addEventListener: (
      type: string,
      handler: (event: unknown) => void,
      options?: unknown
    ): void => {
      const once =
        typeof options === "object" && options !== null && "once" in options
          ? options.once === true
          : false;

      listeners.push({ type, handler, once });
    },
    removeEventListener: (type: string, handler: (event: unknown) => void): void => {
      const at = listeners.findIndex(entry => entry.type === type && entry.handler === handler);

      if (at !== -1) listeners.splice(at, 1);
    },
    dispatch: (type: string): void => {
      // A browser activates the page before the handlers of the gesture run.
      if (GESTURES.has(type)) fake.activated = true;

      // A copy: a handler that removes a listener must not make the loop skip the next one.
      for (const entry of listeners.filter(candidate => candidate.type === type)) {
        if (entry.once) fake.removeEventListener(entry.type, entry.handler);

        entry.handler({ type });
      }
    }
  };

  vi.stubGlobal("window", fake);

  return fake;
}
