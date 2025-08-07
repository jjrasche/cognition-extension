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

const loadModel = async (params) => {
  const { modelId, options } = params;
  if (pipelineCache.has(modelId)) return;
  const pipe = await Transformer.pipeline('feature-extraction', modelId, { device: 'webgpu', dtype: 'fp32', local_files_only: true, ...options})
    .catch(async () => await Transformer.pipeline('feature-extraction', modelId, { device: 'wasm', dtype: 'q8', local_files_only: true, ...options }));
  
}

const preloadModels = async () => {
  [...new Set(runtime.getModulesWithProperty('localModels').flatMap(module => module.manifest.localModels || []))]
    .forEach(async modelId => {
      try { await loadModel({ modelId }); runtime.log(`[Transformer] ✅ Loaded: ${modelId}`); } 
      catch (error) { runtime.logError(`[Transformer] ❌ Failed to load model ${modelId}:`, { error: error.message }); }
    });
  runtime.log(`[Transformer] Preloading complete. Cached models:`, listModels());
};

export const getModel = (modelId) => pipelineCache.get(modelId)
export const listModels = () => Array.from(pipelineCache.keys())
const clearCache = (modelId) => modelId ? pipelineCache.delete(modelId) : pipelineCache.clear();