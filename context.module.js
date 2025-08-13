export const manifest = {
  name: "context",
  context: ["service-worker"],
  version: "1.0.0",
  description: "Packages current state and available actions for LLM consumption",
  permissions: ["storage"],
  actions: ["assemble"],
};

let runtime;
export const initialize = (rt) => runtime = rt;

export const assemble = async (params) => {
  const { query } = params;
  const similarInteractions = [];//await _state.actions.execute('graph-db.searchByText', { text: query, threshold: 0.5 });
  const conversationHistory = buildConversationHistory(similarInteractions);
  // const mentionedModules = await getMentionedModules(query);
  // const modulesContext = await buildModulesContext(mentionedModules);
  const systemPrompt = "You are Cognition, an AI assistant with access to the user's data and capabilities.";
  // return [{ role: 'system', content: systemPrompt }, ...conversationHistory, { role: 'user', content: `${modulesContext}\n\nCURRENT REQUEST:\n${query}` }];  
  return [{ role: 'system', content: systemPrompt }, ...conversationHistory, { role: 'user', content: query }];
};

// const getMentionedModules = async (text) => runtime.getModules().filter(m => [...(m.keywords || []), m.name.toLowerCase()].some(w => text.toLowerCase().includes(w.toLowerCase())) );
const buildConversationHistory = (similarInteractions = []) => similarInteractions
  .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  .flatMap(interaction => [{ role: 'user', content: interaction.userPrompt }, { role: 'assistant', content: interaction.response }]);

// const buildModulesContext = async (modules) => `AVAILABLE MODULES AND THEIR CONTEXT:\n${(await Promise.all(modules.map(async m => await  buildModuleContext(m.name)))).join('\n---\n')}`; 
// const buildModuleContext = async (moduleName) => `MODULE: ${moduleName}\n\nSTATE:\n${await formatModuleState(moduleName)}\n\nACTIONS:\n${formatModuleActions(moduleName)}`;

// const getModuleState = async (moduleName) => Object.fromEntries(Object.entries(await _state.getAll()).filter(([key]) => key.startsWith(`${moduleName}.`)));
// const formatModuleState = async (moduleName) => Object.entries(await getModuleState(moduleName)).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`).join('\n');

// const getModuleActions = (moduleName) => Array.from(_state.actions.actions.entries())
//     .filter(([name]) => name.startsWith(`${moduleName}.`))
//     .map(([name, action]) => ({ name, description: action.description || 'No description'}));
// const formatModuleActions = (moduleName) => getModuleActions(moduleName).map(action => `  ${action.name} - ${action.description}`).join('\n');