export const manifest = {
  name: "inference",
  context: "service-worker",
  version: "1.0.0",
  description: "Manages LLM inference across multiple providers with streaming support",
  dependencies: ["chrome-sync", "graph-db", "ui"],
  permissions: ["storage"],
  actions: ["prompt", "showModelSelector", "updateModelForm", "setProviderAndModel"],
};

let runtime, providers = [];

export const initialize = async (rt) => {
  runtime = rt;
  await registerProviders();
};

// Show the model selection form
export const showModelSelector = async () => {
  const current = await getCurrentSelection();
  const providerOptions = providers.map(p => ({ 
    value: p.manifest.name, 
    text: p.manifest.name 
  }));
  
  const tree = {
    "form": { 
      tag: "form",
      data: { action: "inference.setProviderAndModel" },
      "provider-label": { tag: "label", text: "Provider:", class: "form-label" },
      "provider-select": { tag: "select", name: "provider", value: current.provider, options: providerOptions },
      "model-label": { tag: "label",  text: "Model:", class: "form-label" },
      "model-select": { tag: "select", name: "model", value: current.model, dependsOn: "provider-select", optionsByDependency: getModelsByProvider() },
      "submit-btn": { tag: "button", parent: "form", type: "submit", text: "Select Model" }
    }
  };
  
  return await runtime.call('ui.renderForm', {
    title: "Select Inference Provider & Model",
    tree,
    onSubmit: "inference.setProviderAndModel",
    onFieldChange: "inference.updateModelForm",
    formData: current
  });
};

// Handle form updates when provider changes
export const updateModelForm = async (params) => {
  const { formData, changedField } = params;
  
  if (changedField === 'provider') {
    // Get models for the newly selected provider
    const modelOptions = getModelsForProvider(formData.provider);
    
    // Return updated tree definition for the model field
    const updatedTree = {
      "model-select": {
        tag: "select",
        parent: "form", 
        name: "model",
        dependsOn: "provider",
        options: modelOptions,
        value: "" // Reset model selection when provider changes
      }
    };
    
    return { success: true, tree: updatedTree };
  }
  
  return { success: true };
};

// Handle final form submission
export const setProviderAndModel = async (params) => {
  const { provider, model } = params;
  
  if (!provider || !model) {
    throw new Error("Both provider and model must be selected");
  }
  
  // Validate the selection
  const providerModule = providers.find(p => p.manifest.name === provider);
  if (!providerModule) {
    throw new Error(`Provider ${provider} not found`);
  }
  
  const modelDef = providerModule.manifest.inferenceModels?.find(m => m.id === model);
  if (!modelDef) {
    throw new Error(`Model ${model} not found for provider ${provider}`);
  }
  
  // Save the selection
  await runtime.call('chrome-sync.set', { 
    items: { 
      'inference.provider': provider,
      'inference.model': model 
    }
  });
  
  runtime.log(`[Inference] Selected ${modelDef.name} from ${provider}`);
  
  return { 
    success: true, 
    message: `Selected ${modelDef.name} from ${provider}`,
    provider, 
    model 
  };
};

// Helper functions
const getCurrentSelection = async () => {
  const stored = await runtime.call('chrome-sync.get', { 
    key: ['inference.provider', 'inference.model'] 
  });
  
  return {
    provider: stored.result?.['inference.provider'] || providers[0]?.manifest.name || '',
    model: stored.result?.['inference.model'] || ''
  };
};

const getModelsByProvider = () => {
  const modelsByProvider = {};
  
  providers.forEach(provider => {
    const models = provider.manifest.inferenceModels || [];
    modelsByProvider[provider.manifest.name] = models.map(m => ({
      value: m.id,
      text: m.name || m.id
    }));
  });
  
  return modelsByProvider;
};

const getModelsForProvider = (providerName) => {
  const provider = providers.find(p => p.manifest.name === providerName);
  if (!provider) return [];
  
  return (provider.manifest.inferenceModels || []).map(m => ({
    value: m.id,
    text: m.name || m.id
  }));
};

const registerProviders = async () => {
  // Register all modules that have inferenceModels
  const providerModules = runtime.getModulesWithProperty('inferenceModels');
  
  providerModules.forEach(provider => {
    // Validate provider has required methods
    if (typeof provider.makeRequest !== 'function') {
      runtime.logError(`Provider ${provider.manifest.name} missing makeRequest method`);
      return;
    }
    
    providers.push(provider);
    runtime.log(`[Inference] Registered provider: ${provider.manifest.name}`);
  });
  
  runtime.log(`[Inference] Registered ${providers.length} providers`);
};

// Main inference function (simplified for example)
export const prompt = async (params) => {
  const { userPrompt } = params;
  
  const current = await getCurrentSelection();
  if (!current.provider || !current.model) {
    throw new Error("No provider/model selected. Run inference.showModelSelector() first.");
  }
  
  const provider = providers.find(p => p.manifest.name === current.provider);
  const model = provider.manifest.inferenceModels.find(m => m.id === current.model);
  
  // Assemble context and make request
  const assembledPrompt = await runtime.call("context.assemble", params);
  const response = await provider.makeRequest({
    model: current.model,
    messages: assembledPrompt,
    onChunk: (chunk) => runtime.log('[Inference] Chunk:', chunk)
  });
  
  // Store in graph database
  await runtime.call('graph-db.addInferenceNode', {
    userPrompt,
    assembledPrompt: JSON.stringify(assembledPrompt),
    response: response.content,
    model: `${current.provider}/${current.model}`,
    context: { provider: current.provider, model: current.model }
  });
  
  return response;
};