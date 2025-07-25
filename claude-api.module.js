export const manifest = {
  name: "claude-api",
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["prompt", "getModels"],
  state: {
    reads: [],
    writes: ["claude.lastResponse"]
  }
};

let _state = {};
let _apiKey = null;
const defaultModel = "claude-3-5-sonnet-20241022";
const buildModelsHeaders = () => ({ 'x-api-key': _apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' });
const loadApiKey = async () => (await chrome.storage.sync.get(['claudeApiKey']))['claudeApiKey'];
// const validateAPIKey = (key) => key && key.startsWith('sk-ant-') || (() => { throw new Error('Invalid API key'); })();
const setAPIKey = async () => ( _apiKey = await loadApiKey(), !!_apiKey || (() => { throw new Error('No API key configured'); })() );

export const initialize = async (state) => {
  _state = state;
  await setAPIKey()
};

const call = async (urlSuffix, method, body, successResult) => {
  const message = { body, method, headers: buildModelsHeaders() }
  let resp = await fetch(`https://api.anthropic.com/v1/${urlSuffix}`, message);
  resp.json = await resp.json();
  await _state.write('claude.lastResponse', resp);
  return resp.ok ? { success: true, result: successResult(resp) }
  : { success: false, result: `${resp.status}:\t${JSON.stringify(resp.json)}` };
};

export const prompt = async (params) => {
  if (!params?.text) return { success: false, error: 'No text provided' };
  const body = JSON.stringify({ model: params.model ?? defaultModel, max_tokens: 1024, messages: [{ role: 'user', content: params.text }] });
  return await call("messages", "POST", body, (resp) => resp.json.content[0].text);
};
export const models = async () => call("models", "GET", null, (resp) => resp.json.data);