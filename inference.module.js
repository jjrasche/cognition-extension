export const manifest = {
	name: "inference",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Manages LLM inference across multiple providers",
	dependencies: ["chrome-sync", "graph-db"],
	actions: ["prompt", "infer"],
	commands: [{ name: "call to inference", condition: input => input.startsWith('infer'), method: "infer" }],
	config: {
		provider: { type: 'select', value: '', label: 'AI Provider', description: 'Select your preferred AI provider', options: [{ value: '', text: 'Loading...' }] },
		model: { type: 'select', value: '', label: 'Model', description: 'Select the AI model to use', options: [{ value: '', text: 'Loading...' }] }
	}
};

let runtime, providers = [];
export const initialize = (rt) => {
	runtime = rt;
	registerProviders();
	setConfigOptions();
};

const registerProviders = () => providers = runtime.getModulesWithProperty('inferenceModels').filter(p => ['makeRequest', 'getContent'].every(fn => typeof p[fn] === 'function'));
const setConfigOptions = () => { setProviderConfigOptions(); setModelConfigOptions(); };
const setProviderConfigOptions = () => manifest.config.provider.options = [{ value: '', text: 'Select a provider...' }, ...providers.map(p => ({ value: p.manifest.name, text: `${p.manifest.name} (${p.manifest.inferenceModels?.length || 0} models)` }))];
const setModelConfigOptions = () => manifest.config.model["options"] = [{ value: '', text: 'Select a model...' }, ...(getSelectedProvider()?.manifest?.inferenceModels || []).map(m => ({ value: m.id, text: `${m.name} - ${m.bestFor?.slice(0, 2).join(', ') || 'General'}` }))];
export const infer = async (query) => await prompt({ query });
export const prompt = async (params) => {
	let { query, systemPrompt, webSearch, loadSource = false, provider, model } = params;
	provider = provider ?? getSelectedProvider(), model = model ?? getSelectedModel();
	if (!provider || !model) throw new Error("Inference provider/model not configured");
	const messages = await runtime.call("context.assemble", query, systemPrompt);
	const response = await provider.makeRequest(model, messages, webSearch);
	if (!response.ok) throw new Error(`${provider.manifest.name} API error: ${response.status}`);
	const content = await provider.getContent(response);
	loadSource && await runtime.call('manual-atom-extractor.loadSource', inferenceSourceTree(query, content), { sourceId: await addInferenceNode(query, messages, content, model.id, provider.manifest.name), type: "inference interaction" });
	return content;
};
const getSelectedProvider = () => providers.find(p => p.manifest.name === config.provider);
const getSelectedModel = () => getSelectedProvider()?.manifest.inferenceModels?.find(m => m.id === config.model);
const addInferenceNode = async (query, prompt, response, model, context) => runtime.call('graph-db.addNode', { type: 'inference', query, prompt, response, model, context, timestamp: new Date().toISOString() });
const inferenceSourceTree = (query, content) => ({
	tag: "div", style: "flex: 1; padding: 15px; overflow-y: auto; line-height: 1.6;", data: { textSelectionHandler: "manual-atom-extractor.handleSelection" },
	"prompt-section": { tag: "div", style: "margin-bottom: 20px; padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid #4CAF50;", "prompt-label": { tag: "h4", text: "User Prompt", style: "margin: 0 0 10px 0; color: #4CAF50;" }, "prompt-text": { tag: "div", text: query, style: "white-space: pre-wrap;" } },
	"response-section": { tag: "div", style: "padding: 15px; background: var(--bg-tertiary); border-radius: 8px; border-left: 4px solid #2196F3;", "response-label": { tag: "h4", text: "AI Response", style: "margin: 0 0 10px 0; color: #2196F3;" }, "response-text": { tag: "div", text: content, style: "white-space: pre-wrap;" } }
});