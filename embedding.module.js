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
  const model = await runtime.call('transformer.getModel', { modelId: manifest.localModels[0] });
  return await model.pipeline(text);
};