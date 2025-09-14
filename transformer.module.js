export const manifest = {
	name: 'transformer',
	context: ["offscreen"],
	version: "1.0.0",
	description: 'Hugging Face Transformers.js runtime with WebGPU/WebNN support',
	actions: ["getModel", "listModels", "getModelName"],
	externalDependencies: [
		{ name: 'transformers.js', destination: 'libs/', url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.1/dist/transformers.js', sha256: '5EA4225E8819337274E171D7D80EFA3BEF97F2678EDD33949184A72322CC9CC5' },
		{ name: 'onnx-runtime-webgpu', destination: 'onnx-runtime/', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.mjs', sha256: 'C4FE924C20A6C53B64F6F1C6842F28DEF2659817F80F04628D906015BA21F655' },
		{ name: 'ort-wasm-simd-threaded.jsep.mjs', destination: 'onnx-runtime/', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.mjs', sha256: '1CBCBA8F2C769C1EECBAB66A1B1E55EF11704515BF4306373E3DB3C37CF6DCD8' },
		{ name: 'ort-wasm-simd-threaded.jsep.wasm', destination: 'onnx-runtime/', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.jsep.wasm', sha256: 'B45970D0632383A057C27CA5B660B216F8E00C17CF8DB9F6207B5E4ABC839368' },
		{ name: 'ort-wasm-simd-threaded.wasm', destination: 'onnx-runtime/', url: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.wasm', sha256: '71AEF04959C5C1B6DE461B6538E2058E306610034A85AAD2742D0C7FD4533FE4' }
	]
};

const pipelineCache = new Map();
let runtime, log;
let Transformer;

export const initialize = async (rt, l) => {
	runtime = rt;
	log = l;
	await initializeEnvironment();
	await preloadModels();
};

const initializeEnvironment = async () => {
	Transformer = await loadTransformer();

	const env = Transformer.env;
	// Configure environment
	env.allowRemoteModels = false;
	env.useBrowserCache = false;
	env.allowLocalModels = true;
	env.localModelPath = chrome.runtime.getURL('models/');
	env.backends.onnx.logLevel = 'fatal';

	// Configure WASM paths for JSEP (WebGPU/WebNN support)
	if (env.backends?.onnx?.wasm) {
		env.backends.onnx.wasm.numThreads = 1;
		env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('onnx-runtime/');
		env.backends.onnx.wasm.proxy = false;
	}
};
const loadTransformer = async () => await import(chrome.runtime.getURL('libs/transformers.js'));

const preloadModels = async () => {
	const models = [...new Set(runtime.getModulesWithProperty('localModels').flatMap(module => module.manifest.localModels))];
	for (const model of models) {
		try { await loadModel(model) }
		catch (error) { log.error(` ❌ Failed to preload ${model}:`, error) }
	}
	log.log(` Preloaded models:`, listModels());
};
const loadModel = async (model) => {
	const name = getModelName(model);
	if (pipelineCache.has(name)) return pipelineCache.get(name);
	log.log(` Loading model ${name}...`);
	try {
		const pipe = await Transformer.pipeline('feature-extraction', model.name, model.options || {});
		pipelineCache.set(name, pipe);
	} catch (error) {
		log.error(` loading ${name} failed:`, {
			message: error.message,
			stack: error.stack,
			modelName: model.name,
			options: model.options
		});
	}
};
export const getModel = (modelId) => pipelineCache.get(modelId);
export const listModels = () => Array.from(pipelineCache.keys());
export const getModelName = (model) => `${model.name}-${model.options.dtype}-${model.options.device}`;