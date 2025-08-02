export const manifest = {
  name: "groq-inference",
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["prompt", "listModels", "setModel", "getUsage"],
  dependencies: { 
    "global-helpers": "1.0.0",
    "context-assembler.module": "1.0.0",
    "ui.module": "1.0.0"
  },
  state: {
    reads: [],
    writes: ["groq.model.current", "groq.model.available", "groq.response.latest", "groq.history", "groq.usage.tokens"]
  }
};

const DEFAULT_MODEL = "llama3-8b-8192";
const GROQ_API_BASE = "https://api.groq.com/openai/v1";

let apiKey = null;

const loadApiKey = async () => (await chrome.storage.sync.get(['groq.apiKey']))['groq.apiKey'];
const setCurrentModel = async (model) => await _state.write('groq.model.current', model);
const initHistory = async () => !(await _state.read('groq.history')) && await _state.write('groq.history', []);
const getHistory = async () => await _state.read('groq.history') || [];
const getCurrentModel = async () => await _state.read('groq.model.current') || DEFAULT_MODEL;

let _state
export const initialize = async (state) => {
  _state = state;
  apiKey = await loadApiKey();
  await setCurrentModel(DEFAULT_MODEL);
  await initHistory();
};

const validatePrompt = (params) => params?.text ? null : 'Prompt text required';
const validateApiKey = () => apiKey ? null : 'Groq API key not configured';
const getContext = async (state) => {
  const result = await state.actions.execute('contextAssembler.assembleLLMContext');
  return result.success ? result.result.context : null;
};

const callGroqAPI = async (prompt, model) => {
  const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt,
      temperature: 0.7, max_tokens: 1024, stream: false
    })
  });
  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errorData}`);
  }
  const data = await response.json();
  return { content: data.choices[0]?.message?.content || 'No response', usage: data.usage };
};

const createHistoryEntry = (userText, response, model) => ({
  prompt: userText, response: response.content, model,
  timestamp: new Date().toISOString(), tokens: response.usage
});

const updateHistory = async (entry) => {
  const history = await getHistory();
  history.push(entry);
  await _state.write('groq.history', history);
};

const formatResponse = (text) => !text ? '' : globalThis.cognition.escapeHtml(text).replace(/\n/g, '<br>');

const buildResponseUI = (userText, response) => `
  <div style="padding: 20px;">
    <div style="margin-bottom: 16px;">
      <strong style="color: rgba(255,255,255,0.7);">You:</strong>
      <div style="margin: 8px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 6px;">
        ${globalThis.cognition.escapeHtml(userText)}
      </div>
    </div>
    <div>
      <strong style="color: rgba(99,102,241,0.8);">AI:</strong>
      <div style="margin: 8px 0; padding: 12px; background: rgba(99,102,241,0.1); border-radius: 6px; line-height: 1.6;">
        ${formatResponse(response.content)}
      </div>
    </div>
    ${response.usage ? `
      <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: rgba(255,255,255,0.5);">
        Tokens: ${response.usage.total_tokens} (${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion)
      </div>
    ` : ''}
  </div>
`;

const buildErrorUI = (userText, error) => `
  <div style="padding: 20px;">
    <div style="color: #ff6b6b; margin-bottom: 12px;">
      <strong>Error:</strong> ${globalThis.cognition.escapeHtml(error)}
    </div>
    <div style="color: rgba(255,255,255,0.7);">
      Your prompt: "${globalThis.cognition.escapeHtml(userText)}"
    </div>
  </div>
`;

const updateUI = async (content) => {
  await _state.write('ui.content', content);
  await _state.actions.execute('ui.show');
};

export const prompt = async (params) => {
  const validation = validatePrompt(params) || validateApiKey();
  if (validation) return { success: false, error: validation };
  try {
    const model = await getCurrentModel();
    const context = await getContext();
    const response = await callGroqAPI(context.messages, model);
    const entry = createHistoryEntry(params.text, response, model);
    await updateHistory(entry);
    await _state.write('groq.response.latest', response.content);
    response.usage && await _state.write('groq.usage.tokens', response.usage);
    await updateUI(buildResponseUI(params.text, response));
    return { success: true, response: response.content, tokens: response.usage };
  } catch (error) {
    console.error('[Groq] Prompt error:', error);
    await updateUI(buildErrorUI(params.text, error.message));
    return { success: false, error: error.message };
  }
};

export const listModels = async () => {
  const validation = validateApiKey();
  if (validation) return { success: false, error: validation };
  try {
    const response = await fetch(`${GROQ_API_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    if (!response.ok) throw new Error(`Groq API error: ${response.status}`);
    const data = await response.json();
    const models = data.data?.map(model => model.id) || [];
    await _state.write('groq.model.available', models);

    return { success: true, models };
  } catch (error) {
    console.error('[Groq] List models error:', error);
    return { success: false, error: error.message };
  }
};

export const setModel = async (state, params) => {
  if (!params?.model) return { success: false, error: 'Model name required' };
  await state.write('groq.model.current', params.model);
  return { success: true, model: params.model };
};

export const getUsage = async () => {
  const history = await getHistory();
  const totalTokens = history.reduce((sum, entry) => sum + (entry.tokens?.total_tokens || 0), 0);
  const usage = {
    totalConversations: history.length,
    totalTokens,
    lastUsed: history.length > 0 ? history[history.length - 1].timestamp : null
  };
  return { success: true, usage };
};
