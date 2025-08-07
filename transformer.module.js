export const manifest = {
  name: 'transformer',
  context: "offscreen",
  version: "1.0.0",
  description: 'Hugging Face Transformers.js runtime for loading and caching ML pipelines',
  actions: ["getModel", "listModels", "diagnoseGPU", "verifyOnnxFiles", "debugOnnxBackends", "checkExecutionProviders"],
};

const pipelineCache = new Map();
let runtime;
let Transformer;
export const initialize = async (rt) => (runtime = rt, await initializeEnvironment() , await preloadModels());

// const initializeEnvironment = async () => {
//   Transformer = await loadTransformer();
//   const env = Transformer.env;
//   env.allowRemoteModels = false;
//   env.useBrowserCache = false
//   env.allowLocalModels = true;
//   env.localModelPath = chrome.runtime.getURL('models/');
//   if(env.backends?.onnx?.wasm) {
//     env.backends.onnx.wasm.numThreads = 1;
//     env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('onnx-runtime/');
//     env.backends.onnx.wasm.proxy = false;
//   }
// }
const initializeEnvironment = async () => {
  Transformer = await loadTransformer();
  const env = Transformer.env;
  
  // Configure paths
  env.allowRemoteModels = false;
  env.useBrowserCache = false;
  env.allowLocalModels = true;
  env.localModelPath = chrome.runtime.getURL('models/');
  
  // Configure WASM paths
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('onnx-runtime/');
    env.backends.onnx.wasm.proxy = false;
  }
  
  // CRITICAL: Initialize WebGPU backend explicitly
  try {
    // Initialize WebGPU backend
    await env.backends.onnx.webgpu.init?.();
    runtime.log('[Transformer] WebGPU backend initialized');
    
    // Set WebGPU as preferred execution provider
    env.backends.onnx.webgpu.preferredExecutionProviders = ['webgpu', 'wasm'];
    
  } catch (error) {
    runtime.logError('[Transformer] WebGPU backend initialization failed:', error);
  }
};

// Alternative loading method using dynamic import (cleaner for ES modules)
const loadTransformer = async () => {
  // try {
    const scriptUrl = chrome.runtime.getURL('libs/transformers.js');
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
  
  runtime.log(`[Transformer] Loading model ${modelId}...`);
  
  // Use execution providers instead of device
  const webgpuOptions = {
    executionProviders: ['webgpu', 'wasm'],  // Instead of device: 'webgpu'
    dtype: 'fp16',
    local_files_only: true,
    ...options
  };
  
  runtime.log(`[Transformer] Attempting WebGPU with options:`, webgpuOptions);
  
  try {
    const pipe = await Transformer.pipeline('feature-extraction', modelId, webgpuOptions);
    runtime.log(`[Transformer] ✅ WebGPU pipeline created successfully`);
    
    pipelineCache.set(modelId, pipe);
    return pipe;
  } catch (error) {
    runtime.logError(`[Transformer] WebGPU failed:`, error);
    // Fallback...
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


export const diagnoseGPU = async () => {
  const diagnosis = {
    timestamp: new Date().toISOString(),
    webgpu: {},
    onnx: {},
    transformers: {}
  };
  
  // Test WebGPU directly
  try {
    diagnosis.webgpu.available = !!navigator.gpu;
    
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance'
      });
      diagnosis.webgpu.adapter = !!adapter;
      
      if (adapter) {
        diagnosis.webgpu.adapterInfo = {
          vendor: adapter.info?.vendor || 'unknown',
          architecture: adapter.info?.architecture || 'unknown',
          device: adapter.info?.device || 'unknown'
        };
        
        const device = await adapter.requestDevice();
        diagnosis.webgpu.device = !!device;
        
        if (device) {
          diagnosis.webgpu.features = Array.from(device.features);
          diagnosis.webgpu.limits = Object.fromEntries(
            Object.entries(device.limits).slice(0, 5) // First 5 limits
          );
        }
      }
    }
  } catch (error) {
    diagnosis.webgpu.error = error.message;
  }
  
  // Test ONNX WebGPU support
  try {
    // This might reveal ONNX-specific WebGPU issues
    const env = Transformer.env;
    diagnosis.onnx.backends = Object.keys(env.backends || {});
    diagnosis.onnx.webgpu_available = env.backends?.webgpu ? true : false;
    
  } catch (error) {
    diagnosis.onnx.error = error.message;
  }
  
  return diagnosis;
};


export const verifyOnnxFiles = async () => {
  const onnxDir = 'onnx-runtime/';
  const expectedFiles = [
    'ort.webgpu.mjs',
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.wasm',
    'ort.webgpu.min.js',                    // Alternative WebGPU file
    'ort-web.min.js',                       // Standard ONNX web
    'ort.min.js'                           // Basic ONNX
  ];
  
  const results = {
    timestamp: new Date().toISOString(),
    baseUrl: chrome.runtime.getURL(onnxDir),
    files: {}
  };
  
  for (const file of expectedFiles) {
    try {
      const url = chrome.runtime.getURL(onnxDir + file);
      runtime.log(`[ONNX Check] Checking ${url}`);
      
      const response = await fetch(url);
      
      results.files[file] = {
        exists: response.ok,
        status: response.status,
        size: response.headers.get('content-length'),
        type: response.headers.get('content-type'),
        url: url
      };
      
      if (response.ok) {
        runtime.log(`[ONNX Check] ✅ ${file} - ${results.files[file].size} bytes`);
      } else {
        runtime.log(`[ONNX Check] ❌ ${file} - Status ${response.status}`);
      }
      
    } catch (error) {
      results.files[file] = {
        exists: false,
        error: error.message
      };
      runtime.logError(`[ONNX Check] ❌ ${file} - ${error.message}`);
    }
  }
  
  // Also check what's actually in the onnx-runtime directory
  try {
    const dirUrl = chrome.runtime.getURL(onnxDir);
    runtime.log(`[ONNX Check] Base directory: ${dirUrl}`);
  } catch (error) {
    results.directoryError = error.message;
  }
  
  return results;
};

export const debugOnnxBackends = async () => {
  const env = Transformer.env;
  
  return {
    env_backends: Object.keys(env.backends || {}),
    onnx_backend_details: env.backends.onnx,
    webgpu_in_onnx: 'webgpu' in (env.backends || {}),
    available_providers: env.backends.onnx?.availableProviders || 'unknown'
  };
};


export const checkExecutionProviders = async () => {
  try {
    const env = Transformer.env;
    
    // Try to access ONNX runtime directly
    const ort = env.backends.onnx;
    
    return {
      ortVersion: ort.version || 'unknown',
      availableProviders: ort.availableProviders || [],
      webgpuSupported: ort.webgpu ? Object.keys(ort.webgpu) : [],
      webgpuInitialized: typeof ort.webgpu?.init === 'function',
      currentProviders: ort.executionProviders || 'not set'
    };
    
  } catch (error) {
    return { error: error.message };
  }
};