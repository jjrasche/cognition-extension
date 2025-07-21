export const manifest = {
  name: "context-assembler",
  version: "1.0.0",
  description: "Packages current state and available actions for LLM consumption",
  permissions: ["storage"],
  actions: ["assembleLLMContext"],
  state: { reads: ["*"] }
};

export const initialize = async () => {};

const getUserPrompt = async (state) => await state.read('input.text.current');
const buildSystemPrompt = (actions) => `You are Cognition, an AI assistant with access to the user's data and capabilities.

AVAILABLE ACTIONS:
${actions.map(action => `• ${action.name} - ${action.description || 'No description available'}`).join('\n')}

RESPONSE FORMAT:
When you need to call an action, use this exact format:
ACTION: [action_name]
PARAMS: {key: "value", key2: "value2"}

You can call multiple actions by using this format multiple times.
If no action is needed, respond normally without the ACTION/PARAMS format.

IMPORTANT:
- Use exact action names from the list above
- Current state shows last known values - refresh data when needed for accurate responses
- Always be helpful and provide context for your actions
- If you're unsure about an action, ask the user for clarification`;

const formatValue = (value) => {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  if (typeof value === 'string' && value.length > 100) return value.substring(0, 100) + '...';
  return value;
};

const groupStateByModule = (state) => Object.entries(state).reduce((groups, [key, value]) => {
  const module = key.split('.')[0];
  if (!groups[module]) groups[module] = {};
  groups[module][key] = value;
  return groups;
}, {});

const formatStateContext = (state) => {
  if (!state || Object.keys(state).length === 0) return "No current state available.";
  
  const grouped = groupStateByModule(state);
  return "CURRENT STATE:\n" + Object.entries(grouped)
    .map(([module, moduleState]) => 
      `\n${module.toUpperCase()}:\n` + 
      Object.entries(moduleState)
        .map(([key, value]) => `  ${key}: ${formatValue(value)}`)
        .join('\n')
    ).join('\n');
};

const buildUserMessage = (userPrompt, stateContext) => `${stateContext}\n\nUSER REQUEST: ${userPrompt}`;

const checkContextLength = (messages, limit = 8000) => {
  const totalLength = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  if (totalLength > limit) throw new Error(`Context too long: ${totalLength} characters (limit: ${limit})`);
  return totalLength;
};

const buildContext = (messages, userPrompt, actions, stateKeys, totalLength) => ({
  messages,
  metadata: {
    userPrompt,
    availableActions: actions.length,
    stateKeys,
    totalLength,
    timestamp: new Date().toISOString()
  }
});

export const assembleLLMContext = async (state, params = {}) => {
  try {
    const userPrompt = await getUserPrompt(state);
    if (!userPrompt || userPrompt.trim() === '') {
      return { success: false, error: 'No user input available' };
    }

    const currentState = await state.getAll();
    const availableActions = state.actions.list();
    
    const systemPrompt = buildSystemPrompt(availableActions);
    const stateContext = formatStateContext(currentState);
    const userMessage = buildUserMessage(userPrompt, stateContext);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];
    
    const totalLength = checkContextLength(messages);
    const context = buildContext(messages, userPrompt, availableActions, Object.keys(currentState).length, totalLength);
    
    return { success: true, context };
    
  } catch (error) {
    console.error('[ContextAssembler] Error assembling context:', error);
    return { success: false, error: error.message };
  }
};