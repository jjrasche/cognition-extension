import { modules } from './module-registry.js';
import { retryAsync, asserts, truncateOrNA, runUnitTest } from './helpers.js';
import { remove } from './chrome-local.module.js';
class Runtime {
	MODULE_INIT_TIMEOUT = 15000;
	RETRY_INTERVAL = 100;
	CROSS_CONTEXT_TIMEOUT = 9000;
	
	constructor(runtimeName) {
		this.runtimeName = runtimeName;
		this.actions = new Map();
		this.contextModules = [];
		this.errors = [];
		this.moduleState = new ObservableModuleState();
		this.testUtils = { ...asserts, runUnitTest };
		this.testResults = [];
		this.allContextTestResults = new Map();
		this.allContextTestedModules = new Set();
		this.log = this.createModuleLogger('Runtime');
	}
	initialize = async () => {
		if (this.runtimeName === 'service-worker') {
			await remove('runtime.logs'); // todo: keep historical logs and rotate
		}
		try {
			await this.loadModulesForContext();
			this.registerActions();
			this.log.log('🚀 Runtime initialization started');
			this.setupMessageListener();
			await this.initializeModules();
			// await this.runTests();
			this.log.log('Module initialization complete', { context: this.runtimeName, loadedModules: this.contextModules.map(m => m.manifest.name), moduleStates: Object.fromEntries(this.moduleState) });
		} catch (error) {
			this.log.error(`Initialization failed in ${this.runtimeName}`, error);
		}
	}
	
