export const manifest = {
  name: 'transformer',
  context: "offscreen",
  version: "1.0.0",
  description: 'Hugging Face Transformers.js runtime with WebGPU/WebNN support',
  actions: ["getModel", "listModels", "diagnoseGPU", "verifyOnnxFiles", "checkExecutionProviders", "testWebNN", "testCPUvsGPU"],
};

const pipelineCache = new Map();
let runtime;
let Transformer;

export const initialize = async (rt) => {
  runtime = rt;
  await initializeEnvironment();
  await preloadModels();
  await loadForTest();
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
  
  runtime.log('[Transformer] ✅ Environment configured');
  
  // CRITICAL: Force initialize execution providers
  await forceInitializeExecutionProviders();
  
  // Log available backends
  if (env.backends?.onnx) {
    runtime.log('[Transformer] Available ONNX backends:', Object.keys(env.backends.onnx));
  }
};

const forceInitializeExecutionProviders = async () => {
  try {
    runtime.log('[Transformer] Force initializing execution providers...');
    
    const env = Transformer.env;
    const ort = env.backends?.onnx;
    
    if (!ort) {
      runtime.logError('[Transformer] ONNX backend not available');
      return;
    }
    
    // Method 1: Try to manually initialize WebGPU
    if (ort.webgpu && typeof ort.webgpu.init === 'function') {
      try {
        await ort.webgpu.init();
        runtime.log('[Transformer] ✅ WebGPU execution provider initialized');
      } catch (error) {
        runtime.logError('[Transformer] WebGPU init failed:', error);
      }
    }
    
    // Method 2: Try to manually initialize WASM
    if (ort.wasm && typeof ort.wasm.init === 'function') {
      try {
        await ort.wasm.init();
        runtime.log('[Transformer] ✅ WASM execution provider initialized');
      } catch (error) {
        runtime.logError('[Transformer] WASM init failed:', error);
      }
    }
    
    // Method 3: Force set execution providers list
    try {
      ort.executionProviders = ['webgpu', 'wasm', 'cpu'];
      runtime.log('[Transformer] ✅ Forced execution providers:', ort.executionProviders);
    } catch (error) {
      runtime.logError('[Transformer] Failed to set execution providers:', error);
    }
    
    // Method 4: Try to trigger provider registration
    try {
      // Create a minimal session to trigger provider initialization
      const modelUrl = chrome.runtime.getURL('models/Xenova/all-MiniLM-L6-v2/onnx/model.onnx');
      const testOptions = {
        executionProviders: ['webgpu', 'wasm'],
        logSeverityLevel: 0
      };
      
      // Import ONNX Runtime directly
      const ortModule = await import(chrome.runtime.getURL('onnx-runtime/ort.webgpu.mjs'));
      const ortSession = await ortModule.InferenceSession.create(modelUrl, testOptions);
      runtime.log('[Transformer] ✅ Test session created with execution providers');
      
      // Update our reference to the initialized ONNX runtime
      if (ortModule.env?.backends?.onnx) {
        Object.assign(ort, ortModule.env.backends.onnx);
      }
      
    } catch (error) {
      runtime.logError('[Transformer] Test session creation failed:', error);
    }
    
  } catch (error) {
    runtime.logError('[Transformer] Force initialization failed:', error);
  }
};

const loadTransformer = async () => {
  try {
    const scriptUrl = chrome.runtime.getURL('libs/transformers.js');
    const transformer = await import(scriptUrl);
    runtime.log('[Transformer] ✅ Transformers.js loaded successfully');
    return transformer;
  } catch (error) {
    runtime.logError('[Transformer] ❌ Failed to load Transformers.js:', error);
    throw error;
  }
};

const loadModel = async (params) => {
  const { modelId, options = {} } = params;
  if (pipelineCache.has(modelId)) return pipelineCache.get(modelId);
  
  runtime.log(`[Transformer] Loading model ${modelId}...`);
  
  // Try execution providers in order of preference
  const executionProviders = [
    { device: 'webgpu', fallback: 'WebGPU acceleration' },
    { device: 'webnn', fallback: 'WebNN acceleration' },
    { device: 'wasm', fallback: 'WASM CPU execution' }
  ];
  
  for (const provider of executionProviders) {
    try {
      const pipelineOptions = {
        device: provider.device,
        dtype: provider.device === 'webgpu' ? 'fp16' : 'q8',
        local_files_only: true,
        ...options
      };
      
      runtime.log(`[Transformer] Attempting ${provider.fallback} with device: ${provider.device}`);
      
      const pipe = await Transformer.pipeline('feature-extraction', modelId, pipelineOptions);
      
      runtime.log(`[Transformer] ✅ Successfully loaded ${modelId} with ${provider.fallback}`);
      pipelineCache.set(modelId, pipe);
      return pipe;
      
    } catch (error) {
      runtime.logError(`[Transformer] ${provider.fallback} failed:`, error);
      
      // If this is the last provider, throw the error
      if (provider === executionProviders[executionProviders.length - 1]) {
        throw error;
      }
      // Otherwise, continue to next provider
    }
  }
};

const preloadModels = async () => {
  const modelIds = [...new Set(
    runtime.getModulesWithProperty('localModels')
      .flatMap(module => module.manifest.localModels || [])
  )];
  
  runtime.log(`[Transformer] Preloading ${modelIds.length} models...`);
  
  for (const modelId of modelIds) {
    try {
      await loadModel({ modelId });
      runtime.log(`[Transformer] ✅ Preloaded: ${modelId}`);
    } catch (error) {
      runtime.logError(`[Transformer] ❌ Failed to preload ${modelId}:`, error);
    }
  }
  
  runtime.log(`[Transformer] Preloading complete. Cached models:`, listModels());
};

