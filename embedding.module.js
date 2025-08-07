export const manifest = {
  name: "embedding", 
  keywords: ["embed"],
  context: "offscreen",
  dependencies: ["transformer"],
  version: "1.0.0",
  description: "use local embedding models to embed text",
  actions: ["embedText"],
  localModels : ["Xenova/all-MiniLM-L6-v2"],
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const embedText = async (params) => {
  const { text } = params;
  if (!text) throw new Error('Text required');
  
  const startTime = performance.now();
  const model = await runtime.call('transformer.getModel', manifest.localModels[0]);
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