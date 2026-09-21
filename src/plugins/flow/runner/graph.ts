/**
 * @file flow/runner — the graph the loop runs.
 */
import type { FeaturesApi } from "../features/types";
import type { FlowCtx } from "../types";
import { collectFlows, slotNames } from "./registry";
import type { AnyFlow } from "./types";
import { validateGraph } from "./validate";

/**
 * Reads the main flow of the config.
 *
 * @param ctx - Domain context of the flow plugin.
 * @returns The top-level flow.
 * @throws {Error} When no main flow was configured.
 */
export function requireMainFlow(ctx: FlowCtx): AnyFlow {
  const main = ctx.config.mainFlow;

  if (main === undefined) {
    throw new Error(
      "[game] flow.run() needs a main flow.\n  Pass it as pluginConfigs.flow.mainFlow."
    );
  }

  return main;
}

/**
 * Collects every flow of the graph: the main flow, everything it reaches by reference and the
 * sub-flows features contributed to a slot. A contribution may hold a slot of its own, so the slots
 * are expanded until no new flow appears; flow ids are unique, so that ends.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param features - Features API, read for the slot contributions.
 * @returns Flow id to flow, the main flow first.
 */
export function collectGraph(ctx: FlowCtx, features: FeaturesApi): Map<string, AnyFlow> {
  const main = requireMainFlow(ctx);
  const graph = { flows: collectFlows(main, []), size: -1 };

  while (graph.size !== graph.flows.size) {
    const contributed: AnyFlow[] = [];

    for (const name of slotNames(graph.flows)) {
      for (const contribution of features.contributions(name)) contributed.push(contribution.flow);
    }

    graph.size = graph.flows.size;
    graph.flows = collectFlows(main, contributed);
  }

  return graph.flows;
}

/**
 * Validates the collected graph. Warnings are logged, problems stop `run()` in one error.
 *
 * @param ctx - Domain context of the flow plugin.
 * @param features - Features API, read for the slot contributions.
 * @throws {Error} When the graph has problems, all of them in one message.
 */
export function checkGraph(ctx: FlowCtx, features: FeaturesApi): void {
  const report = validateGraph(ctx.state.runner.flows, features, ctx.config);

  for (const warning of report.warnings) ctx.log.warn("flow:graph-warning", { warning });

  if (report.problems.length > 0) throw new Error(report.problems.join("\n"));
}
