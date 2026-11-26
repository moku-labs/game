#!/usr/bin/env bun
/**
 * @file Reads the profiles a run of the stress bench wrote: `bun bench/stress/profile.ts <file.cpuprofile |
 * file.heapprofile> [top=30] [--under <function> | --callees <function>]`. A CPU profile gives the self time of each function and the time under each of the
 * marker functions (the engine's systems and Pixi's render steps), as shares of the sampled time that is not idle.
 * An allocation profile gives the bytes each function allocated, with its nearest named callers.
 */
import { readFileSync } from "node:fs";

/** A node of a CPU profile. */
type CpuNode = {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
};

/** A CPU profile as the DevTools protocol gives it. */
type CpuProfile = { nodes: CpuNode[]; samples: number[]; timeDeltas: number[] };

/** A node of an allocation profile. */
type HeapNode = {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: HeapNode[];
};

/** The functions whose whole subtree is reported: the steps of a frame. */
const MARKERS = new Set([
  "reconcileIfDirty",
  "reconcile",
  "diffNode",
  "diffChildren",
  "solve",
  "solveRoot",
  "calculateLayout",
  "applyRoot",
  "enterQueued",
  "pass",
  "livePass",
  "advanceTracks",
  "advanceTimelines",
  "stepParticles",
  "render",
  "_updateRenderGroups",
  "updateRenderGroupTransforms",
  "validateRenderables",
  "_buildInstructions",
  "collectRenderables",
  "_updateRenderables",
  "executeInstructions",
  "renderEnd",
  "upload",
  "walkFrame"
]);

const [file, topArgument, underFlag, underOf] = process.argv.slice(2);
const top = Number(topArgument ?? 30);

if (underFlag !== undefined && underFlag !== "--under" && underFlag !== "--callees") {
  console.error("Usage: bun bench/stress/profile.ts <file> [top] [--under <function> | --callees <function>]");
  process.exit(2);
}

if (file === undefined) {
  console.error("Usage: bun bench/stress/profile.ts <file.cpuprofile | file.heapprofile> [top]");
  process.exit(2);
}

/**
 * A function's name with its line, as a profile row shows it.
 *
 * @param frame - The call frame.
 * @param frame.functionName - The function, empty for an anonymous one.
 * @param frame.lineNumber - Its line in the bundle.
 * @returns The label.
 */
function labelOf(frame: { functionName: string; lineNumber: number }): string {
  return `${frame.functionName === "" ? "(anonymous)" : frame.functionName}:${frame.lineNumber}`;
}

/**
 * Prints a table of the largest entries.
 *
 * @param title - The heading.
 * @param entries - Label and value.
 * @param total - What 100 % is.
 * @param unit - The unit of the value.
 */
function print(title: string, entries: Map<string, number>, total: number, unit: string): void {
  console.log(`\n${title}`);

  for (const [label, value] of [...entries]
    .toSorted((left, right) => right[1] - left[1])
    .slice(0, top)) {
    console.log(
      `${((value / total) * 100).toFixed(1).padStart(6)} %  ${value.toFixed(1).padStart(10)} ${unit}  ${label}`
    );
  }
}

/** A CPU profile, indexed: its nodes by id, each node's parent, and the self ms of each node. */
type Indexed = {
  byId: Map<number, CpuNode>;
  parent: Map<number, number>;
  self: Map<number, number>;
};

/**
 * Indexes a CPU profile.
 *
 * @param profile - The profile.
 * @returns Its nodes, parents and self times.
 */
function indexOf(profile: CpuProfile): Indexed {
  const byId = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map<number, number>();
  const self = new Map<number, number>();

  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node.id);

  for (const [index, id] of profile.samples.entries()) {
    self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  }

  return { byId, parent, self };
}

/**
 * The names of the functions on a node's stack, the node first.
 *
 * @param indexed - The indexed profile.
 * @param id - The node.
 * @returns The names up to the root.
 */
function stackOf(indexed: Indexed, id: number): string[] {
  const stack: string[] = [];

  for (let at: number | undefined = id; at !== undefined; at = indexed.parent.get(at)) {
    stack.push(indexed.byId.get(at)?.callFrame.functionName ?? "");
  }

  return stack;
}

/**
 * Whether a node is the VM's own idle time.
 *
 * @param name - The function name of the node.
 * @returns True for `(idle)`, `(program)` and `(root)`.
 */
function isIdle(name: string): boolean {
  return name === "(idle)" || name === "(program)" || name === "(root)";
}

