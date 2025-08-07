export const manifest = {
  name: 'transformer',
  context: "offscreen",
  version: "1.0.0",
  description: 'Hugging Face Transformers.js runtime with WebGPU/WebNN support',
  actions: ["getModel", "listModels", "getModelName"],
  externalDependencies: [
    { name: 'transformers.js', destination: 'libs/', url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/transformers.js', sha256: '5EA4225E8819337274E171D7D80EFA3BEF97F2678EDD33949184A72322CC9CC5' },
    { name: 'onnx-runtime-webgpu', destination: 'onnx-runtime/', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.mjs', sha256: 'C4FE924C20A6C53B64F6F1C6842F28DEF2659817F80F04628D906015BA21F655' },
    { name: 'ort-wasm-simd-threaded.jsep.mjs', destination: 'onnx-runtime/', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.mjs', sha256: '1CBCBA8F2C769C1EECBAB66A1B1E55EF11704515BF4306373E3DB3C37CF6DCD8' },
    { name: 'ort-wasm-simd-threaded.jsep.wasm', destination: 'onnx-runtime/', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.wasm', sha256: 'B45970D0632383A057C27CA5B660B216F8E00C17CF8DB9F6207B5E4ABC839368' },
    { name: 'ort-wasm-simd-threaded.wasm', destination: 'onnx-runtime/', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.wasm', sha256: '71AEF04959C5C1B6DE461B6538E2058E306610034A85AAD2742D0C7FD4533FE4' }
  ]
};

const pipelineCache = new Map();
let runtime;
let Transformer;

export const initialize = async (rt) => {
  runtime = rt;
  await initializeEnvironment();
  await preloadModels();
};

const initializeEnvironment = async () => {
  runtime.log('[Transformer] Loading Transformers.js library...');
  Transformer = await loadTransformer();
  
  const env = Transformer.env;  
  // Configure environment
  env.allowRemoteModels = false;
  env.useBrowserCache = false;
  env.allowLocalModels = true;
  env.localModelPath = chrome.runtime.getURL('models/');
  
  // Configure WASM paths for JSEP (WebGPU/WebNN support)
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('onnx-runtime/');
    env.backends.onnx.wasm.proxy = false;
  }
  
  // CRITICAL: Force initialize execution providers
  // await forceInitializeExecutionProviders();
  
  // Log available backends
  if (env.backends?.onnx) {
    runtime.log('[Transformer] Available ONNX backends:', Object.keys(env.backends.onnx));
  }
};

// const forceInitializeExecutionProviders = async () => {
//   try {
//     runtime.log('[Transformer] Force initializing execution providers...');
    
//     const env = Transformer.env;
//     const ort = env.backends?.onnx;
    
//     if (!ort) {
//       runtime.logError('[Transformer] ONNX backend not available');
//       return;
//     }
    
//     // Method 1: Try to manually initialize WebGPU
//     if (ort.webgpu && typeof ort.webgpu.init === 'function') {
//       try {
//         await ort.webgpu.init();
//         runtime.log('[Transformer] ✅ WebGPU execution provider initialized');
//       } catch (error) {
//         runtime.logError('[Transformer] WebGPU init failed:', error);
//       }
//     }
    
//     // Method 2: Try to manually initialize WASM
//     if (ort.wasm && typeof ort.wasm.init === 'function') {
//       try {
//         await ort.wasm.init();
//         runtime.log('[Transformer] ✅ WASM execution provider initialized');
//       } catch (error) {
//         runtime.logError('[Transformer] WASM init failed:', error);
//       }
//     }
    
//     // Method 3: Force set execution providers list
//     try {
//       ort.executionProviders = ['webgpu', 'wasm', 'cpu'];
//       runtime.log('[Transformer] ✅ Forced execution providers:', ort.executionProviders);
//     } catch (error) {
//       runtime.logError('[Transformer] Failed to set execution providers:', error);
//     }
    
//     // Method 4: Try to trigger provider registration
//     try {
//       // Create a minimal session to trigger provider initialization
//       const modelUrl = chrome.runtime.getURL('models/Xenova/all-MiniLM-L6-v2/onnx/model.onnx');
//       const testOptions = {
//         dtype: 'fp16',
//         model_file_name: 'model.onnx',
//         executionProviders: ['webgpu', 'wasm'],
//         logSeverityLevel: 0
//       };
      
//       // Import ONNX Runtime directly
//       const ortModule = await import(chrome.runtime.getURL('onnx-runtime/ort.webgpu.mjs'));
//       const ortSession = await ortModule.InferenceSession.create(modelUrl, testOptions);
//       runtime.log('[Transformer] ✅ Test session created with execution providers');
      
//       // Update our reference to the initialized ONNX runtime
//       if (ortModule.env?.backends?.onnx) {
//         Object.assign(ort, ortModule.env.backends.onnx);
//       }
      
//     } catch (error) {
//       runtime.logError('[Transformer] Test session creation failed:', error);
//     }
    
//   } catch (error) {
//     runtime.logError('[Transformer] Force initialization failed:', error);
//   }
// };

const loadTransformer = async () => await import(chrome.runtime.getURL('libs/transformers.js'));

const preloadModels = async () => {
  const models = [...new Set(runtime.getModulesWithProperty('localModels').flatMap(module => module.manifest.localModels))];
  for (const model of models) {
    try { await loadModel(model) } 
    catch (error) { runtime.logError(`[Transformer] ❌ Failed to preload ${model}:`, error) }
  }  
  runtime.log(`[Transformer] Preloaded models:`, listModels());
};
const loadModel = async (model) => {
  const name = getModelName(model);
  if (pipelineCache.has(name)) return pipelineCache.get(name);
  runtime.log(`[Transformer] Loading model ${name}...`);
  try {
    const pipe = await Transformer.pipeline('feature-extraction', name, model.options || {});
    pipelineCache.set(name, pipe);
  } catch (error) { runtime.logError(`[Transformer] loading ${name} failed:`, error) }
};
export const getModel = (modelId) => pipelineCache.get(modelId);
export const listModels = () => Array.from(pipelineCache.keys());
export const getModelName = (model) => `${model.name}-${model.options.dtype}-${model.options.device}`;





// testing remove
export const checkExecutionProviders = async () => {
  try {
    const env = Transformer.env;
    const ort = env.backends?.onnx;
    
    if (!ort) {
      return { error: 'ONNX backend not available' };
    }
    
    return {
      ortVersion: ort.version || 'unknown',
      availableProviders: ort.availableProviders || [],
      webgpuSupported: ort.webgpu ? Object.keys(ort.webgpu) : [],
      webgpuInitialized: typeof ort.webgpu?.init === 'function',
      webnnSupported: ort.webnn ? Object.keys(ort.webnn) : [],
      currentProviders: ort.executionProviders || 'not set'
    };
    
  } catch (error) {
    return { error: error.message };
  }
};
