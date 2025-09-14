import { kebabToCamel } from './helpers.js';

export const manifest = {
	name: "dev",
	context: ["service-worker", "extension-page", "offscreen"],
	version: "1.0.0",
	description: "Development utilities and shortcuts for debugging",
	permissions: ["storage"],
	actions: ["testEmbeddingSpeed", "searchLogs", "clearLogs", "toggleAutoRefresh", "copyAllLogs", "setLogLevel"],
	uiComponents: [
		{ name: "log-viewer", getTree: "buildLogViewer" }
	],
	config: {
		quickLogsKey: { type: 'globalKey', value: 'Ctrl+Shift+L', label: 'Filter Logs from Clipboard', action: "getLogs" },
		last20LogsKey: { type: 'globalKey', value: 'Ctrl+Shift+K', label: 'Filter All Logs', action: "allLogs" }
	}
};

let runtime, log, currentSearch = '', filteredLogs = [], allLogEntries = [], isAutoRefresh = true, refreshInterval = null, currentLogLevel = 'log';
export const initialize = async (rt, l) => {
	runtime = rt;
	log = l;
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
			.then(res => (log.log(` ${camelModuleName}.${actionName} →`, res), res))
			.catch(err => (log.error(` ${camelModuleName}.${actionName} ✗`, err), Promise.reject(err)));
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

// === LOG VIEWER ===
const LOG_LEVELS = { info: 0, log: 1, warn: 2, error: 3 };
let searchTimeout = null, dataTruncateLength = 100;
export const searchLogs = async (eventData) => {
	const searchTerm = eventData.target.value.toLowerCase();
	clearTimeout(searchTimeout);
	searchTimeout = setTimeout(() => {
		currentSearch = searchTerm;
		applyFilter();
		refreshLogViewer();
	}, 150); // Debounce search
};

export const clearLogs = async () => {
	await runtime.call('chrome-local.remove', 'runtime.logs');
	allLogEntries = [];
	filteredLogs = [];
	await refreshLogViewer();
};

export const toggleAutoRefresh = async () => {
	isAutoRefresh = !isAutoRefresh;
	isAutoRefresh ? startLogPolling() : stopLogPolling();
	await refreshLogViewer();
};

const loadLogs = async () => {
	const logs = (await runtime.call('chrome-local.get', 'runtime.logs')) || [];
	allLogEntries = logs.sort((a, b) => b.time - a.time);
	applyFilter();
};

const applyFilter = () => {
	let filtered = allLogEntries;

	// Apply log level filter
	const minLevel = LOG_LEVELS[currentLogLevel];
	filtered = filtered.filter(log => LOG_LEVELS[log.level || 'log'] >= minLevel);

	// Apply search filter (if search exists, show all levels)
	if (currentSearch) {
		filtered = allLogEntries.filter(log =>
			log.message.toLowerCase().includes(currentSearch) ||
			log.context.toLowerCase().includes(currentSearch) ||
			(log.data && String(log.data).toLowerCase().includes(currentSearch))
		);
	}

	filteredLogs = filtered.sort((a, b) => b.time - a.time);
};

export const setLogLevel = async (eventData) => {
	currentLogLevel = eventData.target.value;
	applyFilter();
	await refreshLogViewer();
};

const startLogPolling = () => {
	if (refreshInterval) return;
	refreshInterval = setInterval(async () => {
		if (isAutoRefresh) {
			const oldCount = allLogEntries.length;
			await loadLogs();
			if (allLogEntries.length !== oldCount) await refreshLogViewer();
		}
	}, 2000); // Reduced frequency
};

const stopLogPolling = () => {
	if (refreshInterval) {
		clearInterval(refreshInterval);
		refreshInterval = null;
	}
};

export const copyLogEntry = async (eventData) => {
	const index = parseInt(eventData.target.closest('[data-log-index]').dataset.logIndex);
	const log = filteredLogs[index];
	if (!log) return;
	await navigator.clipboard.writeText(formatLogEntry(log, getStartTime()));
};
export const copyAllLogs = async () => {
	if (filteredLogs.length === 0) return;
	const startTime = getStartTime();
	const formatted = filteredLogs.map(log => formatLogEntry(log, startTime)).join('\n\n');
	await navigator.clipboard.writeText(formatted);
	log.log(` Copied ${filteredLogs.length} filtered logs to clipboard`);
};
const getStartTime = () => allLogEntries.length > 0 ? Math.min(...allLogEntries.map(l => l.time)) : Date.now();
const formatLogEntry = (log, startTime) => `${formatTime(log.time - startTime)} [${log.context}] ${log.message}\n${formatData(log.data).substring(0, dataTruncateLength)}`;
const formatTime = (timestamp) => new Date(timestamp).toLocaleTimeString('en-US', { hour12: false });
const formatData = (data) => { try { return JSON.stringify(data); } catch { return String(data); } };

const refreshLogViewer = () => runtime.call('layout.renderComponent', 'log-viewer');
const buildLogEntries = () => {
	if (filteredLogs.length === 0) {
		return { "empty": { tag: "div", style: "text-align: center; color: var(--text-muted); padding: 20px;", text: currentSearch ? "No matching logs" : "No logs yet" } };
	}
	const displayLogs = filteredLogs.slice(0, 200);
	return Object.fromEntries(
		displayLogs.map((log, i) => [`log-${i}`, {
			tag: "div", style: "margin: 1px 0; padding: 2px 4px; border-radius: 2px; line-height: 1.2; cursor: pointer;",
			events: { click: "dev.copyLogEntry" }, "data-log-index": i,
			"time": { tag: "span", style: "color: var(--text-muted); margin-right: 6px; font-size: 10px;", text: formatTime(log.time) },
			"context": { tag: "span", style: "background: var(--bg-tertiary); padding: 1px 4px; border-radius: 2px; margin-right: 6px; font-size: 10px; color: var(--text-muted);", text: log.context },
			"module": { tag: "span", style: "background: var(--bg-tertiary); padding: 1px 4px; border-radius: 2px; margin-right: 6px; font-size: 10px; color: var(--text-muted);", text: log.module },
			"message": { tag: "span", style: "color: var(--text-primary);", text: log.message },
			...buildLogData(log.data)
		}])
	);
};

const buildLogData = (data) => {
	if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) return {};

	let parsedData = data;
	if (typeof data === 'string') {
		try { parsedData = JSON.parse(data); } catch { }
	}

	// Handle error objects specially
	if (parsedData && typeof parsedData === 'object' && parsedData.message && parsedData.stack) {
		return {
			"error": {
				tag: "div", style: "margin-left: 16px; margin-top: 2px;",
				"error-msg": { tag: "div", style: "color: #ff6b6b; font-size: 10px; font-weight: 500;", text: `❌ ${parsedData.name || 'Error'}: ${parsedData.message}` },
				"stack": { tag: "div", style: "color: var(--text-muted); font-size: 9px; font-family: monospace; max-height: 60px; overflow: hidden; white-space: pre; margin-top: 2px;", text: parsedData.stack?.split('\n').slice(0, 4).join('\n') + (parsedData.stack?.split('\n').length > 4 ? '\n...' : '') }
			}
		};
	}

	// Handle regular data
	const displayText = typeof parsedData === 'string' ? parsedData : JSON.stringify(parsedData, null, 2);
	return {
		"data": {
			tag: "div",
			style: "color: var(--text-muted); margin-left: 16px; font-size: 10px; white-space: pre-wrap; max-height: 60px; overflow: hidden; margin-top: 2px;",
			text: displayText.slice(0, dataTruncateLength) + (displayText.length > dataTruncateLength ? '...' : '')
		}
	};
};

