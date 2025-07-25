// inference-manager.module.js
export const manifest = {
  name: "inference-manager",
  version: "1.0.0",
  description: "Manages LLM inference across multiple providers with streaming support",
  permissions: ["storage"],
  actions: ["prompt", "getProviders", "setProvider", "getModels", "setModel", "getHistory"],
  state: {
    reads: [],
    writes: [ "inference.provider.current", "inference.model.current",  "inference.history", "inference.stream.active", "inference.stream.content"]
  }
};

// Provider state management
const getCurrentProvider = async (state) => await state.read('inference.provider.current');
const setCurrentProvider = async (state, provider) => await state.write('inference.provider.current', provider);
const getCurrentModel = async (state) => await state.read('inference.model.current');
const setCurrentModel = async (state, model) => await state.write('inference.model.current', model);
// Streaming state management
const startStream = async (state) => await state.write('inference.stream.active', true);
const endStream = async (state) => await state.write('inference.stream.active', false);
const updateStreamContent = async (state, content) => await state.write('inference.stream.content', content);
// History management
const addToHistory = async (state, entry) => await state.write('inference.history', [...(await state.read('inference.history') || []), entry]);
const getHistoryEntries = async (state, count = 10) => (await state.read('inference.history') || []).slice(-count);
// Provider registry
const providers = new Set();
export const registerProvider = (module) => providers.add({module});
const getProvider = (name) => Array.from(providers).find(provider => provider.module.manifest.name === name) || null;

let _state
export async function initialize(state, config) {
  _state = state;
  if (!(await getCurrentProvider(state))) {
    await setCurrentProvider(state, config.defaultProvider || 'claude');
  }
  
  // Initialize history if not present
  if (!(await state.read('inference.history'))) {
    await state.write('inference.history', []);
  }
  
  // Register available providers from imports
  // These will be dynamically added by the module registry
}

// Main inference action
export async function prompt(state, params) {
  if (!params?.text) return { success: false, error: 'No prompt text provided' };
  
  const provider = await getCurrentProvider(state);
  const model = await getCurrentModel(state) || await getProviderDefaultModel(state, provider);
  const implementation = getProvider(provider);
  
  if (!implementation) return { success: false, error: `Provider ${provider} not available` };
  
  const messages = formatMessages(params.text);
  
  try {
    // Start streaming
    await startStream(state);
    let content = '';
    
    // Create history entry placeholder
    const historyEntry = createHistoryEntry(provider, model, messages);
    
    // Stream processor - will be called for each chunk
    const processChunk = async (chunk) => {
      content += chunk;
      await updateStreamContent(state, content);
    };
    
    // Make the request with streaming
    const result = await implementation.makeRequest(state, messages, model, processChunk);
    
    // Complete the history entry
    historyEntry.response = {
      content: result.content,
      metadata: result.metadata
    };
    
    // Add to history
    await addToHistory(state, historyEntry);
    
    // End stream
    await endStream(state);
    
    return { success: true, result };
  } catch (error) {
    await endStream(state);
    return { success: false, error: error.message };
  }
}

// Provider management
export async function setProvider(state, params) {
  if (!params?.provider) return { success: false, error: 'No provider specified' };
  if (!getProvider(params.provider)) return { success: false, error: `Provider ${params.provider} not available` };
  
  await setCurrentProvider(state, params.provider);
  return { success: true, provider: params.provider };
}

// Model management
export async function getModels(state) {
  const provider = await getCurrentProvider(state);
  const implementation = getProvider(provider);
  
  if (!implementation) return { success: false, error: `Provider ${provider} not available` };
  
  try {
    const models = await implementation.getModels(state);
    return { success: true, models };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function setModel(state, params) {
  if (!params?.model) return { success: false, error: 'No model specified' };
  
  await setCurrentModel(state, params.model);
  return { success: true, model: params.model };
}

// History access
export async function getHistory(state, params) {
  const count = params?.count || 10;
  const history = await getHistoryEntries(state, count);
  return { success: true, history };
}

// Helper functions
const formatMessages = (text) => [{ role: 'user', content: text }];

const createHistoryEntry = (provider, model, messages) => ({
  id: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  provider,
  model,
  messages
});

const getProviderDefaultModel = async (state, provider) => {
  const implementation = getProvider(provider);
  if (!implementation) return null;
  
  try {
    const models = await implementation.getModels(state);
    return models[0] || null;
  } catch (error) {
    console.error(`Failed to get default model for ${provider}:`, error);
    return null;
  }
}