/**
 * @file renderer/host — the render-group pipe that puts back the target a filter had bound when a group cached as a
 * texture is redrawn inside it. Pixi 8.22's `FilterSystem` switches to a filter's input with `renderTarget.bind`, which
 * is not on the target stack; `RenderGroupPipe` refreshes a group cached as a texture with `push` … `pop`, and `pop`
 * binds the previous entry of the stack: the canvas. Everything drawn after it inside the filter then lands on the
 * canvas (the black memory screen of A Memory Missing). The renderer's pipe reads the bind state before the refresh and
 * binds it again after, with no clear. It is a subclass of Pixi's exported pipe, put into Pixi's extension registry
 * before `app.init()` under the same name; no Pixi prototype and no Pixi instance is patched. The engine never caches a
 * group as a texture itself: this is a safety net for a game's `Display` objects.
 */
import type { PixiModule } from "../types";

/** Pixi's render-group pipe class, the base of the renderer's. */
type RenderGroupPipeClass = PixiModule["RenderGroupPipe"];

/** What the pipe is built with: Pixi's renderer. */
type PipeRenderer = ConstructorParameters<RenderGroupPipeClass>[0];

/** A render group the pipe executes. */
type RenderGroup = Parameters<InstanceType<RenderGroupPipeClass>["execute"]>[0];

/** A binding of Pixi's render target system, as `getBindState` captures it and `bind` replays it. */
type BindState = ReturnType<PipeRenderer["renderTarget"]["getBindState"]>;

/** The three public members of Pixi's render target system the pipe reads and calls. */
type TargetBinding = {
  readonly renderSurface: unknown;
  getBindState(out?: BindState): BindState;
  bind(options: BindState): unknown;
};

/**
 * Builds the renderer's render-group pipe: Pixi's, which also puts back the target a filter had bound when a group
 * cached as a texture was redrawn inside it (Pixi's own pop restores its stack, which a filter's bind is not on). It is
 * made at call time, because Pixi's pipe arrives with the lazily loaded module, and keeps the base's `static
 * extension` object as it is, so the registry files it under the same types and name. It costs one test of three
 * booleans per render group executed.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The pipe class.
 */
export function createRebindingRenderGroupPipe(pixi: PixiModule): RenderGroupPipeClass {
  /** Pixi's render-group pipe, which binds a filter's input again after a cached group refreshed inside it. */
  class RebindingRenderGroupPipe extends pixi.RenderGroupPipe {
    public static override readonly extension = pixi.RenderGroupPipe.extension;

    /** Pixi's render target system: `_renderer` is private on the base. */
    private readonly targets: TargetBinding;

    /** The one bind state the pipe captures into, reused at every refresh. */
    private saved: BindState | undefined;

    /**
     * Keeps the render target system of the renderer the pipe draws for.
     *
     * @param renderer - Pixi's renderer.
     */
    public constructor(renderer: PipeRenderer) {
      super(renderer);
      this.targets = renderer.renderTarget;
    }

    /**
     * Executes a render group as Pixi does; when a group cached as a texture is refreshed, the target bound before it
     * is bound again after it, kept (no clear), unless Pixi's own pop already restored it.
     *
     * @param renderGroup - The render group.
     */
    public override execute(renderGroup: RenderGroup): void {
      const refreshes =
        renderGroup.isRenderable && renderGroup.isCachedAsTexture && renderGroup.textureNeedsUpdate;

      if (!refreshes) {
        super.execute(renderGroup);

        return;
      }

      const saved = this.targets.getBindState(this.saved);

      this.saved = saved;
      super.execute(renderGroup);

      if (this.targets.renderSurface !== saved.target) this.targets.bind(saved);
    }
  }

  return RebindingRenderGroupPipe;
}

/**
 * Swaps Pixi's render-group pipe for the renderer's in the module's extension registry: `remove` frees the name on
 * every backend, `add` puts the subclass in under it. Every application made afterwards draws its render groups with
 * it. The registry is global to the module object, so the remover matters: it swaps Pixi's own pipe back.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The remover.
 * @throws {TypeError} When the module has no `RenderGroupPipe` to subclass.
 */
export function installRebindingRenderGroupPipe(pixi: PixiModule): () => void {
  const pipe = createRebindingRenderGroupPipe(pixi);

  pixi.extensions.remove(pixi.RenderGroupPipe);
  pixi.extensions.add(pipe);

  return (): void => {
    pixi.extensions.remove(pipe);
    pixi.extensions.add(pixi.RenderGroupPipe);
  };
}
