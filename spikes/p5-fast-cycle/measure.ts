// Spike P5. Runs the script headless at a fixed 60 Hz step for each policy and writes metrics.json.
// bun spikes/p5-fast-cycle/measure.ts

import { createCore, type EasingSet, type Policy } from "./core";
import { buildScript, feed } from "./script";

const SEED = 20260922;
const FRAME = 1000 / 60;

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
};
const round = (value: number) => Math.round(value * 100) / 100;

function run(policy: Policy, easing: EasingSet, intervalMs: number) {
  const script = buildScript(SEED, intervalMs);
  const core = createCore(policy, easing);
  let cursor = 0;
  let settledAtMs: number | undefined;

  for (let now = 0; now <= script.endMs + 10_000; now += FRAME) {
    cursor = feed(core, script.events, cursor, now);
    core.advance(FRAME);
    if (now > script.endMs && settledAtMs === undefined && core.isSettled()) settledAtMs = now - script.endMs;
    if (now > script.endMs + 1000 && settledAtMs !== undefined) break;
  }

  const { stats } = core;
  return {
    policy,
    easing,
    movesPerSecond: 1000 / intervalMs,
    scriptMs: script.endMs,
    maxJumpPx: round(stats.maxJumpPx),
    maxScaleJump: round(stats.maxScaleJump),
    snapCount: stats.snapCount,
    overlapCount: stats.overlapCount,
    snapRatio: round(stats.snapCount / Math.max(1, stats.overlapCount)),
    cutMotions: stats.cutMotions,
    cutRatio: round(stats.cutMotions / Math.max(1, stats.overlapCount)),
    crossFieldFinishes: stats.crossFieldFinishes,
    maxSpeedJump: round(stats.maxSpeedJump),
    speedJumpP99: round(percentile(stats.speedJumps, 99)),
    lagMs: {
      p50: round(percentile(stats.lagSamples, 50)),
      p95: round(percentile(stats.lagSamples, 95)),
      max: round(Math.max(0, ...stats.lagSamples))
    },
    lagFromLastCommitMs: {
      p50: round(percentile(stats.lagFromLastSamples, 50)),
      p95: round(percentile(stats.lagFromLastSamples, 95)),
      max: round(Math.max(0, ...stats.lagFromLastSamples))
    },
    queueDepthMax: stats.queueDepthMax,
    convergence: settledAtMs !== undefined && settledAtMs <= 1000,
    settledAfterEndMs: settledAtMs === undefined ? null : round(settledAtMs),
    jumpsByMotion: stats.jumpsByMotion,
    caseCounts: script.caseCounts
  };
}

const runs = [];
for (const easing of ["spec", "linear"] as EasingSet[])
  for (const policy of ["A", "B", "C"] as Policy[]) runs.push(run(policy, easing, 200));
// the same script at one move per second: nothing overlaps, so this is the floor of the speed metrics
const baseline = run("A", "spec", 1000);
// the same script faster and slower, to see how each policy degrades
for (const intervalMs of [333, 125]) for (const policy of ["A", "B", "C"] as Policy[]) runs.push(run(policy, "spec", intervalMs));

const caseCounts = runs[0]?.caseCounts ?? {};
await Bun.write(`${import.meta.dir}/metrics.json`, JSON.stringify({ seed: SEED, runs, baseline }, null, 2));

console.table(
  [...runs, baseline].map(r => ({
    policy: r.policy, easing: r.easing, rate: r.movesPerSecond, overlaps: r.overlapCount, snaps: r.snapCount,
    snapRatio: r.snapRatio, maxJumpPx: r.maxJumpPx, maxScaleJump: r.maxScaleJump, cut: r.cutMotions, cutRatio: r.cutRatio,
    crossField: r.crossFieldFinishes, speedMax: r.maxSpeedJump, speedP99: r.speedJumpP99,
    lagP50: r.lagMs.p50, lagP95: r.lagMs.p95, lagMax: r.lagMs.max,
    qDespawn: r.queueDepthMax.despawn, qMotion: r.queueDepthMax.motion, converged: r.convergence
  }))
);
console.log("caseCounts", caseCounts);
console.log("policy A, spec easing, 5 per second, jumps by finished motion", runs[0]?.jumpsByMotion);

const short = Object.entries(caseCounts).filter(([, count]) => count < 10);
if (Object.keys(caseCounts).length < 8 || short.length > 0) {
  console.error("a case has fewer than 10 blocks", caseCounts);
  process.exit(1);
}
