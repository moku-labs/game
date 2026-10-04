/**
 * @file audio plugin — the fake `Audio` element, the fake `URL` object store and the fake
 * `navigator` of the tests. Not a test file: the unit project only collects `*.test.ts`. A test
 * installs what it needs and restores it in `afterEach` with `vi.unstubAllGlobals()` and
 * `vi.restoreAllMocks()`.
 */
import { vi } from "vitest";

/** A recorded `<audio>` element. The plugin holds this very object as an `HTMLAudioElement`. */
export type FakeAudioElement = {
  src: string;
  loop: boolean;
  preload: string;
  /** How many times `play()` was called. */
  plays: number;
  pauses: number;
  loads: number;
  /** `removeAttribute("src")` ran. */
  srcRemoved: boolean;
  /** Set by a test: the next `play()` rejects, the way an autoplay policy refuses it. */
  playFails: boolean;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
};

/** The installed `Audio` constructor: every element it made, and the switch new elements copy. */
export type FakeAudio = {
  elements: FakeAudioElement[];
  /** Set by a test: every element made from now on refuses to play. */
  playFails: boolean;
};

/** One `URL.createObjectURL` call: the URL it answered and the Blob it got. */
export type CreatedUrl = { url: string; type: string; size: number };

/** The spied object store: every URL made and every URL revoked, in order. */
export type FakeUrls = { created: CreatedUrl[]; revoked: string[] };

/** The `audioSession` a test installs: every value written to `type`, in order. */
export type FakeSession = { writes: string[] };

/** Creates one recorded element. `play()` settles on a microtask, as a browser's does. */
function createFakeElement(playFails: boolean): FakeAudioElement {
  const element: FakeAudioElement = {
    src: "",
    loop: false,
    preload: "",
    plays: 0,
    pauses: 0,
    loads: 0,
    srcRemoved: false,
    playFails,
    play: (): Promise<void> => {
      element.plays += 1;

      return element.playFails ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve();
    },
    pause: (): void => {
      element.pauses += 1;
    },
    load: (): void => {
      element.loads += 1;
    },
    removeAttribute: (name: string): void => {
      if (name === "src") element.srcRemoved = true;
    }
  };

  return element;
}

/** Installs a global `Audio` constructor that records every element it makes. */
export function installFakeAudio(): FakeAudio {
  const fake: FakeAudio = { elements: [], playFails: false };

  vi.stubGlobal("Audio", function FakeAudioConstructor(): FakeAudioElement {
    const element = createFakeElement(fake.playFails);

    fake.elements.push(element);

    return element;
  });

  return fake;
}

/** Spies the object store: `createObjectURL` answers `blob:test/1`, `blob:test/2`, and so on. */
export function installFakeUrl(): FakeUrls {
  const fake: FakeUrls = { created: [], revoked: [] };

  vi.spyOn(URL, "createObjectURL").mockImplementation((object: Blob | MediaSource): string => {
    const url = `blob:test/${fake.created.length + 1}`;
    const blob = object instanceof Blob ? object : new Blob();

    fake.created.push({ url, type: blob.type, size: blob.size });

    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string): void => {
    fake.revoked.push(url);
  });

  return fake;
}

/**
 * Installs a global `navigator`. Without `session` it has no `audioSession`, as in Chromium and
 * Firefox. With it, every write of `type` is recorded (and pushed to `order` when given); with
 * `refuse` the setter throws instead.
 */
export function installFakeNavigator(session?: {
  type: string;
  refuse?: boolean;
  order?: string[];
}): FakeSession {
  const fake: FakeSession = { writes: [] };

  if (session === undefined) {
    vi.stubGlobal("navigator", {});

    return fake;
  }

  let current = session.type;
  const audioSession = {
    get type(): string {
      return current;
    },
    set type(value: string) {
      if (session.refuse === true) throw new Error("NotAllowedError");

      fake.writes.push(value);
      session.order?.push(`session:${value}`);
      current = value;
    }
  };

  vi.stubGlobal("navigator", { audioSession });

  return fake;
}
