/**
 * @file effects/filters — the dev shader check. One bad shader blanks the whole frame and only the
 * browser console says why (P10), so in a dev build a kind with its own shaders is compiled once on
 * the running backend before its first instance: the WGSL through the renderer's device on WebGPU,
 * the GLSL through its WebGL context on WebGL. An error is logged with its line and the kind never
 * gets an instance. A production build never compiles twice.
 */
import { isDev } from "../../flow/doors/dev";
import type { EffectsCtx } from "../types";
import type { FilterDefinition, FilterKind } from "./types";

/** Where the check of one kind stands. */
type CheckStatus = "pending" | "ok" | "broken";

/** One compile error of a GLSL shader: its line in the assembled GLSL and what the driver said. */
type GlslError = { line: number; message: string };

/** One error line of a WebGL info log: `ERROR: 0:18: 'amount2' : undeclared identifier`. */
const GL_ERROR_LINE = /^ERROR: \d+:(\d+):(.*)$/;

/** The message of a failed compile whose info log is empty. */
const SILENT_FAILURE = "The GLSL did not compile and the driver said nothing.";

/**
 * Records the answer of a check: ok, or broken for good, so the kind never gets an instance.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The kind id.
 * @param passed - Whether the shader compiled without an error.
 * @returns `"ok"` or `"broken"`.
 */
function finish(ectx: EffectsCtx, id: string, passed: boolean): CheckStatus {
  const { state } = ectx;

  if (passed) {
    state.checks.set(id, "ok");

    return "ok";
  }

  state.checks.delete(id);
  state.broken.add(id);

  return "broken";
}

/**
 * Takes the WGSL compilation messages of one kind: every error is one log line, and one error
 * breaks the kind. A check the teardown dropped meanwhile is ignored.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The kind id.
 * @param messages - What the compiler said.
 */
function settle(ectx: EffectsCtx, id: string, messages: readonly GPUCompilationMessage[]): void {
  if (ectx.state.checks.get(id) !== "pending") return;

  const errors = messages.filter(message => message.type === "error");

  for (const error of errors) {
    ectx.log.error("effects:wgsl", {
      filter: id,
      line: error.lineNum,
      column: error.linePos,
      message: error.message
    });
  }

  finish(ectx, id, errors.length === 0);
}

/**
 * Starts the WGSL check of a kind through the renderer's device. With no device (lost) the kind is
 * `"ok"` and never checked again; otherwise it is `"pending"` until `getCompilationInfo()`
 * resolves. A check that cannot read its info counts as `"ok"`.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The kind id.
 * @param definition - Its filter definition.
 * @returns `"pending"`, or `"ok"` without a device.
 */
function checkWgsl(ectx: EffectsCtx, id: string, definition: FilterDefinition): CheckStatus {
  const device = ectx.deps.renderer.host.device();

  if (device === undefined) return finish(ectx, id, true);

  ectx.state.checks.set(id, "pending");
  device
    .createShaderModule({ code: definition.source })
    .getCompilationInfo()
    .then(
      info => settle(ectx, id, info.messages),
      () => settle(ectx, id, [])
    );

  return "pending";
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
 * Compiles the GLSL of a kind on the renderer's WebGL context, at once: every error is one log
 * line, and one error breaks the kind. The shader is deleted either way. With no context, or one
 * that makes no shader (lost), the kind is `"ok"` and never checked again.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param id - The kind id.
 * @param definition - Its filter definition.
 * @returns `"ok"` or `"broken"`, never `"pending"`.
 */
function checkGlsl(ectx: EffectsCtx, id: string, definition: FilterDefinition): CheckStatus {
  const gl = ectx.deps.renderer.host.gl();

  if (gl === undefined) return finish(ectx, id, true);

  const shader = gl.createShader(gl.FRAGMENT_SHADER);

  if (shader === null) return finish(ectx, id, true);

  gl.shaderSource(shader, definition.glsl);
  gl.compileShader(shader);

  // A lost context answers null here, not false: only a real failure breaks the kind.
  const compiled: unknown = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  const errors = compiled === false ? glslErrors(gl.getShaderInfoLog(shader) ?? "") : [];

  gl.deleteShader(shader);

  for (const error of errors) {
    ectx.log.error("effects:glsl", { filter: id, line: error.line, message: error.message });
  }

  return finish(ectx, id, errors.length === 0);
}

/**
 * Where the shader check of a kind stands, starting it on the first ask on the backend that draws:
 * the WGSL on WebGPU, `"pending"` until its compilation info resolves; the GLSL on WebGL, answered
 * at once. A Pixi-core kind and every kind in a production build are `"ok"` at once, and so is
 * every kind while nothing draws.
 *
 * @param ectx - Domain context of the effects plugin.
 * @param kind - The registered kind.
 * @returns `"pending"`, `"ok"` or `"broken"`.
 */
export function checkShader(ectx: EffectsCtx, kind: FilterKind): CheckStatus {
  const { state } = ectx;

  if (state.broken.has(kind.id)) return "broken";
  if (kind.source === "core") return "ok";

  const known = state.checks.get(kind.id);

  if (known !== undefined) return known;

  // A production build never compiles twice: it asks the renderer nothing.
  const backend = isDev() ? ectx.deps.renderer.host.kind() : "none";

  if (backend === "webgpu") return checkWgsl(ectx, kind.id, kind.definition);
  if (backend === "webgl") return checkGlsl(ectx, kind.id, kind.definition);

  return finish(ectx, kind.id, true);
}
