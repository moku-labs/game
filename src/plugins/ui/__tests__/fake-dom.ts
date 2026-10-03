/**
 * @file ui plugin — a fake page for the text input tests: a document that makes `<input>`
 * elements, a window with a `visualViewport`, and a canvas whose `ownerDocument` is that document.
 * Not a test file. Only what `jsx/dom-input.ts` and the pointer listeners of `input` touch exists.
 */

/** What a listener of the fake page receives. */
export type FakeEvent = { data?: string; preventDefault?: () => void };

/** One listener of a fake target. */
type Listener = (event: FakeEvent) => void;

/** A target that records its listeners by event name. */
type Target = {
  addEventListener(name: string, fn: Listener): void;
  removeEventListener(name: string, fn: Listener): void;
};

/** The listeners of one fake target, and how to run them. */
type Listeners = {
  target: Target;
  names(): string[];
  dispatch(name: string, event?: FakeEvent): void;
};

/**
 * Creates the listener table of one fake target.
 *
 * @returns The two DOM methods, the names listened to and a dispatcher.
 */
function listenersOf(): Listeners {
  const table = new Map<string, Listener[]>();

  return {
    target: {
      addEventListener: (name, fn) => table.set(name, [...(table.get(name) ?? []), fn]),
      removeEventListener: (name, fn) => {
        const left = (table.get(name) ?? []).filter(entry => entry !== fn);

        if (left.length === 0) table.delete(name);
        else table.set(name, left);
      }
    },
    names: () => [...table.keys()].toSorted(),
    dispatch: (name, event = {}) => {
      for (const fn of table.get(name) ?? []) fn(event);
    }
  };
}

/** The fake `<input>`: the element the module sees, and what the test reads back. */
export type FakeInput = {
  element: HTMLInputElement;
  style: Record<string, string>;
  attributes: Map<string, string>;
  focusCalls: Array<FocusOptions | undefined>;
  blurCalls: () => number;
  removed: () => boolean;
  listeners: () => string[];
  dispatch(name: string, event?: FakeEvent): void;
  /** Types the way a keyboard does: a new value and selection, then an `input` event. */
  type(value: string, start?: number, end?: number, direction?: string): void;
};

/** The fake visual viewport: its size, its offset and its two events. */
export type FakeViewport = {
  viewport: { height: number; offsetTop: number } & Target;
  listeners: () => string[];
  /** Moves the keyboard: a new height, then the `resize` event. */
  resize(height: number): void;
};

/** The fake page. */
export type FakeDom = {
  document: Document;
  window: Window;
  inputs: FakeInput[];
  viewport: FakeViewport;
  active: () => unknown;
  body: () => unknown[];
};

/**
 * Creates the fake visual viewport of a phone: 714 CSS px tall with the keyboard down.
 *
 * @param height - The visible height.
 * @returns The viewport and its controls.
 */
function createViewport(height: number): FakeViewport {
  const events = listenersOf();
  const viewport = { height, offsetTop: 0, ...events.target };

  return {
    viewport,
    listeners: events.names,
    resize: next => {
      viewport.height = next;
      events.dispatch("resize");
    }
  };
}

/**
 * Creates the fake page: a document whose `createElement("input")` makes a fake input, a body
 * that keeps what is appended, and a window with a visual viewport.
 *
 * @param innerHeight - The window height in CSS px; the keyboard is down.
 * @returns The page.
 */
export function createFakeDom(innerHeight = 714): FakeDom {
  const inputs: FakeInput[] = [];
  const body: unknown[] = [];
  const viewport = createViewport(innerHeight);
  const window = { innerHeight, visualViewport: viewport.viewport };
  const page: { activeElement: unknown } = { activeElement: undefined };
  const document = {
    get activeElement(): unknown {
      return page.activeElement;
    },
    defaultView: window,
    body: {
      append: (child: unknown): void => {
        body.push(child);
      }
    },
    createElement: (): HTMLInputElement => {
      const input = createInput(document as unknown as Document, page, body);

      inputs.push(input);

      return input.element;
    }
  };

  return {
    document: document as unknown as Document,
    window: window as unknown as Window,
    inputs,
    viewport,
    active: () => page.activeElement,
    body: () => body
  };
}

/**
 * Creates one fake input of a fake document.
 *
 * @param ownerDocument - The document it belongs to.
 * @param page - Where the document keeps its focused element.
 * @param page.activeElement - The focused element.
 * @param body - The children of the body, so `remove()` takes it out.
 * @returns The input.
 */
function createInput(
  ownerDocument: Document,
  page: { activeElement: unknown },
  body: unknown[]
): FakeInput {
  const events = listenersOf();
  const attributes = new Map<string, string>();
  const style: Record<string, string> = {};
  const focusCalls: Array<FocusOptions | undefined> = [];
  const counts = { blur: 0, removed: false };
  const element = {
    style,
    value: "",
    selectionStart: 0 as number | null,
    selectionEnd: 0 as number | null,
    selectionDirection: "none" as string | null,
    ownerDocument,
    ...events.target,
    setAttribute: (name: string, value: string): void => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string): void => {
      attributes.delete(name);
    },
    setSelectionRange: (start: number, end: number): void => {
      element.selectionStart = start;
      element.selectionEnd = end;
    },
    focus: (options?: FocusOptions): void => {
      focusCalls.push(options);
      page.activeElement = element;
    },
    blur: (): void => {
      counts.blur += 1;

      if (page.activeElement !== element) return;

      page.activeElement = undefined;
      events.dispatch("blur");
    },
    remove: (): void => {
      counts.removed = true;

      const at = body.indexOf(element);

      if (at !== -1) body.splice(at, 1);
    }
  };

  return {
    element: element as unknown as HTMLInputElement,
    style,
    attributes,
    focusCalls,
    blurCalls: () => counts.blur,
    removed: () => counts.removed,
    listeners: events.names,
    dispatch: events.dispatch,
    type: (value, start = value.length, end = start, direction = "none") => {
      element.value = value;
      element.selectionStart = start;
      element.selectionEnd = end;
      element.selectionDirection = direction;
      events.dispatch("input");
    }
  };
}

/** A canvas of the fake page, with the pointer listeners `input` puts on it. */
export type FakeCanvas = {
  element: HTMLCanvasElement;
  /** Runs the listeners of one pointer event, the way the browser does. */
  pointer(name: string, clientX: number, clientY: number): void;
};

/**
 * Creates a canvas whose document is the fake page, so `ui` finds the page through it.
 *
 * @param dom - The fake page.
 * @returns The canvas and a pointer dispatcher.
 */
export function createFakeCanvas(dom: FakeDom): FakeCanvas {
  const events = listenersOf();
  const canvas = {
    ownerDocument: dom.document,
    style: { touchAction: "", cursor: "" },
    ...events.target,
    setPointerCapture: (): void => undefined,
    releasePointerCapture: (): void => undefined,
    hasPointerCapture: (): boolean => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1080, height: 1920 })
  };

  return {
    element: canvas as unknown as HTMLCanvasElement,
    pointer: (name, clientX, clientY) =>
      events.dispatch(name, {
        pointerType: "touch",
        pointerId: 1,
        clientX,
        clientY,
        preventDefault: () => undefined
      } as FakeEvent)
  };
}
