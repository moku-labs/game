/**
 * @file effects/filters — the shader check, in every build: every definition a registered kind can draw (its body,
 * every stage of its inputs, its fallback) is compiled once on the running backend when the renderer first draws; a
 * kind gets no instance until all of its own answered; one that fails breaks the kind (E5). The WGSL goes through the
 * renderer's device on WebGPU, the GLSL through its WebGL context on WebGL, in parallel where the driver can
 * (`KHR_parallel_shader_compile`). An error is logged with its line, once per definition. The `load` stage of a node
 * entry waits for the answers, so no mounted scene shows a filtered view unfiltered while its shader is checked. On
 * WebGPU a kind's quad program is compiled after its body answered, and the definition answers with it: a quad that
 * fails logs one line and only takes the quad away, the kind stays ok and its views keep today's path.
 */
import type { NodeInfo } from "../../flow/types";
import { pageNow } from "../../renderer/monitor/clock";
import type { EffectsCtx } from "../types";
import { logBroken } from "./guard";
import type { FilterDefinition, FilterKind } from "./types";

/** Where the check of one definition stands. */
type CheckStatus = "pending" | "ok" | "broken";

/** One compile error of a GLSL shader: its line in the assembled GLSL and what the driver said. */
type GlslError = { line: number; message: string };

/** One error line of a WebGL info log: `ERROR: 0:18: 'amount2' : undeclared identifier`. */
const GL_ERROR_LINE = /^ERROR: \d+:(\d+):(.*)$/;

/** The message of a failed compile whose info log is empty. */
const SILENT_FAILURE = "The GLSL did not compile and the driver said nothing.";

/** The WebGL extension that compiles in the background and answers on a later frame. */
const PARALLEL = "KHR_parallel_shader_compile";

/** Where the reader of an `effects:broken` line of a definition that does not compile looks next. */
const READ_LINES = "read the effects:wgsl or effects:glsl lines.";

/** The definitions of a Pixi-core kind: none, it draws Pixi's own shaders. */
const NO_DEFINITIONS: readonly FilterDefinition[] = Object.freeze([]);

/**
 * Milliseconds rounded to 0.1, as the check lines report them.
 *
 * @param ms - Milliseconds.
 * @returns The rounded value.
 * @example
 * ```ts
 * tenths(12.345); // 12.3
 * ```
 */
