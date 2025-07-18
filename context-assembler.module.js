export const manifest = {
  name: "contextAssembler",
  version: "1.0.0",
  description: "Packages current state and available actions for LLM consumption",
  permissions: ["storage"],
  actions: ["assembleLLMContext"],
  state: {
    reads: ["*"]
  }
};

export async function initialize() {}

export async function assembleLLMContext(state, params = {}) {
  try {
    const context = {
      userPrompt: state.read('input.text.current'),  // TODO need to change based on source e.g. voice vs. text
      systemPrompt: generateSystemPrompt(state),
      currentState: await state.getAll(),
      availableActions: state.actions.list(),
      timestamp: new Date().toISOString()
    };
    
    return {
      success: true,
      context: {
        messages: [
          { role: 'system', content: 'You are Cognition...' },
          { role: 'user', content: 'Current state: {...}\n\nUser: How did I sleep?' }
        ]
      }
    };
  } catch (error) {
    console.error('[ContextAssembler] Error assembling context:', error);
    return { success: false, error: error.message };
  }
}

// Generate system prompt with dynamic module capabilities
function generateSystemPrompt(state) {
  let ret = "You are Cognition, an AI assistant with access to the user's data and capabilities.Available modules and their actions:";
  ret += `${state.actions.readableList()}`;
  ret += `\n\nYou can call any of these actions to get fresh data or perform tasks. Current state shows the last known values, but you should refresh data when needed for accurate responses.`;
  return ret;
}