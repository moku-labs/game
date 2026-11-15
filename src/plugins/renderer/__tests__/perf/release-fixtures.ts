import type { PixiTextureSource } from "../../types";

/**
 * Sources whose decoded image waits for its upload: not destroyed, no GPU copy on any renderer.
 *
 * @param count - How many.
 * @returns The sources.
 */
export function waitingSources(count: number): PixiTextureSource[] {
  return Array.from(
    { length: count },
    () => ({ destroyed: false, _gpuData: {} }) as unknown as PixiTextureSource
  );
}