function tenths(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/**
 * Every definition a kind can draw as itself: its body, then the distinct stage definitions of every input, in input
 * then listed order. The fallback is not in it: it is checked on its own, so a broken kind can still draw it.
 *
 * @param kind - The registered kind.
 * @returns The definitions; none for a Pixi-core kind.
 */
function definitionsOf(kind: FilterKind): readonly FilterDefinition[] {
  if (kind.source === "core") return NO_DEFINITIONS;

  const list = [kind.definition];

  for (const input of kind.definition.inputs) {
    for (const stage of input.stages) if (!list.includes(stage.filter)) list.push(stage.filter);
  }

  return list;
}

/**
 * Every definition the registered kinds can draw, each once by identity, in registration order: each kind's own
 * definitions, then its fallback.
 *
 * @param ectx - Domain context of the effects plugin.
 * @returns The definitions to check.
 */
function checkList(ectx: EffectsCtx): FilterDefinition[] {
  const list: FilterDefinition[] = [];

  for (const kind of ectx.state.kinds.values()) {
    if (kind.source !== "wgsl") continue;

    const fallback = kind.definition.fallback;

    for (const definition of definitionsOf(kind))
      if (!list.includes(definition)) list.push(definition);
    if (fallback !== undefined && !list.includes(fallback)) list.push(fallback);
  }

  return list;
}

/**
 * The definitions the registered kinds draw as themselves: a stage or a fallback never runs on a quad, unless it is a
 * kind too.
 *
 * @param ectx - Domain context of the effects plugin.
 * @returns The main body of every kind of ours.
 */
function kindBodies(ectx: EffectsCtx): Set<FilterDefinition> {
  const bodies = new Set<FilterDefinition>();

  for (const kind of ectx.state.kinds.values()) {
    if (kind.source === "wgsl") bodies.add(kind.definition);
  }

  return bodies;
}

/**
 * Logs the line of a fallback that fails its own check, once: no kind can draw it in place of its own.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param definition - The definition that failed.
 */
function reportFallback(ectx: EffectsCtx, definition: FilterDefinition): void {
  for (const kind of ectx.state.kinds.values()) {
    if (kind.source === "wgsl" && kind.definition.fallback === definition) {
      logBroken(
        ectx,
        definition.id,
        undefined,
        "compile",
        `The shader does not compile on this device: ${READ_LINES}`
      );

      return;
    }
  }
}

/**
 * Logs `effects:checks` once the last definition answered, and lets every waiting node entry go on.
 *
 * @param ectx - Domain context of the effects plugin.
 */
function complete(ectx: EffectsCtx): void {
  const { checks } = ectx.state;

  ectx.log.info("effects:checks", {
    definitions: checks.checked,
    broken: checks.failed,
    ms: tenths(pageNow() - checks.startedAt)
  });
  checks.resolve();
}

/**
 * Records the answer of one definition's check, ok or broken for good. An answer of an earlier run, or of a
 * definition that already answered, is dropped.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param run - The run the check was started in.
 * @param definition - The definition.
 * @param passed - Whether its shader compiled without an error.
 */
function finish(
  ectx: EffectsCtx,
  run: number,
  definition: FilterDefinition,
  passed: boolean
): void {
  const { checks } = ectx.state;

  if (checks.run !== run || checks.status.get(definition) !== "pending") return;

  checks.status.set(definition, passed ? "ok" : "broken");

  if (!passed) {
    checks.failed += 1;
    reportFallback(ectx, definition);
  }

  checks.waiting -= 1;

  if (checks.started && checks.waiting === 0) complete(ectx);
}

/**
 * Takes the compilation messages of a quad program: clean, the definition's quad is usable; an error is one log line,
 * however many the compiler found, and costs the quad only. Either way the definition answers ok: its body compiled.
 * An answer of an earlier run is ignored.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param run - The run the check was started in.
 * @param definition - The definition.
 * @param messages - What the compiler said.
 */
function settleQuad(
  ectx: EffectsCtx,
  run: number,
  definition: FilterDefinition,
  messages: readonly GPUCompilationMessage[]
): void {
  const { checks } = ectx.state;

  if (checks.run !== run || checks.status.get(definition) !== "pending") return;

  const error = messages.find(message => message.type === "error");

  if (error === undefined) {
    checks.quads.add(definition);
  } else {
    ectx.log.error("effects:wgsl", {
      filter: definition.id,
      quad: true,
      line: error.lineNum,
      column: error.linePos,
      message: error.message
    });
  }

  finish(ectx, run, definition, true);
}

/**
 * Starts the compile of a definition's quad program, after its body compiled clean. With no device (lost since), or
 * info it cannot read, the definition is ok without a quad: an unchecked text never reaches the GPU.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param run - The current run.
 * @param definition - The definition.
 * @param source - Its quad program.
 */
function checkQuad(
  ectx: EffectsCtx,
  run: number,
  definition: FilterDefinition,
  source: string
): void {
  const device = ectx.deps.renderer.host.device();

  if (device === undefined) {
    finish(ectx, run, definition, true);

    return;
  }

  device
    .createShaderModule({ code: source })
    .getCompilationInfo()
    .then(
      info => settleQuad(ectx, run, definition, info.messages),
      () => finish(ectx, run, definition, true)
    );
}

/**
 * Takes the WGSL compilation messages of one definition: every error is one log line, and one error breaks it. A body
 * that compiled goes on to its quad program, if it has one to check. An answer of an earlier run is ignored.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param run - The run the check was started in.
 * @param definition - The definition.
 * @param messages - What the compiler said.
 * @param quad - The quad program to check after the body; `undefined` for none.
 */
function settle(
  ectx: EffectsCtx,
  run: number,
  definition: FilterDefinition,
  messages: readonly GPUCompilationMessage[],
  quad: string | undefined
): void {
  const { checks } = ectx.state;

  if (checks.run !== run || checks.status.get(definition) !== "pending") return;

  const errors = messages.filter(message => message.type === "error");

  for (const error of errors) {
    ectx.log.error("effects:wgsl", {
      filter: definition.id,
      line: error.lineNum,
      column: error.linePos,
      message: error.message
    });
  }

  if (errors.length === 0 && quad !== undefined) checkQuad(ectx, run, definition, quad);
  else finish(ectx, run, definition, errors.length === 0);
}

/**
 * Starts the WGSL check of a definition through the renderer's device. With no device (lost) it is ok at once, with no
 * quad; otherwise it answers when `getCompilationInfo()` resolves, and a quad's after that. A check that cannot read
 * its info counts as ok.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param run - The current run.
 * @param definition - The definition.
 * @param quad - Its quad program, for a kind that can run on one.
 */
function checkWgsl(
  ectx: EffectsCtx,
  run: number,
  definition: FilterDefinition,
  quad: string | undefined
): void {
  const device = ectx.deps.renderer.host.device();

  if (device === undefined) {
    finish(ectx, run, definition, true);

    return;
  }

  device
    .createShaderModule({ code: definition.source })
    .getCompilationInfo()
    .then(
      info => settle(ectx, run, definition, info.messages, quad),
      () => settle(ectx, run, definition, [], quad)
    );
}

/**
 * Reads the errors of a WebGL info log, one per `ERROR: 0:<line>: <message>` line; a summary line
 * is no error, and the NUL Chrome ends the log with is dropped. A log of another form is one error
 * at line 0, so a failed compile always says something.
 *
 * @param infoLog - What `getShaderInfoLog` answered.
 * @returns The errors, at least one.
 * @example
 * ```ts
 * glslErrors("ERROR: 0:17: 'amount2' : undeclared identifier\n\u0000"); // [{ line: 17, message: "'amount2' : undeclared identifier" }]
 * ```
 */
function glslErrors(infoLog: string): GlslError[] {
  const log = infoLog.replaceAll("\u0000", "");
  const errors = log.split("\n").flatMap(text => {
    const match = GL_ERROR_LINE.exec(text.trim());

    return match === null ? [] : [{ line: Number(match[1]), message: (match[2] ?? "").trim() }];
  });

  if (errors.length > 0) return errors;

  const whole = log.trim();

  return [{ line: 0, message: whole === "" ? SILENT_FAILURE : whole }];
}

/**
 * Answers a GLSL compile that finished: every error is one log line, one error breaks the definition, and the shader
 * is deleted either way. A lost context answers `null`, not false: only a real failure breaks it.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param run - The run the compile was started in.
 * @param gl - The renderer's WebGL context.
 * @param definition - The definition.
 * @param shader - Its compiled fragment shader.
 */
function answerGlsl(
  ectx: EffectsCtx,
  run: number,
  gl: WebGL2RenderingContext,
  definition: FilterDefinition,
  shader: WebGLShader
): void {
  const compiled: unknown = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  const errors = compiled === false ? glslErrors(gl.getShaderInfoLog(shader) ?? "") : [];

  gl.deleteShader(shader);

  for (const error of errors) {
    ectx.log.error("effects:glsl", {
      filter: definition.id,
      line: error.line,
      message: error.message
    });
  }

  finish(ectx, run, definition, errors.length === 0);
}

/**
 * Compiles the GLSL of a definition on the renderer's WebGL context. With `KHR_parallel_shader_compile` the compile
 * runs in the background and `pollChecks` answers it on a later frame; without it, it is answered at once. With no
 * context, or one that makes no shader (lost), the definition is ok.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param run - The current run.
 * @param definition - The definition.
 */
function checkGlsl(ectx: EffectsCtx, run: number, definition: FilterDefinition): void {
  const gl = ectx.deps.renderer.host.gl();
  const shader = gl?.createShader(gl.FRAGMENT_SHADER);

  if (gl === undefined || shader === undefined || shader === null) {
    finish(ectx, run, definition, true);

    return;
  }

  gl.shaderSource(shader, definition.glsl);
  gl.compileShader(shader);

  if (gl.getExtension(PARALLEL) === null) answerGlsl(ectx, run, gl, definition, shader);
  else ectx.state.checks.gl.push({ definition, shader });
}

/**
 * Starts the shader check of every definition the registered kinds can draw, on the backend that draws: the WGSL on
 * WebGPU, the GLSL on WebGL; on any other backend every definition is ok at once. Called once per run, by the filter
 * system's first run with a ready host or by the first node entry, whichever comes first.
 *
 * @param ectx - Domain context of the effects plugin.
 */
export function startChecks(ectx: EffectsCtx): void {
  const { checks } = ectx.state;
  const backend = ectx.deps.renderer.host.kind();

  checks.startedAt = pageNow();

  const bodies = kindBodies(ectx);

  for (const definition of checkList(ectx)) {
    if (checks.status.has(definition)) continue;

    checks.status.set(definition, "pending");
    checks.waiting += 1;
    checks.checked += 1;

    if (backend === "webgpu") {
      checkWgsl(
        ectx,
        checks.run,
        definition,
        bodies.has(definition) ? definition.quadSource : undefined
      );
    } else if (backend === "webgl") checkGlsl(ectx, checks.run, definition);
    else finish(ectx, checks.run, definition, true);
  }

  checks.started = true;

  if (checks.waiting === 0) complete(ectx);
}

/**
 * Where a background compile stands: done once `COMPLETION_STATUS_KHR` answers true (or the extension is gone, so a
 * read waits for it), lost when the context is gone or answers `null`, waiting otherwise.
 *
 * @param gl - The renderer's WebGL context, if any.
 * @param parallel - Its `KHR_parallel_shader_compile`, if any.
 * @param shader - The shader in flight.
 * @returns `"done"`, `"lost"` or `"waiting"`.
 */
function progressOf(
  gl: WebGL2RenderingContext | undefined,
  parallel: KHR_parallel_shader_compile | null | undefined,
  shader: WebGLShader
): "done" | "lost" | "waiting" {
  if (gl === undefined) return "lost";
  if (parallel === undefined || parallel === null) return "done";

  const status: unknown = gl.getShaderParameter(shader, parallel.COMPLETION_STATUS_KHR);

  if (status === true) return "done";

  return status === null ? "lost" : "waiting";
}

/**
 * Answers the GLSL compiles that finished in the background: each one whose `COMPLETION_STATUS_KHR` is true is read
 * as a compile at once; one that answers `null` (a lost context) is ok. Run at the start of every filter system run
 * while compiles are in flight.
 *
 * @param ectx - Domain context of the effects plugin.
 */
export function pollChecks(ectx: EffectsCtx): void {
  const { checks } = ectx.state;
  const { run, gl: inFlight } = checks;
  const gl = ectx.deps.renderer.host.gl();
  const parallel = gl?.getExtension(PARALLEL);
  let kept = 0;

  for (const entry of inFlight) {
    const progress = progressOf(gl, parallel, entry.shader);

    if (progress === "done" && gl !== undefined) {
      answerGlsl(ectx, run, gl, entry.definition, entry.shader);
    } else if (progress === "lost") {
      gl?.deleteShader(entry.shader);
      finish(ectx, run, entry.definition, true);
    } else {
      inFlight[kept] = entry;
      kept += 1;
    }
  }

  inFlight.length = kept;
}

/**
 * Deletes the GLSL compiles still in flight, while the context is still there: the teardown of a run.
 *
 * @param ectx - Domain context of the effects plugin.
 */
export function dropChecks(ectx: EffectsCtx): void {
  const gl = ectx.deps.renderer.host.gl();

  for (const entry of ectx.state.checks.gl) gl?.deleteShader(entry.shader);

  ectx.state.checks.gl.length = 0;
}

/**
 * Breaks a kind one of whose definitions failed its check: it never gets an instance of its own definition again in
 * this run, and one `effects:broken` line says so, under the stage's id when the stage failed.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param kind - The kind, made by `defineFilter`.
 * @param failed - The definition that failed.
 */
function breakKind(
  ectx: EffectsCtx,
  kind: FilterKind & { source: "wgsl" },
  failed: FilterDefinition
): void {
  const isMain = failed === kind.definition;
  const message = isMain
    ? `The shader does not compile on this device: ${READ_LINES}`
    : `Its stage "${failed.id}" does not compile on this device: ${READ_LINES}`;

  ectx.state.broken.add(kind.id);
  logBroken(
    ectx,
    kind.id,
    kind.definition.fallback,
    "compile",
    message,
    isMain ? undefined : { stage: failed.id }
  );
}

/**
 * Where the shader check of a kind stands: `"ok"` once its body and every stage answered ok (then a set lookup),
 * `"broken"` once one of them failed, `"pending"` before the checks started and while one is pending. A Pixi-core
 * kind is ok at once.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param kind - The registered kind.
 * @returns `"pending"`, `"ok"` or `"broken"`.
 */
export function kindStatus(ectx: EffectsCtx, kind: FilterKind): CheckStatus {
  const { state } = ectx;

  if (state.ready.has(kind.id)) return "ok";
  if (state.broken.has(kind.id)) return "broken";
  if (kind.source === "core") return "ok";
  if (!state.checks.started) return "pending";

  let pending = false;

  for (const definition of definitionsOf(kind)) {
    const status = state.checks.status.get(definition);

    if (status === "broken") {
      breakKind(ectx, kind, definition);

      return "broken";
    }

    if (status !== "ok") pending = true;
  }

  if (pending) return "pending";

  state.ready.add(kind.id);

  return "ok";
}

/**
 * A promise that resolves when a node is aborted.
 *
 * @param signal - The abort signal of the node.
 * @returns The promise.
 */
function whenAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise(resolve => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * The `load` stage of every node entry: waits for every pending shader check before the node's scene is switched, so
 * no mounted scene shows a filtered view unfiltered. Waits for nothing when the renderer draws nothing or every check
 * answered; starts the checks itself when the renderer is ready and they have not started yet. An aborted node stops
 * waiting. A wait logs `effects:mount-waited` once.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param node - The node being entered.
 * @param run - The stage's context: the node's abort signal.
 * @param run.signal - The abort signal of the node.
 * @returns A promise that resolves when the node may go on.
 */
export async function gateChecks(
  ectx: EffectsCtx,
  node: NodeInfo,
  run: { readonly signal: AbortSignal }
): Promise<void> {
  if (!ectx.deps.renderer.host.ready()) return;
  if (!ectx.state.checks.started) startChecks(ectx);

  const { checks } = ectx.state;

  if (checks.waiting === 0) return;

  const began = pageNow();

  await Promise.race([checks.settled, whenAborted(run.signal)]);

  if (run.signal.aborted) return;

  ectx.log.info("effects:mount-waited", { node: node.path, ms: tenths(pageNow() - began) });
}
