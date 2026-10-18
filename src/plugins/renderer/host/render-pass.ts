/**
 * @file renderer/host — the lazy canvas pass of WebGPU (B3 of change 2026-10-18-memory-render). Pixi 8.22 begins the
 * canvas's render pass when a render starts (`RenderTargetSystem.renderStart` → `GpuRenderTargetAdaptor
 * .startRenderPass`, a clear and a store). A frame whose first instruction is a filter ends that pass at once with no
 * draw in it (`FilterSystem` binds its input), and the filter's apply begins it again with a load: on a tiled GPU (the
 * Mali of a Galaxy A26) the frame pays a store and a reload of the whole canvas for nothing. And every pass Pixi begins
 * on a target that is not transient stores and loads its depth-stencil attachment, which the canvas has from its
 * first stencil mask on, so every filter break also stores and reloads stencil and depth that nothing reads.
 *
 * Three classes fix both through Pixi's registry, no patch: a subclass of `GpuRenderTargetSystem` whose adaptor (a
 * subclass of `GpuRenderTargetAdaptor`) defers a pass on the canvas, and a subclass of `PipelineSystem` that begins a
 * deferred pass when the first draw asks for its pipeline. In Pixi 8.22 every command recorded into a pass is preceded
 * by a call to the pipeline system: a draw by `getPipeline` (`GpuEncoderSystem.draw`) or `getBufferNamesToBind`
 * (`setGeometry`, the first call of a batch and of a graphics draw), a stencil reference by `setStencilMode`
 * (`GpuStencilSystem`), a render bundle by `bundleStateKey`. The encoder itself stays Pixi's, or the counting one of
 * the monitor, so a pass that never began is never counted.
 *
 * The canvas pass. A bind of the canvas with no pass open on it begins nothing: it ends the open pass, as Pixi's begin
 * would, and keeps the clear it asked for, owed. The pass begins at the first draw, with the owed clear, so a frame
 * clears its canvas exactly once, in the pass that draws first. A canvas bound with no draw before another target is
 * bound begins nothing at all; its clear waits for the next bind of the canvas. A read of the canvas (a backdrop
 * filter's copy) pays the owed clear first. At the end of the frame (`renderEnd`) an owed clear is paid, and a canvas
 * that saw no pass at all gets one, so a frame that never draws on it still clears and presents it, as Pixi's does. A
 * canvas with multisampling is left to Pixi (its restore copies the canvas).
 *
 * The depth-stencil rule, for the canvas only. Pixi's stencil masks count: a push draws the mask with `increment`
 * where the stencil equals the depth of the stack, its pop draws the same instructions with `decrement`, so with no
 * mask open the stencil is 0 everywhere a draw tests it. A canvas pass therefore loads the stencil only while a mask
 * is open on the canvas (`maskStackIndex > 0`), and clears it to 0 otherwise. It stores the stencil while a mask is
 * open, or when a mask was pushed on the canvas in this frame or the one before; else it discards it. A mask pushed
 * into a pass that discards (the first mask after frames without one) begins the pass again first, with the stencil
 * cleared and stored, so a mask that spans a filter break never loses what it drew. Depth is read only by a pipeline
 * that tests it and written only by one that writes it; Pixi's 2D pipes draw with `State.for2d()`, which does
 * neither, so the canvas clears and discards its depth until the first pipeline that tests or writes depth, which
 * begins the pass again with the depth cleared and stored, and stores it from then on (only `GpuEncoderSystem.draw`
 * carries such a state, and it asks for the pipeline before it sets anything, so the new pass misses nothing). A copy
 * of the canvas's depth keeps it too, from then on.
 *
 * The target change. A bind that changes the target makes Pixi's stencil system set its mode and its reference, and the
 * reference is a command of the pass. A render whose root canvas was not the last target bound (the first frame, a
 * frame after a kept picture was taken) would so begin its canvas pass at once. The render target system marks the
 * canvas bound before Pixi binds it, so that bind changes nothing, and the adaptor tells the stencil system right
 * after the pass began; a mask pushed first begins it before the stencil system reads its target.
 */
import type { PixiModule } from "../types";

/** Pixi's WebGPU render target system class, the base of the renderer's. */
type TargetSystemClass = PixiModule["GpuRenderTargetSystem"];

