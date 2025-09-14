import { kebabToCamel } from './helpers.js';

export const manifest = {
	name: "dev",
	context: ["service-worker", "extension-page", "offscreen"],
	version: "1.0.0",
	description: "Development utilities and shortcuts for debugging",
	permissions: ["storage"],
	actions: ["testEmbeddingSpeed", "quickLogs", "last20Logs"],
	config: {
		quickLogsKey: { type: 'globalKey', value: 'Ctrl+Shift+L', label: 'Filter Logs from Clipboard', action: "quickLogs" },
		last20LogsKey: { type: 'globalKey', value: 'Ctrl+Shift+K', label: 'Filter Last 20 Logs from Clipboard', action: "last20Logs" }
	}
};

let runtime;
export async function initialize(rt) {
	runtime = rt;
	createActionShortcuts();
}

const isDevMode = () => runtime.runtimeName == "offscreen" || !chrome.runtime.getManifest().update_url;

const createActionShortcuts = () => {
	if (!isDevMode()) return;
	addModuleToConsole();
	addModuleActionsToConsole();
	addEasyAccessVariablesToConsole();
};

const addModuleToConsole = () => runtime.getContextModules().forEach(module => {
	const camelModuleName = kebabToCamel(module.manifest.name);
	globalThis[camelModuleName] = { manifest: module.manifest, test: async () => runtime.showTests(await runtime.runModuleTests(module)) };
});

const addModuleActionsToConsole = () => {
	for (let [name] of runtime.getActions().entries()) {
		const [moduleName, actionName] = name.split('.');
		const camelModuleName = kebabToCamel(moduleName);
		globalThis[camelModuleName] ??= {};
		globalThis[camelModuleName][actionName] = (...args) => runtime.call(name, ...args)
			.then(res => (runtime.log(`[Dev] ${camelModuleName}.${actionName} →`, res), res))
			.catch(err => (runtime.logError(`[Dev] ${camelModuleName}.${actionName} ✗`, err), Promise.reject(err)));
	}
};

const addEasyAccessVariablesToConsole = () => {
	globalThis.runtime = runtime;
	globalThis.printActions = () => console.table(Object.fromEntries([...runtime.getActions().keys()].map(name => [name, { module: name.split('.')[0], action: name.split('.')[1] }])));
	globalThis.printModules = () => console.table(runtime.getContextModules().map(m => ({ name: m.manifest.name, version: m.manifest.version, context: m.manifest.context?.join(',') || 'any', dependencies: m.manifest.dependencies?.join(',') || 'none', actions: m.manifest.actions?.length || 0 })));
	globalThis.printModuleState = () => console.table(Object.fromEntries(runtime.moduleState));
	globalThis.printStatus = () => {
		console.log('=== Extension Status ===');
		console.log('Context:', runtime.runtimeName);
		console.log('Loaded Modules:', runtime.getContextModules().map(m => m.manifest.name));
		console.log('Module States:', Object.fromEntries(runtime.moduleState));
		console.log('Registered Actions:', runtime.getActions().size);
	};
};

export const testEmbeddingSpeed = async (text, runs = 10) => {
	const models = await runtime.call('transformer.listModels');
	const results = [];
	for (const modelName of models) {
		const times = [];
		for (let i = 0; i < runs; i++) {
			const start = performance.now();
			await runtime.call('embedding.embedText', text, modelName);
			times.push(performance.now() - start);
		}
		results.push({ modelName, avgDuration: Math.round(times.reduce((sum, time) => sum + time, 0) / runs) });
	}
	const sorted = results.sort((a, b) => a.avgDuration - b.avgDuration);
	console.table(sorted);
	return sorted;
};

export const quickLogs = async (shouldFilter) => {
	try {
		const filter = shouldFilter ?? (await navigator.clipboard.readText()).trim();
		const logs = await runtime.call('chrome-local.get', 'runtime.logs') || [];
		const filtered = filter ? logs.filter(log => log.message.includes(filter)) : logs.slice(-20);
		const formatted = filtered.map(log => `${log.context}: ${log.message}${log.data ? ` | ${log.data}` : ''}`);
		await navigator.clipboard.writeText(formatted.join('\n'));
		return `${filtered.length} logs copied (filter: "${filter || 'recent'}")`;
	} catch (error) {
		return `Clipboard failed: ${error.message}`;
	}
};

export const last20Logs = async () => quickLogs(false);