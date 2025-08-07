export const manifest = {
  name: "embedding", 
  keywords: ["embed"],
  context: "offscreen",
  dependencies: ["transformer"],
  version: "1.0.0",
  description: "use local embedding models to embed text",
  actions: ["embedText"],
  externalDependencies: [
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_fp16.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: '2CDB5E58291813B6D6E248ED69010100246821A367FA17B1B81AE9483744533D' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_q4f16.onnx', destination: 'models/Xenova/all-MiniLM-L6-v2/onnx/', sha256: 'EB08A666C46109637E0B6CB04F6052A68EFD59BB0252D4E0438D28FB6B2D853D' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer.json', destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: 'DA0E79933B9ED51798A3AE27893D3C5FA4A201126CEF75586296DF9B4D2C62A0' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json', destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: '9261E7D79B44C8195C1CADA2B453E55B00AEB81E907A6664974B4D7776172AB3' },
    { url: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json',  destination: 'models/Xenova/all-MiniLM-L6-v2/', sha256: '7135149F7CFFA1A573466C6E4D8423ED73B62FD2332C575BF738A0D033F70DF7' }
  ],
  localModels : [
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'fp16', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'fp16', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'webgpu', dtype: 'q4f16', local_files_only: true } },
    { name: "Xenova/all-MiniLM-L6-v2", options: { device: 'wasm', dtype: 'q4f16', local_files_only: true } },
  ]
};

  // const executionProviders = [
  //   { device: 'webgpu', fallback: 'WebGPU acceleration' },
  //   { device: 'wasm', fallback: 'WASM CPU execution' }
  //   // { device: 'webnn', fallback: 'WebNN acceleration' },
  // ];

let runtime;
export const initialize = async (rt) => runtime = rt;

export const getModelName = async (model) => await runtime.call('transformer.getModelName', model);
export const embedText = async (params) => {
  const { text, modelName } = params;
  if (!text) throw new Error('Text required');
  
  const startTime = performance.now();
  const model = await runtime.call('transformer.getModel', modelName || (await getModelName(manifest.localModels[0])));
  if (!model) throw new Error('Model not loaded');
    
  runtime.log(`[Embedding] About to run inference with text: "${text.substring(0, 50)}..."`);
  
  // Try to get more device info from the actual inference
  const result = await model(text, { 
    pooling: 'mean',
    normalize: true,
    return_tensor: false  // This might give us more device info
  });
  
  const endTime = performance.now();
  runtime.log(`[Embedding] Inference completed in ${(endTime - startTime).toFixed(2)}ms`);
  runtime.log(`[Embedding] Result structure:`, Object.keys(result));
  
  return {
    embedding: result,
    dimensions: result.ort_tensor?.dims || 'unknown',
    processingTime: `${(endTime - startTime).toFixed(2)}ms`,
    modelUsed: manifest.localModels[0],
    device: result.ort_tensor?.dataLocation || 'unknown',
    tensorInfo: {
      type: result.ort_tensor?.type,
      size: result.ort_tensor?.size,
      dims: result.ort_tensor?.dims
    }
  };
};