/** Pixi's WebGPU pipeline system class, the base of the renderer's. */
type PipelineClass = PixiModule["PipelineSystem"];

/** The WebGPU renderer the systems are made for. */
type GpuRenderer = ConstructorParameters<TargetSystemClass>[0];

/** Pixi's WebGPU render target adaptor. */
type BaseAdaptor = InstanceType<PixiModule["GpuRenderTargetAdaptor"]>;

/** The arguments of a pass Pixi begins. */
type PassArguments = Parameters<BaseAdaptor["startRenderPass"]>;

/** A render target. */
type RenderTarget = PassArguments[0];

/** What a pass clears: `CLEAR` bits, or a boolean for all or none. */
type ClearOrBool = NonNullable<PassArguments[1]>;

/** A clear colour. */
type Rgba = NonNullable<PassArguments[2]>;

/** The viewport of a pass. */
type Viewport = NonNullable<PassArguments[3]>;

/** Pixi's render target system, as its adaptor sees it. */
type TargetSystem = Parameters<BaseAdaptor["init"]>[1];

/** The root binding of a render. */
type RootOptions = Parameters<TargetSystem["renderStart"]>[0];

/** The arguments of a copy out of a render target. */
type CopyArguments = Parameters<BaseAdaptor["copyToTexture"]>;

/** The arguments of a copy of a render target's depth. */
type DepthCopyArguments = Parameters<BaseAdaptor["copyDepthTexture"]>;

/** The arguments of a pipeline request. */
type PipelineArguments = Parameters<InstanceType<PipelineClass>["getPipeline"]>;

/** The arguments of a vertex buffer lookup. */
type BufferArguments = Parameters<InstanceType<PipelineClass>["getBufferNamesToBind"]>;

/** A stencil mode. */
type StencilMode = Parameters<InstanceType<PipelineClass>["setStencilMode"]>[0];

/** Pixi's `CLEAR.NONE`. */
const CLEAR_NONE = 0;

/** Pixi's `CLEAR.ALL`: colour, depth and stencil. */
const CLEAR_ALL = 17_664;

/** Pixi's `CLEAR.COLOR`. */
const CLEAR_COLOR = 16_384;

/**
 * The `CLEAR` bits of a pass's clear, as Pixi reads a boolean. `clearBits(true); // 17664`
 *
 * @param clear - The clear Pixi was handed.
 * @returns The bits.
 */
function clearBits(clear: ClearOrBool): number {
  if (clear === true) return CLEAR_ALL;
  if (clear === false) return CLEAR_NONE;

  return clear;
}

/** The lazy canvas classes, for Pixi's registry: a render target system and a pipeline system. */
export type LazyCanvasClasses = {
  targets: TargetSystemClass;
  pipeline: PipelineClass;
};

/**
 * Builds the classes of the lazy canvas pass from the module object, at call time, because the bases arrive with the
 * lazily loaded module. Each system keeps its base's `static extension` object as it is, so the registry files it
 * under the same type and name. They cost one test of two booleans per pipeline request, and nothing else per draw.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The render target system and the pipeline system.
 */
