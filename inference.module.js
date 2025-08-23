export const manifest = {
  name: "inference",
  context: ["service-worker"],
  version: "1.0.0",
  description: "Manages LLM inference across multiple providers with streaming support",
  dependencies: ["chrome-sync", "graph-db", "ui"],
  actions: ["prompt", "showProviderModule", "uiPicker", "updateForm", "saveForm"],
};

let runtime, model, provider, providers = [];

export const initialize = async (rt) => {
  runtime = rt;
  await registerProviders();
  await loadConfig();
  // (!provider || !model) && await showProviderSelection();
};

const registerProviders = async () => (providers = runtime.getModulesWithProperty('inferenceModels').filter(p => ['makeRequest', 'getContent'].every(fn => typeof p[fn] === 'function')), runtime.log(`[Inference] Registered ${providers.length} providers`));

const loadConfig = async () => {
  const [savedProvider, savedModel] = await Promise.all([runtime.call('chrome-sync.get', "inference.provider"), runtime.call('chrome-sync.get', "inference.model")]);
  provider = providers.find(p => p.manifest.name === savedProvider);
  model = provider?.manifest.inferenceModels?.find(m => m.id === savedModel);
  (provider && model) && runtime.log(`[Inference] Loaded: ${provider.manifest.name} - ${model.name}`);
};

const saveConfig = async (providerName, modelName) => Promise.all([runtime.call('chrome-sync.set', { "inference.provider": providerName }), runtime.call('chrome-sync.set', { "inference.model": modelName })]);

const showProviderSelection = async (selectedProviderName = '') => runtime.call('ui.showModal', { title: "Configure AI Provider & Model", tree: buildFormTree(selectedProviderName) });

export const uiPicker = async () => await showProviderSelection(provider?.manifest.name || '');

const buildFormTree = (selectedProviderName = '') => {
  const selectedProvider = providers.find(p => p.manifest.name === selectedProviderName);
  const providerOptions = [{ value: "", text: "Choose a provider..." }, ...providers.map(p => ({ value: p.manifest.name, text: `${p.manifest.name} (${p.manifest.inferenceModels?.length || 0} models)` }))];
  const modelOptions = selectedProvider ? [{ value: "", text: "Choose a model..." }, ...selectedProvider.manifest.inferenceModels.map(m => ({ value: m.id, text: `${m.name} - ${m.bestFor?.slice(0, 2).join(', ') || 'General'}` }))] : [{ value: "", text: "Select a provider first" }];
  
  return {
    "provider-model-form": {
      tag: "form", events: { submit: "inference.saveForm" },
      "provider-select": { 
        tag: "select", 
        name: "provider", 
        value: selectedProviderName, 
        required: true, 
        options: providerOptions, 
        events: { change: "inference.updateForm" }, 
        style: "width: 100%; margin-bottom: 16px;" 
      },
      "model-select": { 
        tag: "select", 
        name: "model", 
        value: selectedProvider && model?.id || "",
        required: true, 
        disabled: !selectedProvider, 
        options: modelOptions, 
        style: "width: 100%; margin-bottom: 16px;" 
      },
      ...(selectedProvider && { 
        "info": { 
          tag: "div", 
          text: `Provider: ${selectedProvider.manifest.name} | Models: ${selectedProvider.manifest.inferenceModels?.length || 0}`, 
          style: "background: var(--bg-tertiary); padding: 12px; border-radius: 6px; margin-bottom: 20px; font-size: 14px;" 
        } 
      }),
      "actions": {
        tag: "div", 
        style: "display: flex; gap: 12px; justify-content: flex-end; padding-top: 16px; border-top: 1px solid var(--border-primary);",
        "cancel": { 
          tag: "button", 
          type: "button", 
          text: "Cancel", 
          class: "cognition-button-secondary", 
          events: { click: "ui.closeModal" } 
        },
        "submit": { 
          tag: "button", 
          type: "submit", 
          text: "Save", 
          class: "cognition-button-primary", 
          disabled: !selectedProvider 
        }
      }
    }
  };
};

// Update form when dependent fields change (like provider selection)
export const updateForm = async (eventData) => {
  const selectedProviderName = eventData.target.value;
  const updatedTree = buildFormTree(selectedProviderName);
  await runtime.call('ui.updateModal', { tree: updatedTree });
  runtime.log(`[Inference] Form updated for provider: ${selectedProviderName}`);
};

// Save form when submitted
export const saveForm = async (eventData) => {
  eventData.preventDefault?.();
  const { provider: providerName, model: modelName } = eventData.formData;
  
  if (!providerName || !modelName) {
    runtime.logError('[Inference] Missing selection');
    return;
  }
  
  const selectedProvider = providers.find(p => p.manifest.name === providerName);
  const selectedModel = selectedProvider?.manifest.inferenceModels?.find(m => m.id === modelName);
  
  if (!selectedProvider || !selectedModel) {
    runtime.logError('[Inference] Invalid selection');
    return;
  }
  
  provider = selectedProvider;
  model = selectedModel;
  
  await saveConfig(providerName, modelName);
  await runtime.call('ui.closeModal');
  runtime.log(`[Inference] ✅ Configured: ${provider.manifest.name} - ${model.name}`);
};

export const prompt = async (query, systemPrompt, webSearch) => {
  (!provider || !model) && (await showProviderSelection(), (() => { throw new Error('No provider/model configured'); })());
  
  const messages = await runtime.call("context.assemble", query, systemPrompt);
  const response = await provider.makeRequest(model, messages, webSearch);
  !response.ok && (() => { throw new Error(`${provider.manifest.name} API error: ${response.status}`); })();
  
  const content = await provider.getContent(response);
  runtime.call('graph-db.addInferenceNode', { query, prompt: messages, response: content, model: model.id, provider: provider.manifest.name }).catch(() => {});
  return content;
};

export const showProviderModule = () => provider && model ? runtime.log(`[Inference] ${provider.manifest.name} - ${model.name}`) : runtime.log('[Inference] Not configured');