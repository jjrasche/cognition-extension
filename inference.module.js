export const manifest = {
	name: "inference",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Manages LLM inference across multiple providers with streaming support",
	dependencies: ["chrome-sync", "graph-db", "ui"],
	actions: ["prompt", "infer", "showProviderModule", "uiPicker", "updateForm", "saveForm"],
	searchActions: [
		{ name: "call to inference", condition: input => input.startsWith('infer'), method: "infer" },
		{ name: "select inference model", keyword: "pick model", method: "uiPicker" }
	]
};

let runtime, model, provider, providers = [];

export const initialize = async (rt) => {
	runtime = rt;
	await registerProviders();
	await loadConfig();
	(!provider || !model) && await showProviderSelection();
};

const registerProviders = async () => (providers = runtime.getModulesWithProperty('inferenceModels').filter(p => ['makeRequest', 'getContent'].every(fn => typeof p[fn] === 'function')), runtime.log(`[Inference] Registered ${providers.length} providers`));

const addInferenceNode = async (query, prompt, response, model, context) => {
	const node = { query, prompt, response, model, context, timestamp: new Date().toISOString() };
	return runtime.call('graph-db.addNode', { type: 'inference', ...node });
};
const getInferenceNode = async (id) => runtime.call('graph-db.getNode', id);

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
	const selectedModel = selectedProvider?.manifest.inferenceModels?.[0];
	const modelOptions = selectedProvider ? [{ value: "", text: "Choose a model..." }, ...selectedProvider.manifest.inferenceModels.map(m => ({ value: m.id, text: `${m.name} - ${m.bestFor?.slice(0, 2).join(', ') || 'General'}` }))] : [{ value: "", text: "Select a provider first" }];

	return {
		"provider-model-form": {
			tag: "form", events: { submit: "inference.saveForm" },
			"provider-select": { tag: "select", name: "provider", value: selectedProviderName, required: true, options: providerOptions, events: { change: "inference.updateForm" }, style: "width: 100%; margin-bottom: 16px;" },
			"model-select": { tag: "select", name: "model", value: selectedModel?.id || "", required: true, disabled: !selectedProvider, options: modelOptions, style: "width: 100%; margin-bottom: 16px;" },
			...(selectedProvider && { "info": { tag: "div", text: `Provider: ${selectedProvider.manifest.name} | Models: ${selectedProvider.manifest.inferenceModels?.length || 0}`, style: "background: var(--bg-tertiary); padding: 12px; border-radius: 6px; margin-bottom: 20px; font-size: 14px;" } }),
			"actions": {
				tag: "div", style: "display: flex; gap: 12px; justify-content: flex-end; padding-top: 16px; border-top: 1px solid var(--border-primary);",
				"cancel": { tag: "button", type: "button", text: "Cancel", class: "cognition-button-secondary", events: { click: "ui.closeModal" } },
				"submit": { tag: "button", type: "submit", text: "Save", class: "cognition-button-primary", disabled: !selectedProvider }
			}
		}
	};
};

// Update form when dependent fields change (like provider selection)
export const updateForm = async (eventData) => {
	const selectedProviderName = eventData.target.value;
	const updatedTree = buildFormTree(selectedProviderName);
	await runtime.call('ui.showModal', {
		title: "Configure AI Provider & Model",
		tree: updatedTree
	});
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

export const infer = async (query) => {
	await prompt({ query });
}

export const prompt = async (params) => {
	const { query, systemPrompt, webSearch, loadSource = false } = params;
	const targetProvider = params.provider ? providers.find(p => p.manifest.name === params.provider) : provider;
	const targetModel = params.model ? targetProvider?.manifest.inferenceModels?.find(m => m.id === params.model) : model;
	(!targetProvider || !targetModel) && (() => { throw new Error('No provider/model configured'); })();

	const messages = await runtime.call("context.assemble", query, systemPrompt);
	const response = await provider.makeRequest(model, messages, webSearch);
	!response.ok && (() => { throw new Error(`${provider.manifest.name} API error: ${response.status}`); })();

	const content = await provider.getContent(response);
	if (loadSource) {
		const nodeId = await addInferenceNode(query, messages, content, model.id, provider.manifest.name);
		const tree = inferenceSourceTree(query, content);
		await runtime.call('manual-atom-extractor.loadSource', tree, { sourceId: nodeId, type: "inference interaction" });
	}
	return content;
};
const inferenceSourceTree = (query, content) => ({
	tag: "div",
	style: "flex: 1; padding: 15px; overflow-y: auto; line-height: 1.6;",
	data: { textSelectionHandler: "manual-atom-extractor.handleSelection" },
	"prompt-section": {
		tag: "div",
		style: "margin-bottom: 20px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid #4CAF50;",
		"prompt-label": { tag: "h4", text: "User Prompt", style: "margin: 0 0 10px 0; color: #4CAF50;" },
		"prompt-text": { tag: "div", text: query, style: "white-space: pre-wrap;" }
	},
	"response-section": {
		tag: "div",
		style: "padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid #2196F3;",
		"response-label": { tag: "h4", text: "AI Response", style: "margin: 0 0 10px 0; color: #2196F3;" },
		"response-text": { tag: "div", text: content, style: "white-space: pre-wrap;" }
	}
});

export const showProviderModule = () => provider && model ? runtime.log(`[Inference] ${provider.manifest.name} - ${model.name}`) : runtime.log('[Inference] Not configured');