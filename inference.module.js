export const manifest = {
  name: "inference",
  context: "service-worker",
  version: "1.0.0",
  description: "Manages LLM inference across multiple providers with streaming support",
  dependencies: ["chrome-sync", "graph-db"],
  permissions: ["storage"],
  actions: ["prompt"],
};
let runtime, model, provider, providers = [];
export const initialize = async (rt) => {
  runtime = rt;
  await registerProviders(runtime);
  provider = await getProvider();
  model = await getModel();
}

const registerProviders = async (runtime) => runtime.getModulesWithProperty('inferenceModels').forEach(async provider => {
  verifyImplementationFunctions(provider);
  await verifyModels(provider);
  providers.push(module);
});
const verifyImplementationFunctions = (provider) => ["formatInteractions", "makeRequest"].forEach(fn => {
  if (typeof provider[fn] !== 'function') throw new Error(`Provider ${provider.manifest.name} missing ${fn} method`);  
});
const verifyModels = (provider) => runtime.call("inference-model-validation.validateModels", { models: provider.manifest.inferenceModels || [] });
const getProviderName = async () => !(await runtime.call('chrome-sync.get', { key: "inference.provider" })) || await promptForProviderAndModel()
const getModelName = async () => !(await runtime.call('chrome-sync.get', { key: "inference.model" })) || await promptForProviderAndModel();
const getProvider = async () => await providers.find(async p => p.manifest.name === await getProviderName()) || (async () => { throw new Error(`Provider ${await getProviderName()} not found`); })();
const getModel = async () => await provider.manifest.inferenceModels?.find(async m => m.id === await getModelName()) || (async () => { throw new Error(`Model ${await getModelName()} not found for provider ${provider.manifest.name}`); })();
const changeModelAndProvider = async ({ providerName, modelName }) => {
  await runtime.call('chrome-sync.set', { key: "inference.provider", value: providerName });
  await runtime.call('chrome-sync.set', { key: "inference.model", value: modelName });
}
const promptForProviderAndModel = async (service) => {
  // todo: get all the providers and models as select options
  await runtime.call("ui.showSelect", { 
    message: `Enter model for ${service}:`,
    action: "inference.changeModelAndProvider", valueName: "model", actionParams: { service }
  });
}
// handle prompt
export async function prompt(params) {
  const assembledPrompt = await runtime.call("context.assemble", params);
  let content = "";
  const processChunk = async (chunk) => await updateStreamContent((content += chunk))
  const response = await provider.makeRequest(assembledPrompt, model, processChunk);
  storeInteractionInGraph({ assembledPrompt, response, ...params });
  return response
}
// tooo: first instance of updating the inference content section of ui
const updateStreamContent = async (content) => await _state.write("inference.content", content);
// update state
export const showModelSelector = async () => await _state.actions.execute("ui.pushForm", await createModelSelectorForm());
export const setProviderAndModel = async (params) => {
  const { providerName, modelName } = (params.providerName && params.modelName) ? params : (() => { throw new Error("Provider and model required"); })()
  const providerModule = getProvider(providerName);
  const validModel = getModel(providerModule, modelName);
  await _state.write("inference.current", { providerName, modelName });
  await _state.actions.execute("ui.popForm");
  await _state.actions.execute("ui.notify", { message: `Switched to ${validModel.name} (${providerName})`, type: "success" });
  return { success: true, providerName, modelName };
};
// const getProvider = (providerName) => providers.find(p => p.manifest.name === providerName) || (() => { throw new Error(`Provider ${providerName} not found`); })();
// const getModel = (providerModule, modelName) => providerModule.manifest.models?.find(m => m.id === modelName) || (() => { throw new Error(`Model ${modelName} not found for provider ${providerModule.manifest.name}`); })();
const createModelSelectorForm = async () => {
  const current = await getCurrent();
  const modelOptions = Object.fromEntries(providers.map(p => [p.manifest.name, (p.manifest.models || []).map(m => ({ value: m.id, text: m.name }))]));
  const providerOptions = providers.map(p => ({ value: p.manifest.name, text: p.manifest.name }));
  return {
    title: "Select Inference Provider & Model",
    fields: [
      { id: "provider", type: "select", label: "Provider:", options: providerOptions, value: current.providerName },
      { id: "model", type: "select", label: "Model:", options: [], optionsByDependency: modelOptions, value: current.modelName, dependsOn: "provider" }
    ],
    submitAction: "inference.setProviderAndModel",
  };
};

