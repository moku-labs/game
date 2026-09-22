/* eslint-disable unicorn/prefer-dom-node-remove, unicorn/prefer-dom-node-append -- this fake is the definition of appendChild and removeChild */
/**
 * @file renderer plugin — the fake DOM the unit and integration tests run on. Not a test file:
 * the projects only collect `*.test.ts`. Plain Bun has no document, so the tests install this one
 * on `globalThis` and take it down again.
 */
import { vi } from "vitest";

/** One fake element: enough of the DOM for a mount, a canvas, a probe and an alert div. */
export type FakeElement = {
  tagName: string;
  children: FakeElement[];
  parentNode: FakeElement | undefined;
  style: Record<string, string>;
  attributes: Record<string, string>;
  textContent: string;
  clientWidth: number;
  clientHeight: number;
  width: number;
  height: number;
  rect: { left: number; top: number; width: number; height: number };
  listeners: Map<string, Set<(event: unknown) => void>>;
  appendChild(child: FakeElement): FakeElement;
  append(...children: FakeElement[]): void;
  removeChild(child: FakeElement): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  dispatch(type: string, event?: unknown): void;
};

/** The fake document plus the handles a test drives it with. */
export type FakeDom = {
  document: FakeElement & {
    hidden: boolean;
    body: FakeElement;
    createElement(tag: string): FakeElement;
    querySelector(selector: string): FakeElement | undefined;
  };
  mount: FakeElement;
  /** Every live resize observer, so a test can fire one. */
  observers: Array<{ target: FakeElement | undefined; fire(): void; disconnected: boolean }>;
  /** CSS padding the safe-area probe reports, in pixels. */
  insets: { top: number; right: number; bottom: number; left: number };
  /** Number of listeners still attached to the document. */
  documentListeners(): number;
};

/**
 * Creates one fake element.
 *
 * @param tagName - The tag, lower case.
 * @returns The element.
 */
export function createFakeElement(tagName: string): FakeElement {
  const element: FakeElement = {
    tagName,
    children: [],
    parentNode: undefined,
    style: {},
    attributes: {},
    textContent: "",
    clientWidth: 0,
    clientHeight: 0,
    width: 0,
    height: 0,
    rect: { left: 0, top: 0, width: 0, height: 0 },
    listeners: new Map(),
    appendChild: child => {
      element.children.push(child);
      child.parentNode = element;

      return child;
    },
    append: (...children) => {
      for (const child of children) element.appendChild(child);
    },
    removeChild: child => {
      const at = element.children.indexOf(child);

      if (at !== -1) element.children.splice(at, 1);
      child.parentNode = undefined;
    },
    remove: () => {
      element.parentNode?.removeChild(element);
    },
    setAttribute: (name, value) => {
      element.attributes[name] = value;
    },
    getBoundingClientRect: () => ({ ...element.rect }),
    addEventListener: (type, listener) => {
      const set = element.listeners.get(type) ?? new Set<(event: unknown) => void>();

      set.add(listener);
      element.listeners.set(type, set);
    },
    removeEventListener: (type, listener) => {
      element.listeners.get(type)?.delete(listener);
    },
    dispatch: (type, event) => {
      for (const listener of element.listeners.get(type) ?? []) {
        listener(event ?? { preventDefault: () => undefined });
      }
    }
  };

  return element;
}

/**
 * Installs a fake document, a fake `ResizeObserver`, `getComputedStyle`, `devicePixelRatio` and
 * the window size on `globalThis`. `vi.unstubAllGlobals()` takes them down again.
 *
 * @param options - Size of the mount and of the window.
 * @param options.width - CSS width of the mount element.
 * @param options.height - CSS height of the mount element.
 * @param options.dpr - What `devicePixelRatio` answers.
 * @returns The document, the mount and the handles a test drives.
 */
export function installFakeDom(
  options: { width?: number; height?: number; dpr?: number } = {}
): FakeDom {
  const width = options.width ?? 1080;
  const height = options.height ?? 1920;
  const body = createFakeElement("body");
  const mount = createFakeElement("div");
  const observers: FakeDom["observers"] = [];
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };

  mount.clientWidth = width;
  mount.clientHeight = height;
  mount.rect = { left: 0, top: 0, width, height };
  body.append(mount);

  const base = createFakeElement("#document");
  const document = Object.assign(base, {
    hidden: false,
    body,
    createElement: (tag: string): FakeElement => createFakeElement(tag),
    querySelector: (selector: string): FakeElement | undefined =>
      selector === "#game" ? mount : undefined
  });

  class FakeResizeObserver {
    private readonly callback: () => void;
    public target: FakeElement | undefined = undefined;
    public disconnected = false;

    public constructor(callback: () => void) {
      this.callback = callback;
      observers.push(this);
    }

    public observe(target: FakeElement): void {
      this.target = target;
    }

    public disconnect(): void {
      this.disconnected = true;
    }

    public fire(): void {
      this.callback();
    }
  }

  vi.stubGlobal("document", document);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("devicePixelRatio", options.dpr ?? 1);
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
  vi.stubGlobal("getComputedStyle", () => ({
    paddingTop: `${insets.top}px`,
    paddingRight: `${insets.right}px`,
    paddingBottom: `${insets.bottom}px`,
    paddingLeft: `${insets.left}px`
  }));

  return {
    document,
    mount,
    observers,
    insets,
    documentListeners: () => {
      let total = 0;

      for (const set of document.listeners.values()) total += set.size;

      return total;
    }
  };
}
