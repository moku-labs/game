/**
 * @file audio plugin — the fake WebAudio context and the fake `window` of the tests. Not a test
 * file: the unit project only collects `*.test.ts`. Everything the plugin schedules is recorded
 * here as plain data, so no test needs a sound card, a browser or a timer.
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

/** A recorded buffer source. `startedAt` and `stoppedAt` are the arguments the plugin passed. */
export type FakeSource = {
  buffer: AudioBuffer | undefined;
  loop: boolean;
  connectedTo: unknown;
  startedAt: number | undefined;
  stoppedAt: number | undefined;
  connect(target: unknown): void;
  start(when?: number): void;
  stop(when?: number): void;
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
  resume(): Promise<void>;
  close(): Promise<void>;
  /** Every gain the plugin made, in creation order: master, music, sfx, then one per track. */
  gains: FakeGain[];
  /** Every source the plugin made, in creation order. */
  sources: FakeSource[];
  /** The text of every buffer that reached `decodeAudioData`. */
  decodes: string[];
  resumes: number;
  closes: number;
  /** Set by a test: `resume()` rejects instead of resolving. */
  resumeFails: boolean;
  /** Set by a test: the state `resume()` leaves the context in. */
  resumeState: AudioContext["state"] | "interrupted";
};

/** A `window` a test can dispatch on, without a DOM. */
export type FakeWindow = {
  listeners: Array<{ type: string; handler: (event: unknown) => void; once: boolean }>;
  addEventListener(type: string, handler: (event: unknown) => void, options?: unknown): void;
  removeEventListener(type: string, handler: (event: unknown) => void): void;
  dispatch(type: string): void;
};

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
    connect: (target: unknown): void => {
      source.connectedTo = target;
    },
    start: (when?: number): void => {
      source.startedAt = when ?? 0;
    },
    stop: (when?: number): void => {
      source.stoppedAt = when ?? 0;
    }
  };

  return source;
}

/**
 * Creates the fake context: three counters, two lists and a `decodeAudioData` that answers with
 * the text of the bytes it got. Bytes whose text is `"bad"` reject, which is how a test plays an
 * undecodable file.
 */
export function createFakeContext(): FakeContext {
  const gains: FakeGain[] = [];
  const sources: FakeSource[] = [];
  const decodes: string[] = [];

  const context: FakeContext = {
    destination: { id: "destination" } as unknown as AudioDestinationNode,
    currentTime: 0,
    state: "suspended",
    gains,
    sources,
    decodes,
    resumes: 0,
    closes: 0,
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
    resume: (): Promise<void> => {
      context.resumes += 1;

      if (context.resumeFails) return Promise.reject(new Error("blocked"));

      context.state = context.resumeState;

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
