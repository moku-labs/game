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

/** The six vectors of the group, under the names Pixi's filter system fills. */
export type FilterGlobals = {
  uInputSize: Float32Array;
  uInputPixel: Float32Array;
  uInputClamp: Float32Array;
  uOutputFrame: Float32Array;
  uGlobalFrame: Float32Array;
  uOutputTexture: Float32Array;
};

/** The group of the global filter uniforms, and its vectors: the arrays the group itself reads. */
export type FilterGlobalsHandle = {
  readonly group: PixiUniformGroup;
  readonly vectors: FilterGlobals;
};

/**
 * One vector of the group, over an array the caller keeps.
 *
 * @param value - The array.
 * @returns The uniform.
 */
function vector(value: Float32Array): Vector {
  return { value, type: "vec4<f32>" };
}

/**
 * The group of the numbers a filter pass hands a body, under the names Pixi's filter system fills, and the arrays it
 * reads, typed. Static: a group that is not is uploaded on every draw, and a shaded view changes these only when it
 * moves or its picture changes size.
 *
 * @param pixi - The module that draws.
 * @returns The group, zeros, and its vectors.
 */
export function filterGlobals(pixi: PixiModule): FilterGlobalsHandle {
  const vectors: FilterGlobals = {
    uInputSize: new Float32Array(VECTOR),
    uInputPixel: new Float32Array(VECTOR),
    uInputClamp: new Float32Array(VECTOR),
    uOutputFrame: new Float32Array(VECTOR),
    uGlobalFrame: new Float32Array(VECTOR),
    uOutputTexture: new Float32Array(VECTOR)
  };
  const group = new pixi.UniformGroup(
    {
      uInputSize: vector(vectors.uInputSize),
      uInputPixel: vector(vectors.uInputPixel),
      uInputClamp: vector(vectors.uInputClamp),
      uOutputFrame: vector(vectors.uOutputFrame),
      uGlobalFrame: vector(vectors.uGlobalFrame),
      uOutputTexture: vector(vectors.uOutputTexture)
    },
    { isStatic: true }
  );

  return { group, vectors };
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
