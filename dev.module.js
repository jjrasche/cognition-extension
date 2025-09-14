import { kebabToCamel } from './helpers.js';

export const manifest = {
	name: "dev",
	context: ["service-worker", "extension-page", "offscreen"],
	version: "1.0.0",
	description: "Development utilities and shortcuts for debugging",
	permissions: ["storage"],
	actions: ["testEmbeddingSpeed", "updateSuperintendentData", "testModules", "testSegmenterCompleteness", "quickLogs", "handleLogsCommand"],
	config: {
		quickLogsKey: { type: 'globalKey', value: 'Ctrl+Shift+L', label: 'Quick Logs to Clipboard', action: "quickLogs" },
		logsCommandKey: { type: 'globalKey', value: 'Ctrl+Shift+G', label: 'Query Logs Command', action: "handleLogsCommand", description: 'Type "logs [filter]" in any input to copy recent logs to clipboard' }
	}
};

let runtime;
export async function initialize(rt) {
	runtime = rt;
	runtime.log('[Dev] Initializing development helpers...');
	createActionShortcuts();
	runtime.log('[Dev] Development helpers ready');
}

const isDevMode = () => runtime.runtimeName == "offscreen" || !chrome.runtime.getManifest().update_url;

const createActionShortcuts = () => {
	if (!isDevMode()) {
		runtime.log('[Dev] Production mode - skipping dev shortcuts');
		return;
	}
	addModuleToConsole();
	addModuleActionsToConsole();
	addEasyAccessVariablesToConsole();
};
const addModuleToConsole = () => runtime.getContextModules().forEach(module => {
	const camelModuleName = kebabToCamel(module.manifest.name);
	globalThis[camelModuleName] = {};
	globalThis[camelModuleName].manifest = module.manifest;
	globalThis[camelModuleName].test = async () => runtime.showTests(await runtime.runModuleTests(module));
});

const addModuleActionsToConsole = () => {
	for (let [name] of runtime.getActions().entries()) {
		const [moduleName, actionName] = name.split('.');
		const camelModuleName = kebabToCamel(moduleName);
		globalThis[camelModuleName] ??= {};
		globalThis[camelModuleName][actionName] = (...args) => {
			return runtime.call(name, ...args)
				.then(res => (runtime.log(`[Dev] ${camelModuleName}.${actionName} →`, res), res))
				.catch(err => (runtime.logError(`[Dev] ${camelModuleName}.${actionName} ✗`, err), Promise.reject(err)));
		};
	}
};

const addEasyAccessVariablesToConsole = () => {
	// Add runtime reference
	globalThis.runtime = runtime;
	// Add pretty print functions
	globalThis.printActions = prettyPrintActions;
	globalThis.printModules = prettyPrintModules;
	globalThis.printModuleState = prettyPrintModuleState;
	// Add quick status check
	globalThis.printStatus = () => {
		runtime.log('=== Extension Status ===');
		runtime.log('Context:', runtime.runtimeName);
		runtime.log('Loaded Modules:', runtime.getContextModules().map(m => m.manifest.name));
		runtime.log('Module States:', Object.fromEntries(runtime.moduleState));
		runtime.log('Registered Actions:', Array.from(runtime.getActions().keys()).length);
		runtime.log('Errors:', runtime.errors);
	};
	runtime.log('[Dev] Added global helpers: runtime, modules, printActions(), printModules(), printModuleState(), Status()');
};

const prettyPrintActions = () => {
	const actions = {};
	for (let [name] of runtime.getActions().entries()) {
		const [moduleName, actionName] = name.split('.');
		actions[name] = { module: moduleName, action: actionName };
	}
	console.table(actions);
};

const prettyPrintModules = () => {
	const moduleInfo = runtime.getContextModules().map(module => ({
		name: module.manifest.name,
		version: module.manifest.version,
		context: module.manifest.context || 'any',
		dependencies: (module.manifest.dependencies || []).join(', ') || 'none',
		actions: (module.manifest.actions || []).length
	}));
	console.table(moduleInfo);
};

const prettyPrintModuleState = () => {
	const states = {};
	for (let [name, state] of runtime.moduleState.entries()) {
		states[name] = state;
	}
	console.table(states);
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
		const avgDuration = Math.round(times.reduce((sum, time) => sum + time, 0) / runs);
		results.push({ modelName, avgDuration });
	}

	const sorted = results.sort((a, b) => a.avgDuration - b.avgDuration);
	console.table(sorted);
	return sorted;
}

export const queryLogs = async (filters) => {
	const logs = await runtime.call('chrome-local.get', 'runtime.logs') || [];
	let filtered = logs;

	// Handle string filter as shorthand for contains
	if (typeof filters === 'string') filters = { contains: filters };

	if (filters.contains) filtered = filtered.filter(log => log.message.includes(filters.contains));
	if (filters.context) filtered = filtered.filter(log => log.context === filters.context);
	if (filters.lastN) filtered = filtered.slice(-filters.lastN);

	return filtered.map(log => {
		const dataStr = log.data ? ` | ${log.data}` : '';
		return `${log.context}: ${log.message}${dataStr}`;
	});
};
const matchesFilters = (log, filters) => {
	if (filters.contains && !log.message.includes(filters.contains)) return false;
	if (filters.context && log.context !== filters.context) return false;
	if (filters.since && log.time < filters.since) return false;
	if (filters.level && !log.message.includes(`[${filters.level}]`)) return false;
	return true;
};

export const quickLogs = async () => {
	const logs = await queryLogs({ lastN: 20 });
	try {
		await navigator.clipboard.writeText(logs.join('\n'));
		runtime.log('[Dev] Last 20 logs copied to clipboard');
	} catch (error) {
		runtime.logError('[Dev] Clipboard copy failed:', error);
		// Maybe fallback to console.log the logs?
	}
};

export const handleLogsCommand = async (input) => {
	const parts = input.split(' ').slice(1); // Remove 'logs'
	const filter = parts.join(' ') || {};
	const logs = await queryLogs(filter);

	// Copy to clipboard if available
	if (typeof navigator !== 'undefined' && navigator.clipboard) {
		const logText = logs.join('\n');
		await navigator.clipboard.writeText(logText);
		runtime.log('[Dev] Logs copied to clipboard:', { count: logs.length, filter });
		return { message: `${logs.length} logs copied to clipboard`, logs };
	} else {
		runtime.log('[Dev] Logs query result:', { count: logs.length, filter });
		return logs;
	}
};