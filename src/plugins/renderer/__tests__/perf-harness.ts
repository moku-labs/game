/**
 * @file renderer plugin — the harness of the performance monitor tests. Not a test file. An agent
 * build of the mock renderer, started, with the page clock in the test's hand, the perf context of
 * the started monitor, and a listener that keeps every line.
 */
import { vi } from "vitest";
import type { FrameMeasure } from "../../time/types";
import { withDeps } from "../lifecycle";
import type { PerfLogLine } from "../monitor/log-types";
import type { PerfCtx } from "../monitor/types";
import { createMockRenderer, type MockRenderer } from "./mock-renderer";

/** The started agent build: the mock, the page clock, the perf context. */
export type AgentRenderer = {
  mock: MockRenderer;
  /** What `performance.now()` answers. */
  clock: { now: number };
  pc: PerfCtx;
  /** Subscribes a listener that keeps every line. */
  listen(): PerfLogLine[];
  /** One drawn frame: input, render, then the measure listeners. */
  frame(record?: Partial<FrameMeasure>): void;
};

/**
 * Starts the mock renderer of an agent build.
 *
 * @param options - Options of the mock.
 * @returns The started agent build.
 */
export async function startAgent(
  options: Parameters<typeof createMockRenderer>[0] = {}
): Promise<AgentRenderer> {
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);
  const clock = { now: 0 };

  vi.spyOn(globalThis.performance, "now").mockImplementation(() => clock.now);

  const mock = createMockRenderer(options);

  await mock.start();

  const perf = mock.ctx.state.monitor.perf;

  if (perf === undefined) throw new Error("perf-harness: no perf state");

  const pc: PerfCtx = {
    ctx: withDeps(mock.ctx),
    deps: mock.modules,
    perf,
    sinks: mock.ctx.state.monitor.sinks
  };

  return {
    mock,
    clock,
    pc,
    listen: () => {
      const lines: PerfLogLine[] = [];

      mock.api.monitor.stream(line => lines.push(line));

      return lines;
    },
    frame: record => mock.drawFrame(record)
  };
}

/**
 * The lines of one kind.
 *
 * @param lines - The lines a listener got.
 * @param kind - The kind.
 * @returns Those lines, in order.
 */
export function linesOf<Kind extends PerfLogLine["kind"]>(
  lines: readonly PerfLogLine[],
  kind: Kind
): Extract<PerfLogLine, { kind: Kind }>[] {
  return lines.filter((line): line is Extract<PerfLogLine, { kind: Kind }> => line.kind === kind);
}