export function createLazyCanvasClasses(pixi: PixiModule): LazyCanvasClasses {
  /**
   * Pixi's WebGPU adaptor, which begins a pass on the canvas at its first draw and sets the canvas's stencil and depth
   * operations by the rule of the file. One per renderer.
   */
  class LazyCanvasAdaptor extends pixi.GpuRenderTargetAdaptor {
    /** The canvas is bound and its pass has not begun: the pipeline system begins it at the first draw. */
    public pending = false;
    /** A pipeline that tests or writes depth was asked for: the canvas keeps its depth from then on. */
    public depthUsed = false;
    /** The renderer: Pixi's own `_renderer` is private. */
    private gpu: GpuRenderer | undefined = undefined;
    /** The render target system: Pixi's own `_renderTargetSystem` is private. */
    private targets: TargetSystem | undefined = undefined;
    /** The renderer's pipeline system is the lazy one: only then does a pass wait for a draw. */
    private hooked = false;
    /** The canvas whose pass is pending or whose clear is owed. */
    private canvas: RenderTarget | undefined = undefined;
    /** The `CLEAR` bits the canvas owes. */
    private owed = CLEAR_NONE;
    /** The colour of the owed clear, copied, when one was given. */
    private readonly owedColor: Rgba = [0, 0, 0, 0];
    /** `owedColor` holds the colour of the owed clear. */
    private owedColorSet = false;
    /** The viewport of the canvas's pass to come, copied from the bind that deferred it. */
    private readonly view = new pixi.Rectangle();
    /** The canvas whose pass this adaptor began and has not ended. */
    private openCanvas: RenderTarget | undefined = undefined;
    /** The open canvas pass stores its stencil. */
    private keepStencil = false;
    /** The open canvas pass stores its depth. */
    private keepDepth = false;
    /** The pass being begun stores its stencil. */
    private planStencil = false;
    /** The pass being begun stores its depth. */
    private planDepth = false;
    /** The canvas pass that ended last stored its depth. */
    private depthStored = false;
    /** A canvas pass began since the last `renderEnd`. */
    private acquired = false;
    /** A mask was pushed on the canvas in the last frame drawn on it. */
    private maskedBefore = false;
    /** A mask was pushed on the canvas in this frame. */
    private maskedNow = false;
    /** The root bind of the canvas emitted no target change: the stencil system hears of it when its pass begins. */
    private changeOwed = false;

    /**
     * Keeps the renderer and the render target system, then lets Pixi subscribe the adaptor.
     *
     * @param renderer - The WebGPU renderer.
     * @param renderTargetSystem - Its render target system.
     */
    public override init(renderer: GpuRenderer, renderTargetSystem: TargetSystem): void {
      super.init(renderer, renderTargetSystem);
      this.gpu = renderer;
      this.targets = renderTargetSystem;
    }

    /** Forgets every pass of the old device, then lets Pixi drop its restore helper. */
    public override contextChange(): void {
      super.contextChange();
      this.pending = false;
      this.canvas = undefined;
      this.owed = CLEAR_NONE;
      this.owedColorSet = false;
      this.openCanvas = undefined;
      this.depthStored = false;
      this.changeOwed = false;
    }

    /**
     * Tells whether the root bind of a render may skip its target change: the root is a canvas whose pass is deferred.
     * The adaptor then owes the stencil system the change, until the canvas pass begins or another target is bound.
     *
     * @param root - The root target of the render.
     * @returns True when the bind may skip the change.
     */
    public owesChange(root: RenderTarget): boolean {
      this.changeOwed = this.defers(root);

      return this.changeOwed;
    }

    /**
     * Begins a pass as Pixi does on any target but the canvas inside a frame. On the canvas it reuses an open pass as
     * Pixi does, and otherwise ends the open pass and defers the canvas's, its clear owed.
     *
     * @param renderTarget - The target.
     * @param clear - What to clear.
     * @param clearColor - The colour to clear to.
     * @param viewport - The viewport.
     * @param mipLevel - The mip level.
     * @param layer - The array layer.
     */
    public override startRenderPass(
      renderTarget: RenderTarget,
      clear: ClearOrBool = true,
      clearColor?: Rgba,
      viewport?: Viewport,
      mipLevel = 0,
      layer = 0
    ): void {
      if (viewport === undefined || mipLevel !== 0 || layer !== 0 || !this.defers(renderTarget)) {
        // Another target is bound: a pending canvas pass waits for the canvas's next bind, its clear still owed. The
        // bind emits its own target change.
        this.pending = false;
        this.openCanvas = undefined;
        this.changeOwed = false;
        super.startRenderPass(renderTarget, clear, clearColor, viewport, mipLevel, layer);

        return;
      }

      const bits = clearBits(clear);

      if (this.canvas !== undefined && this.canvas !== renderTarget) this.settleCanvas();

      if (bits === CLEAR_NONE && this.isOpen(renderTarget)) {
        this.beginCanvas(renderTarget, CLEAR_NONE, undefined, viewport);

        return;
      }

      this.finishRenderPass();
      this.canvas = renderTarget;
      this.pending = true;
      this.owe(bits, clearColor);
      this.view.copyFrom(viewport);
    }

    /** Ends the open pass, as Pixi does. */
    public override finishRenderPass(): void {
      super.finishRenderPass();
      this.openCanvas = undefined;
    }

    /**
     * Copies out of a render target, as Pixi does. A copy that reads or writes the canvas first pays the clear it owes,
     * or a first pass it never had; a canvas that had its pass in this render and owes nothing begins no empty one.
     *
     * @param source - The target copied from.
     * @param destination - The texture copied into.
     * @param from - The origin in the source.
     * @param size - The size of the copy.
     * @param to - The origin in the destination.
     * @returns The destination.
     */
    public override copyToTexture(
      source: CopyArguments[0],
      destination: CopyArguments[1],
      from: CopyArguments[2],
      size: CopyArguments[3],
      to: CopyArguments[4]
    ): ReturnType<BaseAdaptor["copyToTexture"]> {
      const canvas = this.canvas;

      if (
        canvas !== undefined &&
        (source === canvas || destination.source === canvas.colorTexture) &&
        (this.owed !== CLEAR_NONE || !this.acquired)
      ) {
        this.payOwed(canvas);
      }

      return super.copyToTexture(source, destination, from, size, to);
    }

    /**
     * Copies a render target's depth, as Pixi does; a copy of the canvas's depth makes the canvas keep its depth from
     * then on, and pays the clear it owes first.
     *
     * @param source - The target copied from.
     * @param destination - The depth texture copied into.
     * @param from - The origin in the source.
     * @param size - The size of the copy.
     * @param to - The origin in the destination.
     */
    public override copyDepthTexture(
      source: DepthCopyArguments[0],
      destination: DepthCopyArguments[1],
      from: DepthCopyArguments[2],
      size: DepthCopyArguments[3],
      to: DepthCopyArguments[4]
    ): void {
      if (this.isCanvas(source)) {
        this.depthUsed = true;

        if (source === this.canvas) this.payOwed(source);
      }

      super.copyDepthTexture(source, destination, from, size, to);
    }

    /** Begins the pending canvas pass, with the clear it owes: a draw is about to be recorded into it. */
    public beginPending(): void {
      const target = this.canvas;

      if (!this.pending || target === undefined) return;

      const bits = this.owed;
      const color = this.owedColorSet ? this.owedColor : undefined;

      this.pending = false;
      this.canvas = undefined;
      this.owed = CLEAR_NONE;
      this.owedColorSet = false;
      this.beginCanvas(target, bits, color, this.view);
    }

    /**
     * A pipeline that tests or writes depth was asked for: the canvas keeps its depth from now on, and an open canvas
     * pass that discards it begins again, with the depth cleared, as nothing wrote it yet, and stored.
     */
    public useDepth(): void {
      this.depthUsed = true;

      const canvas = this.openCanvas;

      if (canvas?.depthStencilAttachment !== undefined && !this.keepDepth && this.passOpen()) {
        this.restart(canvas);
      }
    }

    /**
     * A stencil mask is about to be pushed on the bound target: on the canvas, the stencil is kept from now on.
     *
     * @param target - The bound target.
     */
    public maskPushes(target: RenderTarget): void {
      if (this.isCanvas(target)) this.maskedNow = true;
    }

    /**
     * A stencil mask was pushed on the bound target: an open canvas pass that discards its stencil begins again, the
     * stencil cleared, as no mask was open, and stored, before the mask is drawn. A pending canvas pass whose target
     * change is owed begins now, so the stencil system knows its target before it sets the mask's mode.
     *
     * @param target - The bound target.
     */
    public maskPushed(target: RenderTarget): void {
      if (this.changeOwed && this.pending && this.canvas === target) {
        this.beginPending();
      } else if (this.openCanvas === target && !this.keepStencil && this.passOpen()) {
        this.restart(target);
      }
    }

    /**
     * The end of a render call: pays the clear the canvas owes, gives a canvas that saw no pass one, so the frame
     * clears and presents it as Pixi's does, and moves the mask memory on after a frame drawn on the canvas.
     *
     * @param root - The root target of the render call.
     */
    public settle(root: RenderTarget): void {
      this.settleCanvas();
      this.acquired = false;

      if (this.isCanvas(root)) {
        this.maskedBefore = this.maskedNow;
        this.maskedNow = false;
      }
    }

    /**
     * Tells whether a pass on a target waits for its first draw: the target is a canvas without multisampling, and the
     * renderer's pipeline system is the lazy one that begins it.
     *
     * @param target - The target.
     * @returns True when the pass is deferred.
     */
    private defers(target: RenderTarget): boolean {
      if (!this.hooked) this.hooked = this.gpu?.pipeline instanceof LazyCanvasPipeline;

      return this.hooked && this.isCanvas(target);
    }

    /**
     * Tells whether a target is a canvas without multisampling: Pixi gives a canvas's GPU target its context.
     *
     * @param target - The target.
     * @returns True for such a canvas.
     */
    private isCanvas(target: RenderTarget): boolean {
      const targets = this.targets;

      if (targets === undefined) return false;

      const gpuTarget = targets.getGpuRenderTarget(target);

      return gpuTarget.contexts.length > 0 && !gpuTarget.msaa;
    }

    /**
     * Tells whether a pass of the encoder is open.
     *
     * @returns True while one is.
     */
    private passOpen(): boolean {
      const encoder = this.gpu?.encoder;

      return encoder !== undefined && encoder.renderPassEncoder !== null;
    }

    /**
     * Tells whether the pass this adaptor began on a canvas is still open.
     *
     * @param target - The canvas.
     * @returns True when its pass is open.
     */
    private isOpen(target: RenderTarget): boolean {
      return this.openCanvas === target && this.passOpen();
    }

    /**
     * Adds a clear to the one the canvas owes; a colour clear given a colour keeps a copy of it.
     *
     * @param bits - The `CLEAR` bits.
     * @param color - The colour, when one was given.
     */
    private owe(bits: number, color: Rgba | undefined): void {
      const colour = bits & CLEAR_COLOR;

      this.owed |= bits;

      if (colour === 0) return;

      // Pixi hands `null` for no colour where its type says `undefined`.
      this.owedColorSet = Array.isArray(color);

      if (!Array.isArray(color)) return;

      this.owedColor[0] = color[0];
      this.owedColor[1] = color[1];
      this.owedColor[2] = color[2];
      this.owedColor[3] = color[3];
    }

    /**
     * Begins a pass on the canvas through Pixi, with the stencil and depth operations of the rule set on its
     * depth-stencil attachment first, where Pixi's descriptor reads them; a clear Pixi was asked for still wins. Pixi
     * reuses an open pass when nothing is cleared and nothing changed; a pass that really began is recorded.
     *
     * @param target - The canvas.
     * @param bits - The `CLEAR` bits.
     * @param color - The clear colour, when one was given.
     * @param viewport - The viewport.
     */
    private beginCanvas(
      target: RenderTarget,
      bits: number,
      color: Rgba | undefined,
      viewport: Viewport
    ): void {
      const gpu = this.gpu;
      const targets = this.targets;

      if (gpu === undefined || targets === undefined) return;

      this.planDepthStencil(target, targets);

      const before = gpu.encoder.renderPassEncoder;

      if (viewport !== this.view) this.view.copyFrom(viewport);

      super.startRenderPass(target, bits, color, viewport, 0, 0);
      this.openCanvas = target;

      if (gpu.encoder.renderPassEncoder !== before) this.began(target, targets);
    }

    /**
     * Sets the stencil and depth operations of the rule on the canvas's depth-stencil attachment, made first when
     * Pixi would make it, and keeps what the pass stores.
     *
     * @param target - The canvas.
     * @param targets - The render target system.
     */
    private planDepthStencil(target: RenderTarget, targets: TargetSystem): void {
      if ((target.stencil || target.depth) && target.depthStencilAttachment === undefined) {
        target.ensureDepthStencilTexture();
      }

      const attachment = target.depthStencilAttachment;
      const masked = targets.getGpuRenderTarget(target).maskStackIndex !== 0;

      this.planStencil = masked || this.maskedBefore || this.maskedNow;
      this.planDepth = this.depthUsed && attachment !== undefined;

      if (attachment === undefined) return;

      attachment.stencilLoadOp = masked ? "load" : "clear";
      attachment.stencilStoreOp = this.planStencil ? "store" : "discard";
      attachment.depthLoadOp = this.depthStored ? "load" : "clear";
      attachment.depthStoreOp = this.planDepth ? "store" : "discard";
    }

    /**
     * Records a canvas pass that really began (Pixi did not reuse the open one), and tells the stencil system of the
     * canvas when the root bind owes it the change, now that there is a pass to set its reference on.
     *
     * @param target - The canvas.
     * @param targets - The render target system.
     */
    private began(target: RenderTarget, targets: TargetSystem): void {
      this.acquired = true;
      this.keepStencil = this.planStencil;
      this.keepDepth = this.planDepth;
      this.depthStored = this.planDepth;

      if (this.changeOwed) {
        this.changeOwed = false;
        targets.onRenderTargetChange.emit(target);
      }
    }

    /**
     * Begins and ends one pass on a canvas now, with the clear it owes, and leaves the canvas bound with nothing owed.
     *
     * @param target - The canvas.
     */
    private payOwed(target: RenderTarget): void {
      const bits = this.owed;
      const color = this.owedColorSet ? this.owedColor : undefined;

      this.owed = CLEAR_NONE;
      this.owedColorSet = false;
      this.beginCanvas(target, bits, color, this.view);
      this.finishRenderPass();
    }

    /**
     * Ends the canvas's wait: pays the clear it owes, or a first pass it never had, and forgets it.
     */
    private settleCanvas(): void {
      const target = this.canvas;

      if (target === undefined) return;
      if (this.owed !== CLEAR_NONE || !this.acquired) this.payOwed(target);

      this.pending = false;
      this.canvas = undefined;
    }

    /**
     * Begins the open canvas pass again with nothing cleared, by the rule as it stands now, and sets its stencil
     * reference again: a new pass starts from 0, and Pixi sets it only when the mode or the target changes.
     *
     * @param target - The canvas.
     */
    private restart(target: RenderTarget): void {
      const gpu = this.gpu;
      const targets = this.targets;

      if (gpu === undefined || targets === undefined) return;

      this.finishRenderPass();
      this.beginCanvas(target, CLEAR_NONE, undefined, this.view);
      gpu.encoder.setStencilReference(targets.getGpuRenderTarget(target).stencilReference);
    }
  }

  /** Pixi's WebGPU render target system over the lazy adaptor, which settles the canvas at the end of a render. */
  class LazyCanvasTargets extends pixi.GpuRenderTargetSystem {
    public static override readonly extension = pixi.GpuRenderTargetSystem.extension;

    /** The adaptor, typed as the lazy one. */
    private readonly lazy: LazyCanvasAdaptor;

    /**
     * Makes Pixi's system, then puts the lazy adaptor in the place of Pixi's.
     *
     * @param renderer - The WebGPU renderer.
     */
    public constructor(renderer: GpuRenderer) {
      super(renderer);

      const lazy = new LazyCanvasAdaptor();

      lazy.init(renderer, this);
      this.adaptor = lazy;
      this.lazy = lazy;
    }

    /**
     * Starts a render as Pixi does; a root canvas whose pass is deferred is marked bound first, so Pixi's bind of it
     * emits no target change: the adaptor emits it when the pass begins.
     *
     * @param options - The root binding.
     */
    public override renderStart(options: RootOptions): void {
      const root = this.getRenderTarget(options.target);

      if (
        this.renderTarget !== root &&
        Boolean(root.flipY) === Boolean(options.flipY) &&
        this.lazy.owesChange(root)
      ) {
        this.renderTarget = root;
      }

      super.renderStart(options);
    }

    /** The end of a render call, before the encoder submits it: the canvas settles. */
    public renderEnd(): void {
      this.lazy.settle(this.rootRenderTarget);
    }

    /** Makes sure the bound target has a stencil for a mask about to be pushed, and keeps it by the rule. */
    public override ensureDepthStencil(): void {
      const target = this.renderTarget;

      this.lazy.maskPushes(target);
      super.ensureDepthStencil();
      this.lazy.maskPushed(target);
    }
  }

  /** Pixi's WebGPU pipeline system, which begins a deferred canvas pass before a draw or a stencil reference needs it. */
  class LazyCanvasPipeline extends pixi.PipelineSystem {
    public static override readonly extension = pixi.PipelineSystem.extension;

    /** The renderer: Pixi's own `_renderer` is private. */
    private readonly host: GpuRenderer;
    /** The lazy adaptor of the renderer, once found. */
    private lazy: LazyCanvasAdaptor | undefined = undefined;

    /**
     * Keeps the renderer it is made for.
     *
     * @param renderer - The WebGPU renderer.
     */
    public constructor(renderer: GpuRenderer) {
      super(renderer);
      this.host = renderer;
    }

    /**
     * Notes a state that tests or writes depth, begins a pending canvas pass, then answers Pixi's pipeline. Its five
     * arguments are named, not spread: a rest array would be made at every draw.
     *
     * @param geometry - The geometry.
     * @param program - The program.
     * @param state - The state.
     * @param topology - The topology.
     * @param overrides - The shader overrides.
     * @returns The pipeline.
     */
    public override getPipeline(
      geometry: PipelineArguments[0],
      program: PipelineArguments[1],
      state: PipelineArguments[2],
      topology?: PipelineArguments[3],
      overrides?: PipelineArguments[4]
    ): GPURenderPipeline {
      const lazy = this.lazy ?? this.link();

      if (lazy !== undefined) {
        if (!lazy.depthUsed && (state.depthTest || state.depthMask)) lazy.useDepth();
        if (lazy.pending) lazy.beginPending();
      }

      return super.getPipeline(geometry, program, state, topology, overrides);
    }

    /**
     * Begins a pending canvas pass, then answers Pixi's buffer names: the first call of a batch or a graphics draw.
     *
     * @param geometry - The geometry.
     * @param program - The program.
     * @returns The names of the buffers to bind.
     */
    public override getBufferNamesToBind(
      geometry: BufferArguments[0],
      program: BufferArguments[1]
    ): string[] {
      this.beginPending();

      return super.getBufferNamesToBind(geometry, program);
    }

    /**
     * Begins a pending canvas pass, then sets the stencil mode: the stencil system sets its reference on the pass next.
     *
     * @param stencilMode - The stencil mode.
     */
    public override setStencilMode(stencilMode: StencilMode): void {
      this.beginPending();
      super.setStencilMode(stencilMode);
    }

    /**
     * Begins a pending canvas pass, then answers Pixi's key: a render bundle is recorded or replayed next.
     *
     * @returns The key.
     */
    public override get bundleStateKey(): number {
      this.beginPending();

      return super.bundleStateKey;
    }

    /** Begins the pending canvas pass of the renderer, when there is one. */
    private beginPending(): void {
      const lazy = this.lazy ?? this.link();

      if (lazy?.pending === true) lazy.beginPending();
    }

    /**
     * Finds the renderer's lazy adaptor, once its render target system exists.
     *
     * @returns The adaptor, or `undefined` while there is none.
     */
    private link(): LazyCanvasAdaptor | undefined {
      const adaptor: unknown = this.host.renderTarget.adaptor;

      if (adaptor instanceof LazyCanvasAdaptor) this.lazy = adaptor;

      return this.lazy;
    }
  }

  return { targets: LazyCanvasTargets, pipeline: LazyCanvasPipeline };
}

/**
 * Swaps Pixi's WebGPU render target and pipeline systems for the lazy canvas ones in the module's extension registry,
 * and registers Pixi's stencil system again after them: the registry appends a class it is given, and the stencil
 * system subscribes to the render target system when it is made, so it must come later. Every application made
 * afterwards defers its canvas pass. The registry is global to the module object, so the remover matters: it puts
 * Pixi's own classes back, the stencil system again last.
 *
 * @param pixi - The loaded Pixi module.
 * @returns The remover.
 * @throws {TypeError} When the module has none of the classes to subclass.
 */
export function installLazyCanvasPass(pixi: PixiModule): () => void {
  const lazy = createLazyCanvasClasses(pixi);

  pixi.extensions.remove(pixi.GpuRenderTargetSystem, pixi.GpuStencilSystem, pixi.PipelineSystem);
  pixi.extensions.add(lazy.targets, pixi.GpuStencilSystem, lazy.pipeline);

  return (): void => {
    pixi.extensions.remove(lazy.targets, pixi.GpuStencilSystem, lazy.pipeline);
    pixi.extensions.add(pixi.GpuRenderTargetSystem, pixi.GpuStencilSystem, pixi.PipelineSystem);
  };
}
