export const manifest = {
  name: "claude-api",
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["prompt"],
  state: {
    reads: [],
    writes: ["claude.lastResponse"]
  }
};

let apiKey = null;

const loadApiKey = async () => (await chrome.storage.sync.get(['claudeApiKey']))['claudeApiKey'];
const validateAPIKey = (key) => key && key.startsWith('sk-ant-') || (() => { throw new Error('Invalid API key'); })();
const saveApiKey = async (key) => (validateAPIKey(key), apiKey = key, await chrome.storage.sync.set({ claudeApiKey: key }));

let _state = {};
export const initialize = async (state) => {
  _state = state;
  apiKey = await loadApiKey();
  if (!apiKey) {
  }
};

const promptUserForAPIKey = async () => {
  await _state.actions.execute('ui.modal', {text: "Enter API key:", inputType: "text", responseAction: "saveApiKey"});
  _state.watch('input.text.current', async (value) => {
    
    if (value?.startsWith('sk-ant-')) {
      await saveApiKey(value);
      await _state.actions.execute('text-input.hide');
    }
    });
}

const callClaude = async (text, model = 'claude-3-sonnet-20240229') => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: text }] })
  });
  return response.ok ? response.json() : Promise.reject(`API error: ${response.status}`);
};

export const prompt = async (state, params) => {
  if (!params?.text) return { success: false, error: 'No text provided' };
  if (!apiKey) return { success: false, error: 'No API key configured' };
  
  try {
    const response = await callClaude(params.text, params.model);
    const content = response.content[0].text;
    await state.write('claude.lastResponse', content);
    return { success: true, response: content };
  } catch (error) {
    return { success: false, error: error.message || error };
  }
};