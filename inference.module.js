export const manifest = {
  name: "inference",
  version: "1.0.0",
  description: "Manages LLM inference across multiple providers with streaming support",
  permissions: ["storage"],
  actions: ["prompt", "getProviders", "setProvider", "getHistory"],
  state: {
    reads: [],
    writes: [ "inference.provider", "inference.history", "inference.stream.content"]
  }
};

const providers = []; // all inference providers
export const register = (module) => {
  providers.push(module);
  _state.actions.execute('inference-model-validation.validateModels', { models: module.manifest.models || [] });
};
export const getProviders = () => providers;
/*
  set provider by module name and model id
let m = (await inference.getProviders())[0]
await inference.setProvider(m, m.models[2].id)
*/
export const setProvider = async (params) => {
  const { module, model } = params;
  await _state.write('inference.provider', { moduleName: module.manifest.name, model });
}
const getProvider = async () => {
  const provider = await _state.read('inference.provider');
  const providerModule = providers.find(async p => p.manifest.name === provider.moduleName);
  return { name: provider.moduleName, module: providerModule, model: provider.model ?? providerModule.manifest.defaultModel };
};

let _state;
export const initialize = (state) => _state = state;

export async function prompt(params) {
  if (!params.text) return { success: false, error: 'No prompt text provided' };
  const provider = await getProvider();
  const messages = [{ role: 'user', content: params.text }];
  try {
    let content = '';
    const processChunk = async (chunk) => await updateStreamContent((content += chunk))
    const response = await provider.module.makeRequest(messages, provider.model, processChunk);
    await addToHistory(createHistoryEntry({ provider: provider.name, messages, response }));
    return { success: true, result: response };
  } catch (error) { return { success: false, error: error.message } };
}
const updateStreamContent = async (content) => await _state.write('inference.content', content);

const createHistoryEntry = (obj) => ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...obj });
const addToHistory = async (entry) => await _state.write('inference.history', [...(await _state.read('inference.history') || []), entry]);
const getHistoryEntries = async (count = 10) => (await _state.read('inference.history') || []).slice(-count);
export const getHistory = async (params) => ({ success: true, result: await getHistoryEntries(params?.count) });