const loadForTest = async (modelId) => {
  const webgpuModel = await Transformer.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'webgpu' });
  const wasmModel = await Transformer.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'wasm' });
  
  // Try to load WebNN model
  let webnnModel = null;
  try {
    webnnModel = await Transformer.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'webnn' });
    console.log('✅ WebNN model loaded successfully');
  } catch (error) {
    console.log('❌ WebNN model failed to load:', error.message);
    
    // WebNN might not be supported in Transformers.js device option
    // Try direct ONNX Runtime approach
    try {
      const ortModule = await import(chrome.runtime.getURL('onnx-runtime/ort.webgpu.mjs'));
      const modelUrl = chrome.runtime.getURL('models/Xenova/all-MiniLM-L6-v2/onnx/model.onnx');
      
      const webnnSession = await ortModule.InferenceSession.create(modelUrl, {
        executionProviders: [{
          name: 'webnn',
          deviceType: 'gpu',
          powerPreference: 'high-performance'
        }]
      });
      
      console.log('✅ Direct WebNN session created');
      // Store the session for manual inference
      pipelineCache.set('webnn-session-all-MiniLM-L6-v2', webnnSession);
      
    } catch (sessionError) {
      console.log('❌ Direct WebNN session failed:', sessionError.message);
    }
  }
  
  pipelineCache.set('webgpu-all-MiniLM-L6-v2', webgpuModel);
  pipelineCache.set('wasm-all-MiniLM-L6-v2', wasmModel);
  
  if (webnnModel) {
    pipelineCache.set('webnn-all-MiniLM-L6-v2', webnnModel);
  }
  
  console.log('Loaded models:', Array.from(pipelineCache.keys()));
}
export const getModel = (modelId) => pipelineCache.get(modelId);
export const listModels = () => Array.from(pipelineCache.keys());

export const diagnoseGPU = async () => {
  const diagnosis = {
    timestamp: new Date().toISOString(),
    webgpu: {},
    webnn: {},
    onnx: {},
    transformers: {}
  };
  
  // Test WebGPU
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
          architecture: adapter.info?.architecture || 'unknown'
        };
        
        const device = await adapter.requestDevice();
        diagnosis.webgpu.device = !!device;
        diagnosis.webgpu.features = device ? Array.from(device.features) : [];
      }
    }
  } catch (error) {
    diagnosis.webgpu.error = error.message;
  }
  
  // Test WebNN
  try {
    diagnosis.webnn.available = 'ml' in navigator;
    diagnosis.webnn.contextSupported = typeof navigator.ml?.createContext === 'function';
    
    if (diagnosis.webnn.available && diagnosis.webnn.contextSupported) {
      // Try to create a context
      const context = await navigator.ml.createContext({ deviceType: 'gpu' });
      diagnosis.webnn.contextCreated = !!context;
    }
  } catch (error) {
    diagnosis.webnn.error = error.message;
  }
  
  // Test ONNX backends
  try {
    const env = Transformer.env;
    diagnosis.onnx.backends = Object.keys(env.backends || {});
    diagnosis.onnx.webgpu_available = !!env.backends?.onnx?.webgpu;
    diagnosis.onnx.webnn_available = !!env.backends?.onnx?.webnn;
  } catch (error) {
    diagnosis.onnx.error = error.message;
  }
  
  return diagnosis;
};

export const verifyOnnxFiles = async () => {
  const onnxDir = 'onnx-runtime/';
  const expectedFiles = [
    'ort.webgpu.mjs',                    // WebGPU support
    'ort-wasm-simd-threaded.jsep.wasm',  // JSEP WASM (WebGPU/WebNN)
    'ort-wasm-simd-threaded.wasm',       // Standard WASM
    'ort.webgpu.min.js',                 // Alternative WebGPU
    'ort-web.min.js',                    // Standard web
    'ort.min.js'                        // Basic ONNX
  ];
  
  const results = {
    timestamp: new Date().toISOString(),
    baseUrl: chrome.runtime.getURL(onnxDir),
    files: {}
  };
  
  for (const file of expectedFiles) {
    try {
      const url = chrome.runtime.getURL(onnxDir + file);
      const response = await fetch(url);
      
      results.files[file] = {
        exists: response.ok,
        status: response.status,
        size: response.headers.get('content-length'),
        type: response.headers.get('content-type')
      };
      
      if (response.ok) {
        runtime.log(`[ONNX Check] ✅ ${file} - ${results.files[file].size} bytes`);
      } else {
        runtime.log(`[ONNX Check] ❌ ${file} - Status ${response.status}`);
      }
      
    } catch (error) {
      results.files[file] = { exists: false, error: error.message };
      runtime.logError(`[ONNX Check] ❌ ${file} - ${error.message}`);
    }
  }
  
  return results;
};

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

export const testWebNN = async () => {
  try {
    // Check if WebNN API is available
    if (!('ml' in navigator)) {
      return { 
        available: false, 
        error: 'WebNN API not available in navigator' 
      };
    }
    
    runtime.log('[Transformer] WebNN API detected, testing context creation...');
    
    const results = {
      available: true,
      contexts: {}
    };
    
    // Test different device types
    const deviceTypes = ['cpu', 'gpu', 'npu'];
    
    for (const deviceType of deviceTypes) {
      try {
        const context = await navigator.ml.createContext({ deviceType });
        results.contexts[deviceType] = {
          success: true,
          context: !!context
        };
        runtime.log(`[WebNN] ✅ ${deviceType} context created successfully`);
      } catch (error) {
        results.contexts[deviceType] = {
          success: false,
          error: error.message
        };
        runtime.log(`[WebNN] ❌ ${deviceType} context failed: ${error.message}`);
      }
    }
    
    return results;
    
  } catch (error) {
    return { 
      available: false, 
      error: error.message 
    };
  }
};