const storeInteractionInGraph = async (params) => {
  const { userPrompt, assembledPrompt, response } = params;
  const { providerName, modelName } = await getCurrent();
  try {
    const graphNodeId = await _state.actions.execute('graph-db.addInferenceNode', {
      userPrompt,
      assembledPrompt,
      response,
      model: `${providerName} - ${modelName}`,
      timestamp: new Date().toISOString()
    });
    console.log(`[Inference] Stored interaction in graph: ${graphNodeId.result}`);
  } catch (graphError) {
    console.error('[Inference] Failed to store interaction in graph:', graphError);
  }
};

// export const setProviderAndModel = async (params) => {
//   const { providerName, modelName } = (params.providerName && params.modelName) ? params : (() => { throw new Error("Provider and model required"); })()
//   const providerModule = getProvider(providerName);
//   const validModel = getModel(providerModule, modelName);
//   await _state.write("inference.current", { providerName, modelName });
//   await _state.actions.execute("ui.hide");
//   await _state.actions.execute("ui.notify", { message: `Switched to ${validModel.name} (${providerName})`, type: "success" });
//   return { success: true, providerName, modelName };
// };

// export const showModelSelector = async () => await _state.actions.execute("ui.modal", { text: await buildModalHTML(await createModalConfig()) });
// const createModalConfig = async () => ({ providers: providers.map(p => ({ name: p.manifest.name, models: p.manifest.models || [] })), ...await getCurrent() });
// const buildModalHTML = async (config) => [
//   createModalContainer([
//     createModalHeader(),
//     initializeProviderDropdown(config),
//     initializeModelDropdown(config),
//     createModalButtons()
//   ]),
// ].join("");
// const createModalContainer = (children) => `<div style="padding: 24px; min-width: 400px;">${children.join("")}</div>`;
// const createModalHeader = () => `<h3 style="margin: 0 0 20px 0;">Select Inference Provider & Model</h3>`;
// const initializeProviderDropdown = (config) => createDropdown("provider-select", "Provider:", config.providers.map(p => ({ value: p.name, text: p.name, selected: p.name === config.providerName })));
// const initializeModelDropdown = (config) => {
//   const currentProviderObj = config.providers.find(p => p.name === config.providerName);
//   const models = currentProviderObj?.models || [];
//   return createDropdown("model-select", "Model:",
//     models.map(m => ({ value: m.id, text: m.name, selected: m.id === config.model }))
//   );
// };
// const createDropdown = (id, label, options) => `
//   <div style="margin-bottom: 16px;">
//     <label style="display: block; margin-bottom: 8px; font-weight: 500;">${label}</label>
//     <select id="${id}" style="width: 100%; padding: 8px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.1); color: #fff; border-radius: 4px;">
//       ${options.map(opt => `<option value="${opt.value}" ${opt.selected ? "selected" : ""}>${opt.text}</option>`).join("")}
//     </select>
//   </div>
// `;
// const createModalButtons = () => `
//   <div style="display: flex; gap: 12px; justify-content: flex-end;">
//     <button data-action="ui.hide" style="padding: 10px 20px; border: 1px solid rgba(255,255,255,0.2); background: none; color: #fff; border-radius: 4px; cursor: pointer;">Cancel</button>
//     <button data-action="inference.setProviderAndModel" data-params-from-selects="provider-select,model-select" style="padding: 10px 20px; background: rgba(99,102,241,0.2); border: 1px solid rgba(99,102,241,0.5); color: #fff; border-radius: 4px; cursor: pointer;"> Select </button>
//   </div>
// `;
// const createModalScript = (config) => `
//   <script>
//     const providers = ${JSON.stringify(config.providers)};
//     const providersMap = Object.fromEntries(providers.map(p => [p.name, p.models]));
//     const [providerSelect, modelSelect, submitBtn] = ["provider-select", "model-select", "submit-btn"].map(id => document.getElementById(id));
//     const updateModels = () => modelSelect.innerHTML = (providersMap[providerSelect.value] || []).map(m => \`<option value="\${m.id}">\${m.name}</option>\`).join("");
//     providerSelect.addEventListener("change", updateModels);
//     updateModels();
//   </script>
// `;