/**
 * Prints who called a function, by the time under it, three callers up.
 *
 * @param indexed - The indexed profile.
 * @param name - The function.
 */
function printCallers(indexed: Indexed, name: string): void {
  const callers = new Map<string, number>();
  let whole = 0;

  for (const [id, ms] of indexed.self) {
    const stack = stackOf(indexed, id);
    const found = stack.lastIndexOf(name);

    if (found === -1) continue;

    const key = stack.slice(found + 1, found + 4).join(" <- ");

    whole += ms;
    callers.set(key, (callers.get(key) ?? 0) + ms);
  }

  console.log(`under ${name}: ${whole.toFixed(1)} ms`);
  print(`Callers of ${name} (share of its time)`, callers, whole, "ms");
}

/**
 * Prints what a function spends its time in: its own code, and each function it calls, with what that one calls.
 *
 * @param indexed - The indexed profile.
 * @param name - The function.
 */
function printCallees(indexed: Indexed, name: string): void {
  const callees = new Map<string, number>();
  let whole = 0;

  for (const [id, ms] of indexed.self) {
    const stack = stackOf(indexed, id);
    const found = stack.indexOf(name);

    if (found === -1) continue;

    const first = found === 0 ? "(its own code)" : (stack[found - 1] ?? "");
    const second = found < 2 ? "" : ` > ${stack[found - 2] ?? ""}`;

    whole += ms;
    callees.set(first, (callees.get(first) ?? 0) + ms);
    if (second !== "") callees.set(`${first}${second}`, (callees.get(`${first}${second}`) ?? 0) + ms);
  }

  console.log(`under ${name}: ${whole.toFixed(1)} ms`);
  print(`What ${name} calls (share of its time; "a > b" is b called from a)`, callees, whole, "ms");
}

/**
 * Reads a CPU profile: self time by function, and the time under each marker function; with `--under`, the callers
 * of one function instead.
 *
 * @param profile - The profile.
 */
function readCpu(profile: CpuProfile): void {
  const indexed = indexOf(profile);

  if (underOf !== undefined && underFlag === "--callees") {
    printCallees(indexed, underOf);

    return;
  }

  if (underOf !== undefined) {
    printCallers(indexed, underOf);

    return;
  }

  const byFunction = new Map<string, number>();
  const under = new Map<string, number>();
  let busy = 0;
  let idle = 0;

  for (const [id, ms] of indexed.self) {
    const node = indexed.byId.get(id);

    if (node === undefined) continue;

    if (isIdle(node.callFrame.functionName)) {
      idle += ms;
      continue;
    }

    busy += ms;
    byFunction.set(labelOf(node.callFrame), (byFunction.get(labelOf(node.callFrame)) ?? 0) + ms);

    // Every marker on the stack gets the sample once.
    for (const marker of new Set(stackOf(indexed, id).filter(name => MARKERS.has(name)))) {
      under.set(marker, (under.get(marker) ?? 0) + ms);
    }
  }

  console.log(`busy ${busy.toFixed(0)} ms, idle and program ${idle.toFixed(0)} ms`);
  print("Time under a marker function (inclusive, share of busy time)", under, busy, "ms");
  print("Self time by function (share of busy time)", byFunction, busy, "ms");
}

/**
 * Reads an allocation profile: bytes by the function that allocated, with the two named callers above it.
 *
 * @param head - The root of the profile.
 */
function readHeap(head: HeapNode): void {
  const byFunction = new Map<string, number>();
  let total = 0;

  /**
   * Walks a node with the labels of the functions above it.
   *
   * @param node - The node.
   * @param stack - The labels above it, nearest last.
   */
  function walk(node: HeapNode, stack: string[]): void {
    const label = labelOf(node.callFrame);

    if (node.selfSize > 0) {
      const key = `${label}  <- ${stack.slice(-2).toReversed().join(" <- ")}`;

      total += node.selfSize;
      byFunction.set(key, (byFunction.get(key) ?? 0) + node.selfSize / 1024);
    }

    for (const child of node.children) walk(child, [...stack, label]);
  }

  walk(head, []);
  console.log(`sampled ${(total / 1024).toFixed(0)} KB`);
  print(
    "Bytes by allocating function (share of the sampled bytes)",
    byFunction,
    total / 1024,
    "KB"
  );
}

const text = JSON.parse(readFileSync(file, "utf8")) as CpuProfile & { head?: HeapNode };

if (text.head === undefined) readCpu(text);
else readHeap(text.head);
