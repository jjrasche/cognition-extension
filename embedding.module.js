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
  !text && (() => { throw new Error('Text required'); })();
  const startTime = performance.now();
  const model = await runtime.call('transformer.getModel', manifest.localModels[0]);
  const endTime = performance.now();
  const embedding = await model(text, { pooling: 'mean', normalize: true });
  return {
    embedding,
    processingTime: `${(endTime - startTime).toFixed(2)}ms`,
    modelUsed: manifest.localModels[0],
    device: embedding.ort_tensor?.dataLocation || 'unknown'
  };
};