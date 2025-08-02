// Import from bundled file (will be available globally)
// transformers.min.js must be loaded first via importScripts or script tag

export const manifest = {
  name: "embedding", 
  version: "1.0.0",
  description: "Local text embedding generation using transformers.js with WebGPU",
  permissions: [],
  actions: ["embedText"],
  state: { reads: [], writes: [] }
};

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
let cachedPipeline = null;

export const initialize = async () => {
  // Import the bundled transformers.js
  if (typeof importScripts !== 'undefined') {
    importScripts('./lib/transformers.min.js');
  }
  
  // Configure environment
  if (globalThis.Transformers) {
    const { env } = globalThis.Transformers;
    env.allowRemoteModels = false;
    env.localModelPath = '/models/';
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
    }
  }
};

export const embedText = async (params) => {
  const { text, timeout = 30000 } = params;
  !text && (() => { throw new Error('Text required'); })();
  
  await ensurePipeline(timeout);
  const output = await cachedPipeline(text, { pooling: 'mean', normalize: true });
  const embedding = Array.isArray(text) ? output.tolist() : output.tolist()[0];
  return { success: true, embedding };
};

const ensurePipeline = async (timeout) => {
  if (cachedPipeline) return;
  
  if (!globalThis.Transformers) {
    throw new Error('Transformers.js not loaded. Ensure transformers.min.js is imported.');
  }
  
  const { pipeline } = globalThis.Transformers;
  
  const loadPromise = pipeline('feature-extraction', MODEL_ID, {
    device: 'webgpu'
  }).catch(() => 
    pipeline('feature-extraction', MODEL_ID, { device: 'cpu' })
  );
  
  cachedPipeline = await Promise.race([
    loadPromise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Model load timeout after ${timeout}ms`)), timeout)
    )
  ]);
};