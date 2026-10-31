/**
 * @file renderer plugin — what a filter's body needs to run on a quad: the numbers a filter pass hands it, the unit
 * square and the shader. The kept cache draws through them and the pipeline warm-up probes them. A plain module of the
 * plugin root, so neither module imports the other's run-time code (L1).
 */
import type {
  FilterSlotQuad,
  PixiMeshGeometry,
  PixiModule,
  PixiShader,
  PixiTextureSource,
  PixiUniformGroup
} from "./types";

/** Numbers of a vector of the global filter uniforms. */
export const VECTOR = 4;

/** A uniform of the group as Pixi takes it. */
type Vector = { value: Float32Array; type: "vec4<f32>" };

/**
 * One vector of the group, all zeros.
 *
 * @returns The uniform.
 */
function vector(): Vector {
  return { value: new Float32Array(VECTOR), type: "vec4<f32>" };
}

/**
 * The group of the numbers a filter pass hands a body, under the names Pixi's filter system fills. Static: a group that
 * is not is uploaded on every draw, and a shaded view changes these only when it moves or its picture changes size.
 *
 * @param pixi - The module that draws.
 * @returns The group, zeros.
 */
export function filterGlobals(pixi: PixiModule): PixiUniformGroup {
  return new pixi.UniformGroup(
    {
      uInputSize: vector(),
      uInputPixel: vector(),
      uInputClamp: vector(),
      uOutputFrame: vector(),
      uGlobalFrame: vector(),
      uOutputTexture: vector()
    },
    { isStatic: true }
  );
}

/**
 * The unit square of a quad program, its uvs over the whole texture: the mesh's scale gives it its size.
 *
 * @param pixi - The module that draws.
 * @returns A new geometry.
 */
export function unitQuad(pixi: PixiModule): PixiMeshGeometry {
  return new pixi.MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3])
  });
}

/**
 * The shader of a quad over a texture. `fu` is left out for a filter that binds none: Pixi throws on an undefined
 * resource.
 *
 * @param pixi - The module that draws.
 * @param quad - The slot's quad.
 * @param gfu - The global filter uniforms.
 * @param source - The texture it reads.
 * @returns The shader.
 */
export function quadShader(
  pixi: PixiModule,
  quad: FilterSlotQuad,
  gfu: PixiUniformGroup,
  source: PixiTextureSource
): PixiShader {
  const { program, fu } = quad;
  const texture = { gfu, uTexture: source, uSampler: source.style };

  return new pixi.Shader({
    gpuProgram: program,
    resources: fu === undefined ? texture : { ...texture, fu }
  });
}
