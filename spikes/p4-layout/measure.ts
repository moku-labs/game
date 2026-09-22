// Spike P4. Runs the script headless at a fixed 60 Hz step for each adapter and exit-flow policy and
// writes metrics.json.   bun spikes/p4-layout/measure.ts

import { createPixiLayout, offsetProbe } from "./layout-pixi";
import { createYogaLayout, yogaHasInstanceCount } from "./layout-yoga";
import { createDriver } from "./script";
import type { Layout } from "./core";

const SEED = 20260922;
const BLOCKS = 10;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
};
const round = (value: number): number => Math.round(value * 1000) / 1000;
const mean = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

export function summarize(layout: Layout, driver: ReturnType<typeof createDriver>, exitFlow: "leave" | "stay", indirectNodeCount: boolean) {
  const { metrics, core } = driver;
  return {
    adapter: layout.name,
    exitFlow,
    initMs: round(layout.initMs),
    solveMs: { p50: round(percentile(metrics.fullSolveMs, 50)), p95: round(percentile(metrics.fullSolveMs, 95)), samples: metrics.fullSolveMs.length },
    solveLeafMs: { p50: round(percentile(metrics.solveLeafMs, 50)), p95: round(percentile(metrics.solveLeafMs, 95)), samples: metrics.solveLeafMs.length },
    allSolvesMs: { p50: round(percentile(core.stats.solveMs, 50)), p95: round(percentile(core.stats.solveMs, 95)), count: core.stats.solves },
    solveCallsIdle: metrics.solveCallsIdle,
    solveCallsScroll: metrics.solveCallsScroll,
    unlaidFrames: core.stats.unlaidFrames,
    unlaidPopupFrames: metrics.unlaidPopupFrames,
    fightWrites: metrics.fightWrites,
    intentCount: { perTap: metrics.intentsPerTap, allOne: metrics.intentsPerTap.every(n => n === 1) },
    earlyDespawns: core.stats.earlyDespawns,
    behindMoved: metrics.behindMoved,
    localLost: metrics.localLost,
    siblingShiftFrame: { values: metrics.siblingShiftFrame, mean: round(mean(metrics.siblingShiftFrame)) },
    variantMisses: metrics.variantMisses,
    reentered: metrics.reentered,
    tabIntents: metrics.tabIntents,
    rowWidthError: { max: round(Math.max(0, ...metrics.rowWidthError)), samples: metrics.rowWidthError.length },
    measureCalls: { perChange: metrics.measureCallsPerChange, total: layout.measureCalls },
    reconcilePerFrame: { reconciles: metrics.reconcilesPerDoubleRender, solves: metrics.solvesPerDoubleRender },
    solvesPerFlip: metrics.solvesPerFlip,
    solvesPerLeafChange: metrics.solvesPerLeafChange.map(round),
    nodeLeak: { values: metrics.nodeLeak, max: Math.max(0, ...metrics.nodeLeak), indirect: indirectNodeCount },
    nodesLive: layout.nodeCount(),
    frames: core.stats.frame,
    entered: core.stats.entered,
    exited: core.stats.exited,
    despawned: core.stats.despawned,
    caseCounts: metrics.caseCounts
  };
}

async function run(name: "A" | "B", exitFlow: "leave" | "stay") {
  const layout = name === "A" ? await createYogaLayout() : await createPixiLayout();
  const driver = createDriver(layout, { exitFlow });
  driver.runAll(SEED, BLOCKS);
  return summarize(layout, driver, exitFlow, name === "A" ? !(await yogaHasInstanceCount()) : true);
}

if (import.meta.main) {
  const runs: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const adapter of ["A", "B"] as const) {
    for (const exitFlow of ["leave", "stay"] as const) {
      try {
        runs[`${adapter}-${exitFlow}`] = await run(adapter, exitFlow);
      } catch (error) {
        errors[`${adapter}-${exitFlow}`] = String(error instanceof Error ? error.stack ?? error.message : error);
      }
    }
  }
  let offset: unknown;
  try {
    offset = await offsetProbe();
  } catch (error) {
    offset = { error: String(error) };
  }
  const versionOf = async (name: string): Promise<string> => ((await Bun.file(`${import.meta.dir}/node_modules/${name}/package.json`).json()) as { version: string }).version;
  const versions = { "pixi.js": await versionOf("pixi.js"), "yoga-layout": await versionOf("yoga-layout"), "@pixi/layout": await versionOf("@pixi/layout"), bun: Bun.version };
  const out = { seed: SEED, blocksPerCase: BLOCKS, versions, runs, errors, bOffsetProbe: offset, runtimes: globalThis.__p4Runtimes ?? [] };
  await Bun.write(`${import.meta.dir}/metrics.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ versions, errors, bOffsetProbe: offset }, null, 2));
  for (const [key, value] of Object.entries(runs)) {
    const v = value as ReturnType<typeof summarize>;
    console.log(key, JSON.stringify({ initMs: v.initMs, solveMs: v.solveMs, idle: v.solveCallsIdle, scroll: v.solveCallsScroll, unlaid: v.unlaidFrames, fight: v.fightWrites, intents: v.intentCount.allOne, early: v.earlyDespawns, behind: v.behindMoved, localLost: v.localLost, shift: v.siblingShiftFrame.mean, variant: v.variantMisses, reentered: v.reentered, rowErr: v.rowWidthError.max, measure: v.measureCalls.perChange.slice(0, 3), recon: v.reconcilePerFrame.reconciles.slice(0, 3), leak: v.nodeLeak, cases: v.caseCounts }));
    const short = Object.values(v.caseCounts).some(n => n < BLOCKS) || Object.keys(v.caseCounts).length < 9;
    if (short) {
      console.error(`${key}: a case ran fewer than ${BLOCKS} times`, v.caseCounts);
      process.exitCode = 1;
    }
  }
  if (Object.keys(errors).length > 0) process.exitCode = 1;
}