let isInitialized = false;
export const buildLogViewer = () => {
	if (!isInitialized) {
		loadLogs();
		if (isAutoRefresh) startLogPolling();
		isInitialized = true;
	}

	return {
		"log-viewer": {
			tag: "div", style: "height: 100%; display: flex; flex-direction: column; background: var(--bg-secondary); font-family: monospace; font-size: 12px;",
			"header": {
				tag: "div", style: "padding: 8px; border-bottom: 1px solid var(--border-primary); display: flex; gap: 8px; align-items: center; background: var(--bg-tertiary);",
				"level-select": { tag: "select", value: currentLogLevel, style: "padding: 4px; border: 1px solid var(--border-primary); border-radius: 3px; background: var(--bg-input); font-size: 11px;", events: { change: "dev.setLogLevel" }, options: [{ value: "info", text: "Info+" }, { value: "log", text: "Log+" }, { value: "warn", text: "Warn+" }, { value: "error", text: "Error" }] },
				"search": { tag: "input", type: "text", placeholder: "Search logs...", value: currentSearch, focus: true, style: "flex: 1; padding: 4px 8px; border: 1px solid var(--border-primary); border-radius: 3px; background: var(--bg-input); font-family: inherit; font-size: 11px;", events: { input: "dev.searchLogs" } },
				"count": { tag: "span", text: `${filteredLogs.length}/${allLogEntries.length}`, style: "color: var(--text-muted); white-space: nowrap; font-size: 10px;" },
				"copy-all-btn": { tag: "button", text: "📋", class: "cognition-button-secondary", style: "padding: 2px 6px; font-size: 10px;", events: { click: "dev.copyAllLogs" }, title: `Copy all ${filteredLogs.length} filtered logs`, disabled: filteredLogs.length === 0 },
				"auto-btn": { tag: "button", text: isAutoRefresh ? "⏸" : "▶", class: "cognition-button-secondary", style: "padding: 2px 6px; font-size: 10px;", events: { click: "dev.toggleAutoRefresh" }, title: isAutoRefresh ? "Pause auto-refresh" : "Start auto-refresh" },
				"clear-btn": { tag: "button", text: "🗑", class: "cognition-button-secondary", style: "padding: 2px 6px; font-size: 10px;", events: { click: "dev.clearLogs" }, title: "Clear all logs" }
			},
			"logs": {
				tag: "div", style: "flex: 1; overflow-y: auto; padding: 4px;",
				...buildLogEntries()
			}
		}
	};
};