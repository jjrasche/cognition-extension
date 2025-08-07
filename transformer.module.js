export const manifest = {
  name: 'transformer',
  context: "offscreen",
  version: "1.0.0",
  description: 'Hugging Face Transformers.js runtime for loading and caching ML pipelines',
  actions: ["getModel", "listModels", "testWebGPU"],
};

const pipelineCache = new Map();
let runtime;
let Transformer;
export const initialize = async (rt) => (runtime = rt, await initializeEnvironment() , await preloadModels());

const initializeEnvironment = async () => {
  Transformer = await loadTransformer();
  const env = Transformer.env;
  env.allowRemoteModels = false;
  env.useBrowserCache = false
  env.allowLocalModels = true;
  env.localModelPath = chrome.runtime.getURL('models/');
  if(env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('onnx-runtime/');
    env.backends.onnx.wasm.proxy = false;
  }
}

// Alternative loading method using dynamic import (cleaner for ES modules)
const loadTransformer = async () => {
  // try {
    const scriptUrl = chrome.runtime.getURL('libs/transformers.min.js');
    Transformer = await import(scriptUrl);
    return Transformer;
  // } catch (error) {
  //   runtime.logError('[Transformer] Failed to load via import:', error);
    
  //   // Fallback to fetch + eval (last resort)
  //   try {
  //     const response = await fetch(scriptUrl);
  //     const code = await response.text();
      
  //     // Create a module from the code
  //     const blob = new Blob([code], { type: 'application/javascript' });
  //     const blobUrl = URL.createObjectURL(blob);
      
  //     Transformer = await import(blobUrl);
      
  //     URL.revokeObjectURL(blobUrl);
  //     runtime.log('[Transformer] Library loaded via fetch + blob');
      
  //   } catch (fetchError) {
  //     throw fetchError;
  //   }
  // }
};

// const loadModel = async (params) => {
//   let { modelId, options } = params;
//   if (pipelineCache.has(modelId)) return;
//   options = { dtype: 'fp16', model_file_name: 'model_fp16.onnx', local_files_only: true, ...options };
//   const pipe = await Transformer.pipeline('feature-extraction', modelId, { device: 'webgpu', ...options})
//     .catch(async () => await Transformer.pipeline('feature-extraction', modelId, { device: 'wasm', options }));
//   pipelineCache.set(modelId, pipe);
// }
const loadModel = async (params) => {
  const { modelId, options = {} } = params;
  if (pipelineCache.has(modelId)) return pipelineCache.get(modelId);
  
  // Try WebGPU with fp16 first
  const webgpuOptions = {
    device: 'webgpu',
    dtype: 'fp16',
    local_files_only: true,
    ...options
  };
  
  try {
    const pipe = await Transformer.pipeline('feature-extraction', modelId, webgpuOptions);
    pipelineCache.set(modelId, pipe);
    return pipe;
  } catch (error) {
    console.warn('[Transformer] WebGPU failed, falling back to WASM:', error);
    
    const wasmOptions = {
      device: 'wasm', 
      dtype: 'fp32',  // WASM might not support fp16
      local_files_only: true,
      ...options
    };
    
    const pipe = await Transformer.pipeline('feature-extraction', modelId, wasmOptions);
    pipelineCache.set(modelId, pipe);
    return pipe;
  }
};

const preloadModels = async () => {
  [...new Set(runtime.getModulesWithProperty('localModels').flatMap(module => module.manifest.localModels || []))]
    .forEach(async modelId => {
      try { await loadModel({ modelId }); runtime.log(`[Transformer] ✅ Loaded: ${modelId}`); } 
      catch (error) { runtime.logError(`[Transformer] ❌ Failed to load model ${modelId}:`, { error: error.message }); }
    });
  runtime.log(`[Transformer] Preloading complete. Cached models:`, listModels());
};

export const getModel = (modelId) => {
  return pipelineCache.get(modelId);
}
export const listModels = () => Array.from(pipelineCache.keys())
const clearCache = (modelId) => modelId ? pipelineCache.delete(modelId) : pipelineCache.clear();


export const testWebGPU = async () => {
  const startTime = performance.now();
  
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    
    return {
      available: !!navigator.gpu,
      adapter: !!adapter,
      device: !!device,
      adapterInfo: adapter?.info || null,
      testTime: `${(performance.now() - startTime).toFixed(2)}ms`
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      testTime: `${(performance.now() - startTime).toFixed(2)}ms`
    };
  }
};