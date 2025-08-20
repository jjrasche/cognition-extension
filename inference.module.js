export const manifest = {
  name: "inference",
  context: ["service-worker"],
  version: "1.0.0",
  description: "Manages LLM inference across multiple providers with streaming support",
  dependencies: ["chrome-sync", "graph-db", "embedding"],
  permissions: ["storage"],
  actions: ["prompt", "changeModelAndProvider"],
};
let runtime, model, provider, providers = [];
export const initialize = async (rt) => {
  runtime = rt;
  await registerProviders(runtime);
  provider = await loadProvider();
  model = await loadModel();
  if (!provider || !model) promptForProviderAndModel();
}
// providers
const loadProvider = async () => await providers.find(async p => p.manifest.name === (await runtime.call('chrome-sync.get', { key: "inference.provider" })));
const loadModel = async () => await provider.manifest.inferenceModels?.find(async m => m.id === (await runtime.call('chrome-sync.get', { key: "inference.model" })));
const registerProviders = async (runtime) => runtime.getModulesWithProperty('inferenceModels').forEach(async provider => {
  verifyImplementationFunctions(provider);
  // await verifyModels(provider);
  providers.push(provider);
});
const requiredImplementationMethods = ["makeRequest", "formatInteractionFromResponse"];
const verifyImplementationFunctions = (provider) => requiredImplementationMethods.forEach(fn => {
  if (typeof provider[fn] !== 'function') throw new Error(`Provider ${provider.manifest.name} missing ${fn} method`);
});
const verifyModels = (provider) => runtime.call("inference-model-validation.validateModels", { models: provider.manifest.inferenceModels || [] });
export const changeModelAndProvider = async ({ providerName, modelName }) => (await saveProvider(providerName), await saveModel(modelName));
const saveProvider = async (providerName) =>  await runtime.call('chrome-sync.set', { key: "inference.provider", value: providerName });
const saveModel = async (modelName) => await runtime.call('chrome-sync.set', { key: "inference.model", value: modelName });
const promptForProviderAndModel = async () => {
const providerOptions = providers.map(p => ({ value: p.manifest.name, text: p.manifest.name }));
  
  // todo: figure out how to do the dynamic form business logic within the module updating the form 
  // https://claude.ai/chat/ea732f00-4b45-42e6-a3df-410d6229173e


  // const tree = {
  //   "form": { 
  //     tag: "form",
  //     data: { action: "inference.setProviderAndModel" },
  //     "provider-label": { tag: "label", text: "Provider:", class: "form-label" },
  //     "provider-select": { tag: "select", name: "providerName", value: current.provider, options: providerOptions },
  //     "model-label": { tag: "label",  text: "Model:", class: "form-label" },
  //     "model-select": { tag: "select", name: "modelName", value: current.model, dependsOn: "provider-select", optionsByDependency: getModelsByProvider() },
  //     "submit-btn": { tag: "button", parent: "form", type: "submit", text: "Select Model" }
  //   }
  // };

  //   return await runtime.call('ui.renderForm', {
  //   title: "Select Inference Provider & Model",
  //   tree,
  //   onSubmit: "inference.changeModelAndProvider",
  //   onFieldChange: "inference.updateModelForm",
  //   formData: current
  // });
  
}

export const prompt = async (query, systemPrompt, webSearch) => {
  const messages = await runtime.call("context.assemble", query, systemPrompt);
  const response = (await provider.makeRequest({ model, messages, webSearch })).content;
  if (!response.ok) throw new Error(`Claude API error: ${response.status} - ${await response.text()}`);
  const embedding = await runtime.call('embedding.embedText', `${messages}\n${response}`);
  await processStream(response, onChunk);
  // await runtime.call('graph-db.addInferenceNode', { query, messages, response, model, embedding });
  return response;
};
const onChunk = async (chunk) => {
  let content = "";
  await runtime.log(content += chunk);
};
const processStream = async (resp, onChunk) => {
  let [reader, decoder, content, metadata] = [resp.body.getReader(), new TextDecoder(), '', { tokens: 0 }];
  try { for (let chunk; !(chunk = await reader.read()).done;) decoder.decode(chunk.value).split('\n').filter(l => l.startsWith('data: ') && l.slice(6) !== '[DONE]').forEach(l => { try { const p = JSON.parse(l.slice(6)), d = p.delta?.text || p.content?.[0]?.text; d && (content += d, onChunk(d)); p.usage && (metadata.tokens = p.usage); } catch { } }); }
  finally { reader.releaseLock(); }
  return { content, metadata };
};