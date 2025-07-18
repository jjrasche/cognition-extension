export const manifest = {
  name: "groq",
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["prompt", "listModels", "setModel", "getUsage"],
  state: {
    reads: [],
    writes: ["groq.model.current", "groq.model.available", "groq.response.latest", "groq.history", "groq.usage.tokens"]
  }
};

const DEFAULT_MODEL = "llama3-8b-8192";
const GROQ_API_BASE = "https://api.groq.com/openai/v1";

let apiKey = null;

const loadApiKey = async () => (await chrome.storage.sync.get(['groq.apiKey']))['groq.apiKey'];
const setCurrentModel = async (state, model) => await state.write('groq.model.current', model);
const initHistory = async (state) => !(await state.read('groq.history')) && await state.write('groq.history', []);
const getHistory = async (state) => await state.read('groq.history') || [];
const getCurrentModel = async (state) => await state.read('groq.model.current') || DEFAULT_MODEL;

export const initialize = async (state) => {
  apiKey = await loadApiKey();
  await setCurrentModel(state, DEFAULT_MODEL);
  await initHistory(state);
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

const updateHistory = async (state, entry) => {
  const history = await getHistory(state);
  history.push(entry);
  await state.write('groq.history', history);
};

const formatResponse = (text) => !text ? '' : globalThis.escapeHtml(text).replace(/\n/g, '<br>');

const buildResponseUI = (userText, response) => `
  <div style="padding: 20px;">
    <div style="margin-bottom: 16px;">
      <strong style="color: rgba(255,255,255,0.7);">You:</strong>
      <div style="margin: 8px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 6px;">
        ${globalThis.escapeHtml(userText)}
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
      <strong>Error:</strong> ${globalThis.escapeHtml(error)}
    </div>
    <div style="color: rgba(255,255,255,0.7);">
      Your prompt: "${globalThis.escapeHtml(userText)}"
    </div>
  </div>
`;

const updateUI = async (state, content) => {
  await state.write('ui.content', content);
  await state.actions.execute('ui.show');
};

export const prompt = async (state, params) => {
  const validation = validatePrompt(params) || validateApiKey();
  if (validation) return { success: false, error: validation };
  
  try {
    const model = await getCurrentModel(state);
    const context = await getContext(state);
    const response = await callGroqAPI(context.messages, model);
    
    const entry = createHistoryEntry(params.text, response, model);
    await updateHistory(state, entry);
    await state.write('groq.response.latest', response.content);
    response.usage && await state.write('groq.usage.tokens', response.usage);
    
    await updateUI(state, buildResponseUI(params.text, response));
    
    return { success: true, response: response.content, tokens: response.usage };
    
  } catch (error) {
    console.error('[Groq] Prompt error:', error);
    await updateUI(state, buildErrorUI(params.text, error.message));
    return { success: false, error: error.message };
  }
};

export const listModels = async (state) => {
  const validation = validateApiKey();
  if (validation) return { success: false, error: validation };
  
  try {
    const response = await fetch(`${GROQ_API_BASE}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    
    if (!response.ok) throw new Error(`Groq API error: ${response.status}`);
    
    const data = await response.json();
    const models = data.data?.map(model => model.id) || [];
    await state.write('groq.model.available', models);
    
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

export const getUsage = async (state) => {
  const history = await getHistory(state);
  const totalTokens = history.reduce((sum, entry) => sum + (entry.tokens?.total_tokens || 0), 0);
  
  const usage = {
    totalConversations: history.length,
    totalTokens,
    lastUsed: history.length > 0 ? history[history.length - 1].timestamp : null
  };
  
  return { success: true, usage };
};
