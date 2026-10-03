// Spike P10. Counts WebGPU calls by patching the prototypes before Pixi creates its device.

export const gpu = {
  renderPasses: 0,
  texturesCreated: 0,
  texturesDestroyed: 0,
  liveTextureBytes: 0,
  bindGroups: 0,
  buffersCreated: 0,
  buffersDestroyed: 0,
  writeBuffer: 0,
  writeBufferBytes: 0,
  pipelines: 0,
  shaderModules: 0,
  submits: 0,
  rtSizes: new Map<string, number>(),
  device: null as GPUDevice | null
};

const textureBytes = new WeakMap<GPUTexture, number>();

export function installGpuCounters() {
  const D = GPUDevice.prototype;
  const createTexture = D.createTexture;
  D.createTexture = function (desc: GPUTextureDescriptor) {
    gpu.device = this;
    const t = createTexture.call(this, desc);
    const size = desc.size as { width: number; height: number } | number[];
    const w = Array.isArray(size) ? (size[0] as number) : size.width;
    const h = Array.isArray(size) ? ((size[1] as number) ?? 1) : (size.height ?? 1);
    const bytes = w * h * 4 * (desc.sampleCount ?? 1);
    textureBytes.set(t, bytes);
    gpu.texturesCreated++;
    gpu.liveTextureBytes += bytes;
    if (desc.usage & GPUTextureUsage.RENDER_ATTACHMENT) {
      const key = `${w}x${h}`;
      gpu.rtSizes.set(key, (gpu.rtSizes.get(key) ?? 0) + 1);
    }
    return t;
  };
  const destroyTexture = GPUTexture.prototype.destroy;
  GPUTexture.prototype.destroy = function () {
    const bytes = textureBytes.get(this);
    if (bytes !== undefined) {
      gpu.texturesDestroyed++;
      gpu.liveTextureBytes -= bytes;
      textureBytes.delete(this);
    }
    return destroyTexture.call(this);
  };
  const createBindGroup = D.createBindGroup;
  D.createBindGroup = function (d: GPUBindGroupDescriptor) {
    gpu.bindGroups++;
    return createBindGroup.call(this, d);
  };
  const createBuffer = D.createBuffer;
  D.createBuffer = function (d: GPUBufferDescriptor) {
    gpu.buffersCreated++;
    return createBuffer.call(this, d);
  };
  const destroyBuffer = GPUBuffer.prototype.destroy;
  GPUBuffer.prototype.destroy = function () {
    gpu.buffersDestroyed++;
    return destroyBuffer.call(this);
  };
  const createRenderPipeline = D.createRenderPipeline;
  D.createRenderPipeline = function (d: GPURenderPipelineDescriptor) {
    gpu.pipelines++;
    return createRenderPipeline.call(this, d);
  };
  const createShaderModule = D.createShaderModule;
  D.createShaderModule = function (d: GPUShaderModuleDescriptor) {
    gpu.shaderModules++;
    return createShaderModule.call(this, d);
  };
  const beginRenderPass = GPUCommandEncoder.prototype.beginRenderPass;
  GPUCommandEncoder.prototype.beginRenderPass = function (d: GPURenderPassDescriptor) {
    gpu.renderPasses++;
    return beginRenderPass.call(this, d);
  };
  const writeBuffer = GPUQueue.prototype.writeBuffer;
  GPUQueue.prototype.writeBuffer = function (...args: Parameters<GPUQueue["writeBuffer"]>) {
    gpu.writeBuffer++;
    const data = args[2] as ArrayBufferView | ArrayBuffer;
    gpu.writeBufferBytes += args[4] !== undefined ? (args[4] as number) * ((data as ArrayBufferView).BYTES_PER_ELEMENT ?? 1) : data.byteLength;
    return writeBuffer.apply(this, args);
  };
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (b: Iterable<GPUCommandBuffer>) {
    gpu.submits++;
    return submit.call(this, b);
  };
}

export function snapshot() {
  const { rtSizes, device, ...rest } = gpu;
  return { ...rest, liveTextures: gpu.texturesCreated - gpu.texturesDestroyed, liveBuffers: gpu.buffersCreated - gpu.buffersDestroyed };
}
