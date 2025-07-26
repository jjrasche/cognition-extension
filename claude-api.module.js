// export const manifest = {
//   name: "claude-api",
//   version: "1.0.0",
//   permissions: ["storage"],
//   actions: ["prompt", "getModels"],
//   state: {
//     reads: [],
//     writes: ["claude.lastResponse"]
//   },
//   defaultModel: "claude-3-5-sonnet-20241022"
// };

// let _state = {};
// let _apiKey = null;
// const buildModelsHeaders = () => ({ 'x-api-key': _apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' });
// const loadApiKey = async () => (await chrome.storage.sync.get(['claudeApiKey']))['claudeApiKey'];
// // const validateAPIKey = (key) => key && key.startsWith('sk-ant-') || (() => { throw new Error('Invalid API key'); })();
// const setAPIKey = async () => ( _apiKey = await loadApiKey(), !!_apiKey || (() => { throw new Error('No API key configured'); })() );

// export const initialize = async (state) => {
//   _state = state;
//   await setAPIKey()
// };

// const call = async (urlSuffix, method, body, successResult) => {
//   const message = { body, method, headers: buildModelsHeaders() }
//   let resp = await fetch(`https://api.anthropic.com/v1/${urlSuffix}`, message);
//   resp.json = await resp.json();
//   await _state.write('claude.lastResponse', resp);
//   return resp.ok ? { success: true, result: successResult(resp) }
//   : { success: false, result: `${resp.status}:\t${JSON.stringify(resp.json)}` };
// };

// export const prompt = async (params) => {
//   if (!params?.text) return { success: false, error: 'No text provided' };
//   const body = JSON.stringify({ model: params.model ?? defaultModel, max_tokens: 1024, messages: [{ role: 'user', content: params.text }] });
//   return await call("messages", "POST", body, (resp) => resp.json.content[0].text);
// };


export const manifest = {
  name: "claude-api",
  version: "1.0.0",
  permissions: ["storage"],
  defaultModel: "claude-3-5-sonnet-20241022"
};

const buildHeaders = (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' });
const getApiKey = async () => (await chrome.storage.sync.get(['claudeApiKey']))['claudeApiKey'] || (() => { throw new Error('Claude API key not configured'); })()

let _apiKey;
export const initialize = async () => _apiKey = await getApiKey();

// Provider interface implementation
export const makeRequest = async (messages, model, onChunk) => {
  const body = JSON.stringify({ model, messages, stream: true });
  const resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: buildHeaders(_apiKey), body });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} - ${await resp.text()}`);
  return await processStream(resp, onChunk);
};

const processStream = async (resp, onChunk) => {
  let [reader, decoder, content, metadata] = [resp.body.getReader(), new TextDecoder(), '', { tokens: 0 }];
  try {
    for (let chunk; !(chunk = await reader.read()).done;) 
      decoder.decode(chunk.value).split('\n').filter(l => l.startsWith('data: ') && l.slice(6) !== '[DONE]')
        .forEach(l => { try { const p = JSON.parse(l.slice(6)), d = p.delta?.text || p.content?.[0]?.text; d && (content += d, onChunk(d)); p.usage && (metadata.tokens = p.usage); } catch {} });
  } finally { reader.releaseLock(); }
  return { content, metadata };
};

export const models = [{
  "id": "claude-opus-4-20250514",
  "name": "Claude Opus 4",
  "releaseDate": "2025-05-22",
  "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "web-search"],
  "inputTypes": ["text", "image", "document"],
  "outputTypes": ["text", "code"],
  "bestFor": ["complex-reasoning", "code-generation", "document-analysis"],
  "contextWindow": 200000,
  "maxOutput": 32000,
  "pricing": { "input": 15, "output": 75 },
  "rateLimits": { "requestsPerMinute": 100, "tokensPerMinute": 50000, "requestsPerDay": 10000 }
}, {
  "id": "claude-sonnet-4-20250514",
  "name": "Claude Sonnet 4",
  "releaseDate": "2025-05-22",
  "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "web-search"],
  "inputTypes": ["text", "image", "document"],
  "outputTypes": ["text", "code"],
  "bestFor": ["code-generation", "conversation", "document-analysis"],
  "contextWindow": 200000,
  "maxOutput": 64000,
  "pricing": { "input": 3, "output": 15 },
  "rateLimits": { "requestsPerMinute": 150, "tokensPerMinute": 100000, "requestsPerDay": 15000 }
}, {
  "id": "claude-sonnet-3-7-20250219",
  "name": "Claude 3.7 Sonnet",
  "releaseDate": "2025-02-19",
  "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "web-search"],
  "inputTypes": ["text", "image", "document"],
  "outputTypes": ["text", "code"],
  "bestFor": ["complex-reasoning", "conversation", "document-analysis"],
  "contextWindow": 200000,
  "maxOutput": 4096,
  "pricing": { "input": 3, "output": 15 },
  "rateLimits": { "requestsPerMinute": 120, "tokensPerMinute": 90000, "requestsPerDay": 12000 }
}, {
  "id": "claude-3-5-sonnet-20241022",
  "name": "Claude 3.5 Sonnet",
  "releaseDate": "2024-06-24",
  "capabilities": ["text", "vision", "function-calling", "code", "reasoning"],
  "inputTypes": ["text", "image", "document"],
  "outputTypes": ["text", "code"],
  "bestFor": ["conversation", "document-analysis", "creative-writing"],
  "contextWindow": 200000,
  "maxOutput": 4096,
  "pricing": { "input": 3, "output": 15 },
  "rateLimits": { "requestsPerMinute": 100, "tokensPerMinute": 80000, "requestsPerDay": 10000 }
}];