	loadModulesForContext = async () => this.contextModules = modules.filter(module => module.manifest.context && module.manifest.context.includes(this.runtimeName));
	getModuleActions = (module) => module.manifest.actions?.filter(action => this.exportedActions(module).includes(action)) || [];
	exportedActions = (module) => Object.getOwnPropertyNames(module)
	.filter(prop => typeof module[prop] === 'function')
	.filter(name => !['initialize', 'cleanup', 'manifest', 'default', 'test'].includes(name));
	// Register actions from modules across all contexts to enable cross-context function calling
	registerActions = () => {
		modules.forEach(module => {
			try { this.getModuleActions(module).filter(action => typeof module[action] === 'function').forEach(action => this.registerAction(module, action)); }
			catch (error) { this.log.error(` Failed to register [${module.manifest.name}] actions:`, { error: error.message }); }
		});
	}
	registerAction = (module, action) => this.actions.set(`${module.manifest.name}.${action}`, { func: module[action], context: this.runtimeName, moduleName: module.manifest.name });
	moduleInContext = (moduleName) => this.contextModules.find(m => m.manifest.name === moduleName);
	setupMessageListener = () => {
		chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
			if (this.handleModuleStateMessage(message) || this.handletTabStabilityMessage(message) || this.handleTestResultsMessage(message)) return;
			if (!message.action) return;
			const [moduleName] = message.action.split('.');
			if (!this.moduleInContext(moduleName)) return false;
			const args = Array.isArray(message.params) ? message.params : [message.params || {}];
			this.executeAction(message.action, ...args)
			.then(result => sendResponse(result))
			.catch(error => {
				this.log.error(`Action ${message.action} failed`, { error: error.message, context: this.runtimeName });
				sendResponse({ error: error.message });
			});
			return true;
		});
	}
	handletTabStabilityMessage = (message) => {
		if (message.type === 'TAB_STABILITY') {
			const { elapsed, networkStable, contentStable, url } = message.data;
			this.log.log(` ${url}: ${elapsed}ms | Network: ${networkStable} | Content: ${contentStable}`);
			return true;
		}
	}
	handleModuleStateMessage = (message) => (this.handleModuleFailedMessage(message) || this.handleModuleReadyMessage(message));
	handleModuleFailedMessage = (message) => {
		if (message.type === 'MODULE_FAILED') {
			if (!this.moduleInContext(message.moduleName)) this.moduleState.set(message.moduleName, 'failed');
			return true;
		}
	}
	handleModuleReadyMessage = (message) => {
		if (message.type === 'MODULE_READY') {
			if (!this.moduleInContext(message.moduleName)) this.moduleState.set(message.moduleName, 'ready');
			return true;
		}
	}
	handleTestResultsMessage = (message) => {
		if (message.type === 'TEST_RESULTS') {
			this.log.log(`Received TEST_RESULTS from ${message.context} with ${message.results.length} results`);
			this.allContextTestResults.set(message.context, message.results);
			
			// Track tested modules even if they have no results
			if (message.testedModules) {
				this.allContextTestedModules = this.allContextTestedModules || new Set();
				message.testedModules.forEach(module => this.allContextTestedModules.add(module));
			}
			
			if (this.areAllTestsComplete()) this.showTests();
			return true;
		}
	};
	areAllTestsComplete = () => {
		const modulesWithTests = this.getModulesWithProperty("test").map(m => m.manifest.name);
		
		// Check both results and tracked tested modules
		const modulesWithResults = new Set(Array.from(this.allContextTestResults.values()).flat().map(result => result.module));
		const allTestedModules = new Set([
			...modulesWithResults,
			...(this.allContextTestedModules || [])
		]);
		
		const ret = [...modulesWithTests].every(moduleName => allTestedModules.has(moduleName));
		this.log.log(`expected ${modulesWithTests} to be complete, got ${[...allTestedModules]}`);
		return ret;
	};
	
	initializeModules = async () => {
		await Promise.all(this.contextModules.map(async (module) => {
			try {
				await module.initialize?.(this, this.createModuleLogger(module.manifest.name));
				this.broadcastModuleReady(module.manifest.name);
				this.log.log(` Module ${module.manifest.name} initialized`);
			} catch (error) {
				this.log.error(`[${this.runtimeName}] Module ${module.manifest.name} failed to initialize`, error);
				this.broadcastModuleFailed(module.manifest.name);
			}
		}));
	}
	broadcastModuleStatus = async (moduleName, state) => {
		const type = `MODULE_${state.toUpperCase()}`;
		this.moduleState.set(moduleName, state);
		await retryAsync(async () => chrome.runtime.sendMessage({ type, moduleName, fromContext: this.runtimeName }), {
			maxAttempts: this.MODULE_INIT_TIMEOUT / this.RETRY_INTERVAL, delay: this.RETRY_INTERVAL,
			// onRetry: (error, attempt, max) => { this.log.log(`Retry ${attempt}/${max} for ${type} message for ${moduleName}`) 
		}).catch(() => this.log.error(`Failed to send ${type} message for ${moduleName} in ${this.runtimeName}`));
	};
	broadcastModuleReady = (moduleName) => {
		this.broadcastModuleStatus(moduleName, 'ready');
		this.checkAllModulesInitialized();
	}
	broadcastModuleFailed = (moduleName) => { this.broadcastModuleStatus(moduleName, 'failed'); this.checkAllModulesInitialized(); }
	checkAllModulesInitialized = () => this.allModulesInitialized() && this.log.log(this.allModulesReady() ? '🎉 Extension ready!' : '⚠️ Extension Failed to Load Some Modules!');
	allModulesInitialized = () => modules.map(m => m.manifest.name).every(moduleName => this.moduleState.has(moduleName));
	allModulesReady = () => modules.map(m => m.manifest.name).every(moduleName => this.moduleState.get(moduleName) === 'ready');
	broadcastTestResults = async () => {
		const testedModules = this.contextModules
		.filter(module => this.moduleHasProperty(module, "test"))
		.map(module => module.manifest.name);
		
		await retryAsync(async () => chrome.runtime.sendMessage({
			type: 'TEST_RESULTS',
			context: this.runtimeName,
			results: this.testResults,
			testedModules // Add this
		}))
		.then(() => this.log.log(`Sent TEST_RESULTS message in ${this.runtimeName}`))
		.catch(() => this.log.error(`Failed to send TEST_RESULTS message in ${this.runtimeName}`));
	};
	
	call = async (actionName, ...args) => {
		const [moduleName] = actionName.split('.');
		if (this.moduleInContext(moduleName)) {
			await this.waitForModule(moduleName);
			const result = await this.executeAction(actionName, ...args);
			return result;
		}
		return await retryAsync(async () => {
			return new Promise((resolve, reject) => {
				chrome.runtime.sendMessage({ action: actionName, params: args },
					response => {
						if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
						else if (response?.error) reject(new Error(response.error));
						else resolve(response);
					}
				);
			});
		}, {
			maxAttempts: this.MODULE_INIT_TIMEOUT / this.RETRY_INTERVAL, delay: this.RETRY_INTERVAL,
			// onRetry: (error, attempt) => this.log.log(`Retry ${attempt} for ${actionName}: ${error.message}`),
			shouldRetry: (error) => error.message.includes('port closed') || error.message.includes('Receiving end does not exist')
		});
	}
	
	waitForModule = async (moduleName, timeout = this.MODULE_INIT_TIMEOUT) => {
		if (this.isReady(moduleName)) return;
		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => { unsubscribe(); reject(new Error(`Module ${moduleName} not ready after ${timeout}ms`)); }, timeout);
			const listener = (name, state) => (name === moduleName && state === 'ready') ? (clearTimeout(timeoutId), unsubscribe(), resolve()) : null;
			const unsubscribe = this.moduleState.addListener(listener);
			if (this.isReady(moduleName)) { clearTimeout(timeoutId); unsubscribe(); resolve(); } // try initially
		});
	}
	getState = (moduleName) => this.moduleState.get(moduleName);
	isReady = (moduleName) => this.getState(moduleName) === 'ready';
	createFunctionParamsDebugObject = (func, args) => {
		const match = func.toString().match(/\(([^)]*)\)/);
		const paramNames = match ? match[1].split(',').map(p => p.trim().split('=')[0].trim()).filter(Boolean) : [];
		return paramNames.reduce((debugObj, paramName, index) => { if (index < args.length) debugObj[paramName] = args[index]; return debugObj; }, {});
	};
	// todo: make dynamic later
	unloggedCommands = ["command.handleCommandInput", "dev.buildLogViewer", "layout.renderComponent", "tree-to-dom.transform", "api-keys.getKey"];
	async executeAction(actionName, ...args) {
		const action = this.getAction(actionName);
		if (!action) Error(`Action not found: ${actionName}`);
		const params = this.createFunctionParamsDebugObject(action, args);
		try {
			const result = await action.func(...args);
			if (!this.unloggedCommands.includes(actionName)) this.log.log(`Action executed: ${actionName}`, { ...params, result });
			return result;
		} catch (error) { this.log.error(`Action failed: ${actionName}`, { ...params, error }); }
	}
	getAction = (actionName) => {
		const action = this.actions.get(actionName);
		if (!action) this.log.error(`Action not found: ${actionName}`, { context: this.runtimeName });
		return action;
	}
	
	// Utility methods for modules
	getContextModules = () => [...this.contextModules];
	getActions = () => new Map(this.actions);
	getModulesWithProperty = (prop) => modules.filter(module => this.moduleHasProperty(module, prop));
	moduleHasProperty = (module, prop) => prop in module || prop in module.manifest;
	wait = async (ms = 100) => await new Promise(resolve => setTimeout(resolve, ms));
	waitForCondition = (conditionFn, { maxAttempts = 30, interval = 100 } = {}) => new Promise((resolve) => {
		let attempts = 0;
		const check = () => {
			const result = conditionFn();
			(result || attempts >= maxAttempts) ? resolve(result) : (attempts++, setTimeout(check, interval));
		};
		check();
	});
	processWithWorkerPool = async (items, processFunc, maxConcurrency = 3, startIndex = 0) => {
		let index = startIndex;
		const numWorkers = Math.min(maxConcurrency, items.length);
		debugger;
		const workers = Array(numWorkers).fill(1).map(async () => {
			while (index < items.length) {
				await processFunc(items[index++]);
			}
		});
		await Promise.all(workers);
	};
	
	createModuleLogger = (moduleName) => ({
		info: (message, data) => this.internalLog(message, moduleName, data, 'info'),
		log: (message, data) => this.internalLog(message, moduleName, data, 'log'),
		warn: (message, data) => this.internalLog(message, moduleName, data, 'warn'),
		error: (message, data) => this.internalLog(message, moduleName, data, 'error')
	});
	lastPersist = 0;
	PERSIST_INTERVAL = 100;
	internalLog = (message, moduleName, data, severity = 'log') => {
		if (message.includes('chrome-local.') || message.includes('chrome-sync.')) return;
		this.printLog(console[severity], message, moduleName, data);
		const now = Date.now();
		if (now - this.lastPersist > this.PERSIST_INTERVAL) {
			this.lastPersist = now;
			this.persistLog(message, moduleName, data, severity).catch(() => {});
		}
	};
	printLog = async (func, message, moduleName, data) => func(`(${this.runtimeName}) [${moduleName}] ${message}`, data || '');
	persistLog = async (message, moduleName, data, severity) => await this.call('chrome-local.append', 'runtime.logs', this.createLog(message, moduleName, data, severity));
	createLog = (message, moduleName, data, severity = 'log') => ({
		time: Date.now(),
		context: this.runtimeName,
		module: moduleName,
		message,
		level: severity,
		data: data instanceof Error ? { message: data.message, stack: data.stack, name: data.name } : data
	});
	// testing
	runTests = async () => {
		if (!this.testResults) return;
		const mods = this.contextModules.filter(module => this.moduleHasProperty(module, "test"));
		const t = await Promise.all(mods.map(async mod => {
			const newTests = await this.runModuleTests(mod);
			this.testResults = this.testResults.concat(newTests);
		}));
		this.log.log(`All tests complete. Total: ${this.testResults.length}`);
		this.allContextTestResults = this.allContextTestResults.set(this.runtimeName, this.testResults);
		this.broadcastTestResults();
		if (this.areAllTestsComplete()) this.showTests();
	};
	runModuleTests = async (module) => {
		this.log.log(`Running tests for module: ${module.manifest.name}`);
		return (await module['test']()).map(test => ({ ...test, module: module.manifest.name }));
	};
	showTests = (results) => {
		results = results ?? Array.from(this.allContextTestResults.values()).flat();
		this.showModuleSummary(results);
		this.showTestFailures(results);
	};
	showModuleSummary = (results) => {
		const moduleStats = results.reduce((acc, test) => {
			if (!acc[test.module]) acc[test.module] = { total: 0, passed: 0 };
			acc[test.module].total++;
			if (test.passed) acc[test.module].passed++;
			return acc;
		}, {});
		
		const totalTests = Object.values(moduleStats).reduce((sum, stats) => sum + stats.total, 0);
		const totalPassed = Object.values(moduleStats).reduce((sum, stats) => sum + stats.passed, 0);
		
		this.log.log(`\nOverall: ${totalPassed}/${totalTests} tests passed (${Math.round(totalPassed / totalTests * 100)}%)`);
		this.log.log('\n=== MODULE TEST RESULTS ===');
		console.table(Object.entries(moduleStats).map(([module, stats]) => ({
			Module: module,
			'Total Tests': stats.total,
			Passed: stats.passed,
			Failed: stats.total - stats.passed,
			'Pass Rate': stats.total > 0 ? `${Math.round(stats.passed / stats.total * 100)}%` : '0%'
		})));
	};
	showTestFailures = (results) => {
		const failedTests = results.filter(test => !test.passed);
		if (failedTests.length > 0) {
			this.log.log('\n=== FAILED TEST DETAILS ===');
			console.table(failedTests.map((test, i) => ({
				'Module': test.module,
				'Test #': i + 1,
				'Test Name': test.name,
				'Expected': truncateOrNA(test.expected),
				'Assert': test?.assert?.name ?? 'N/A',
				'Actual': truncateOrNA(test.actual)
			})));
			this.log.log(failedTests);
		}
	}
}

export function initializeRuntime(runtimeName) {
	const initializer = new Runtime(runtimeName);
	initializer.initialize();
	return initializer;
}

class ObservableModuleState extends Map {
	constructor() {
		super();
		this.listeners = new Set();
	}
	
	set(moduleName, state) {
		const oldState = this.get(moduleName);
		super.set(moduleName, state);
		this.listeners.forEach(listener => listener(moduleName, state, oldState));
		return this;
	}
	addListener(callback) {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback); // Return unsubscribe
	}
}