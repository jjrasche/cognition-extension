export const manifest = {
  name: "embedding", 
  keywords: ["embed"],
  context: "offscreen",
  version: "1.0.0",
  description: "...",
  actions: ["embedText"],
  localModels : ["Xenova/all-MiniLM-L6-v2"],
};

let _state
export const initialize = async (state) => _state = state;

export const embedText = async (params) => {
  const { text } = params;
  !text && (() => { throw new Error('Text required'); })();
  
  const model = await _state.actions.execute('transformer.getModel', { modelId: manifest.localModels[0] });
  return await model.pipeline(text);
};