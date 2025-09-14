import { modules } from './module-registry.js';
import { retryAsync, asserts, truncateOrNA, runUnitTest } from './helpers.js';
import { remove } from './chrome-local.module.js';
class Runtime {
	constructor(runtimeName) {
		this.runtimeName = runtimeName;
		this.actions = new Map();
		this.contextModules = [];
		this.errors = [];
		this.moduleState = new ObservableModuleState();
		this.testUtils = { ...asserts, runUnitTest };
		// this.testResults = [];
		this.testResults = null;
		this.allContextTestResults = new Map();
	}
	initialize = async () => {
		if (this.runtimeName === 'service-worker') {
			await remove('runtime.logs'); // todo: keep historical logs and rotate
		}
		try {
			await this.loadModulesForContext();
			this.registerActions();
			this.log('[Runtime] Starting module initialization...');
			this.log('🚀 Runtime initialization started');
			this.setupMessageListener();
			await this.initializeModules();
			// setTimeout(async () => await this.runTests(), this.runtimeName === 'service-worker' ? 0 : 4000); // gives time to open devtools render engine to load for things like console.table
			await this.runTests();
			this.log('[Runtime] Module initialization complete', { context: this.runtimeName, loadedModules: this.contextModules.map(m => m.manifest.name), moduleStates: Object.fromEntries(this.moduleState) });
		} catch (error) {
			this.logError(`[Runtime] Initialization failed in ${this.runtimeName}`, error);
		}
	}

	loadModulesForContext = async () => {
		this.contextModules = modules.filter(module => module.manifest.context && module.manifest.context.includes(this.runtimeName));
	}

	getModuleActions = (module) => module.manifest.actions?.filter(action => this.exportedActions(module).includes(action)) || [];

	exportedActions = (module) => Object.getOwnPropertyNames(module)
		.filter(prop => typeof module[prop] === 'function')
		.filter(name => !['initialize', 'cleanup', 'manifest', 'default', 'test'].includes(name));

	// Register actions from modules across all contexts to enable cross-context function calling
	registerActions = () => {
		modules.forEach(module => {
			try {
				this.getModuleActions(module)
					.filter(action => typeof module[action] === 'function')
					.forEach(action => this.registerAction(module, action));
			}
			catch (error) {
				this.logError(` Failed to register [${module.manifest.name}] actions:`, { error: error.message });
			}
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

			// Handle both old (single params) and new (args array) formats
			const args = Array.isArray(message.params) ? message.params : [message.params || {}];

			this.executeAction(message.action, ...args)
				.then(result => sendResponse(result))
				.catch(error => {
					this.logError(`Action ${message.action} failed`, { error: error.message, context: this.runtimeName });
					sendResponse({ error: error.message });
				});
			return true;
		});
	}
	handletTabStabilityMessage = (message) => {
		if (message.type === 'TAB_STABILITY') {
			const { elapsed, networkStable, contentStable, url } = message.data;
			this.log(`[Tab] ${url}: ${elapsed}ms | Network: ${networkStable} | Content: ${contentStable}`);
			return true;
		}
	}
	handleModuleStateMessage = (message) => (this.handleModuleFailedMessage(message) || this.handleModuleReadyMessage(message));
	handleModuleFailedMessage = (message) => {
		if (message.type === 'MODULE_FAILED') {
			if (!this.moduleInContext(message.moduleName)) this.moduleState.set(message.moduleName, 'failed');
			// this.logError(` Module ${message.moduleName} failed in ${message.fromContext}: ${message.error}`);
			return true;
		}
	}
	handleModuleReadyMessage = (message) => {
		if (message.type === 'MODULE_READY') {
			if (!this.moduleInContext(message.moduleName)) this.moduleState.set(message.moduleName, 'ready');
			// this.log(`Module ${message.moduleName} ready in ${message.fromContext}`);
			return true;
		}
	}
	handleTestResultsMessage = (message) => {
		if (message.type === 'TEST_RESULTS') {
			// this.log(`Received test results for context ${message.context}`, message.results);
			this.allContextTestResults.set(message.context, message.results);
			if (this.areAllTestsComplete()) this.showTests();
			return true;
		}
	};
	areAllTestsComplete = () => {
		const modulesWithTests = this.getModulesWithProperty("test").map(m => m.manifest.name);
		const modulesWithResults = new Set(Array.from(this.allContextTestResults.values()).flat().map(result => result.module));
		const ret = [...modulesWithTests].every(moduleName => modulesWithResults.has(moduleName));
		this.log(`expected ${modulesWithTests} to be complete, got ${[...modulesWithResults]}`);
		return ret;
	};

	initializeModules = async () => {
		await Promise.all(this.contextModules.map(async (module) => {
			try {
				await module.initialize?.(this);
				this.broadcastModuleReady(module.manifest.name);
				this.log(`[${this.runtimeName}] Module ${module.manifest.name} initialized`);
			} catch (error) {
				this.logError(`[${this.runtimeName}] Module ${module.manifest.name} failed to initialize`, error);
				this.broadcastModuleFailed(module.manifest.name);
			}
		}));
	}
	broadcastModuleStatus = async (moduleName, state) => {
		const type = `MODULE_${state.toUpperCase()}`;
		this.moduleState.set(moduleName, state);
		await retryAsync(async () => chrome.runtime.sendMessage({ type, moduleName, fromContext: this.runtimeName }), {
			maxAttempts: this.MODULE_INIT_TIMEOUT / this.RETRY_INTERVAL, delay: this.RETRY_INTERVAL,
			// onRetry: (error, attempt, max) => { this.log(`[Runtime] Retry ${attempt}/${max} for ${type} message for ${moduleName}`) 
		}).catch(() => this.logError(`[Runtime] Failed to send ${type} message for ${moduleName} in ${this.runtimeName}`));
	};
	broadcastModuleReady = (moduleName) => {
		console.log(`[STATE] Setting ${moduleName} to ready in ${this.runtimeName}`);
		this.broadcastModuleStatus(moduleName, 'ready');
		console.log(`[STATE] ${moduleName} state is now: ${this.getState(moduleName)}`);
		this.checkAllModulesInitialized();
	}
	broadcastModuleFailed = (moduleName) => { this.broadcastModuleStatus(moduleName, 'failed'); this.checkAllModulesInitialized(); }
	checkAllModulesInitialized = () => this.allModulesInitialized() && this.log(this.allModulesReady() ? '🎉 Extension ready!' : '⚠️ Extension Failed to Load Some Modules!');
	allModulesInitialized = () => modules.map(m => m.manifest.name).every(moduleName => this.moduleState.has(moduleName));
	allModulesReady = () => modules.map(m => m.manifest.name).every(moduleName => this.moduleState.get(moduleName) === 'ready');
	broadcastTestResults = async () => {
		await retryAsync(async () => chrome.runtime.sendMessage({ type: 'TEST_RESULTS', context: this.runtimeName, results: this.testResults }))
			.then(() => this.log(`[Runtime] Sent TEST_RESULTS message in ${this.runtimeName}`))
			.catch(() => this.logError(`[Runtime] Failed to send TEST_RESULTS message in ${this.runtimeName}`));
	};

	MODULE_INIT_TIMEOUT = 15000; // 15 seconds
	RETRY_INTERVAL = 100; // 100ms between checks
	CROSS_CONTEXT_TIMEOUT = 9000; // 9 seconds for messaging


	call = async (actionName, ...args) => {
		const [moduleName] = actionName.split('.');
		if (this.moduleInContext(moduleName)) {
			const callId = Math.random().toString(36).substr(2, 5);
			console.log(`[CALL ${callId}] Calling ${actionName}, module state: ${this.getState(moduleName)}`);
			await this.waitForModule(moduleName);
			console.log(`[CALL ${callId}] Module ${moduleName} ready, executing action`);
			const result = await this.executeAction(actionName, ...args);
			console.log(`[CALL ${callId}] Action ${actionName} completed`);
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
			// onRetry: (error, attempt) => this.log(`[Runtime] Retry ${attempt} for ${actionName}: ${error.message}`),
			shouldRetry: (error) => error.message.includes('port closed') || error.message.includes('Receiving end does not exist')
		});
	}

	// In runtime.js, enhance waitForModule with more detailed logging:
	waitForModule = async (moduleName, timeout = this.MODULE_INIT_TIMEOUT) => {
		if (this.isReady(moduleName)) return;

		const callId = Math.random().toString(36).substr(2, 5);
		console.log(`[WAIT ${callId}] Event-waiting for ${moduleName}`);

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				unsubscribe();
				reject(new Error(`Module ${moduleName} not ready after ${timeout}ms`));
			}, timeout);

			const listener = (name, state) => {
				if (name === moduleName && state === 'ready') {
					clearTimeout(timeoutId);
					unsubscribe();
					console.log(`[WAIT ${callId}] Event-completed for ${moduleName}`);
					resolve();
				}
			};

			const unsubscribe = this.moduleState.addListener(listener);

			// Double-check in case we missed the event
			if (this.isReady(moduleName)) {
				clearTimeout(timeoutId);
				unsubscribe();
				resolve();
			}
		});
	}

	getState = (moduleName) => this.moduleState.get(moduleName);
	isReady = (moduleName) => this.getState(moduleName) === 'ready';
	throwIfFailed = (moduleName) => this.getState(moduleName) === 'failed' && (() => { throw new Error(`Module ${moduleName} failed to initialize`); })();
	throwIfTimeout = (moduleName, start, timeout) => {
		if (Date.now() - start > timeout) {
			const error = new Error(`Module ${moduleName} not ready after ${timeout}ms`);
			console.error(`[TIMEOUT ERROR] ${error.message}`);
			throw error;
		}
	};
	createFunctionParamsDebugObject = (func, args) => {
		const match = func.toString().match(/\(([^)]*)\)/);
		const paramNames = match ? match[1].split(',').map(p => p.trim().split('=')[0].trim()).filter(Boolean) : [];
		return paramNames.reduce((debugObj, paramName, index) => { if (index < args.length) debugObj[paramName] = args[index]; return debugObj; }, {});
	};

	unloggedCommands = ["command.handleCommandInput"];
	async executeAction(actionName, ...args) {
		const callId = Math.random().toString(36).substr(2, 5);
		console.log(`[EXEC ${callId}] Starting ${actionName}`);

		const action = this.getAction(actionName);
		if (!action) {
			console.log(`[EXEC ${callId}] Action not found: ${actionName}`);
			throw new Error(`Action not found: ${actionName}`);
		}

		console.log(`[EXEC ${callId}] Action found, executing...`);
		const params = this.createFunctionParamsDebugObject(action, args);

		try {
			console.log(`[EXEC ${callId}] Calling action.func for ${actionName}`);
			const result = await action.func(...args);
			console.log(`[EXEC ${callId}] Action ${actionName} returned:`, result);

			if (!this.unloggedCommands.includes(actionName)) {
				this.log(`[Runtime] Action executed: ${actionName}`, { ...params, result });
			}
			return result;
		} catch (error) {
			console.log(`[EXEC ${callId}] Action ${actionName} threw error:`, error);
			this.logError(`[Runtime] Action failed: ${actionName}`, { ...params, error });
			throw error;
		}
	}
	getAction = (actionName) => {
		const action = this.actions.get(actionName);
		if (!action) this.logError(`[Runtime] Action not found: ${actionName}`, { context: this.runtimeName });
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
	// todo: better handle cross context 
	logError = (message, data) => this.log(message, data, 'error');
	log = (message, data, severity = 'log') => {
		console.log(`[DEBUG LOG] Context: ${this.runtimeName}, Message: "${message}"`);

		// Always show in console
		this.printLog(console[severity], message, data);

		// Only prevent persistence of storage calls to avoid infinite loops
		const isStorageCall = message.includes('chrome-local.') || message.includes('chrome-sync.');
		if (isStorageCall) {
			console.log(`[DEBUG LOG] Skipping persist - storage call detected`);
			return;
		}

		if (message.includes("service-worker") && this.runtimeName !== "service-worker") {
			console.log(`[DEBUG LOG] Skipping persist - cross-context service-worker log`);
			return;
		}

		console.log(`[DEBUG LOG] Attempting to persist log...`);
		this.persistLog(message, data).catch(err => console.warn('Log persist failed:', err));
	}
	printLog = async (func, message, data) => {
		func(`[${this.runtimeName}] ${message}`, data || '');
	}
	persistLog = async (message, data) => {
		// Only prevent persistence of direct storage action logs to avoid infinite loops
		const isStorageActionLog = message.includes('[Runtime] Action executed: chrome-local.') ||
			message.includes('[Runtime] Action executed: chrome-sync.');
		if (isStorageActionLog) return;

		if (message.includes("service-worker") && this.runtimeName !== "service-worker") return;

		try {
			await this.call('chrome-local.append', 'runtime.logs', this.createLog(message, data));
		} catch (error) {
			// Only log timeout errors for debugging, not all persist failures
			if (error.message.includes('not ready after') || error.message.includes('timeout')) {
				console.warn(`[PERSIST TIMEOUT] "${message}" - ${error.message}`);
			}
		}
	}
	createLog = (message, data) => ({ time: Date.now(), context: this.runtimeName, message, data: data ? JSON.stringify(data) : null });
	// testing
	runTests = async () => {
		if (!this.testResults) return;
		const mods = this.contextModules.filter(module => this.moduleHasProperty(module, "test"));
		const t = await Promise.all(mods.map(async mod => {
			const newTests = await this.runModuleTests(mod);
			this.testResults = this.testResults.concat(newTests);
		}));
		this.log(`[${this.runtimeName}] All tests complete. Total: ${this.testResults.length}`);
		this.allContextTestResults = this.allContextTestResults.set(this.runtimeName, this.testResults);
		this.broadcastTestResults();
		if (this.areAllTestsComplete()) this.showTests();
	};
	runModuleTests = async (module) => (await module['test']()).map(test => ({ ...test, module: module.manifest.name }));
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

		this.log(`\nOverall: ${totalPassed}/${totalTests} tests passed (${Math.round(totalPassed / totalTests * 100)}%)`);
		this.log('\n=== MODULE TEST RESULTS ===');
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
			this.log('\n=== FAILED TEST DETAILS ===');
			console.table(failedTests.map((test, i) => ({
				'Module': test.module,
				'Test #': i + 1,
				'Test Name': test.name,
				'Expected': truncateOrNA(test.expected),
				'Assert': test?.assert?.name ?? 'N/A',
				'Actual': truncateOrNA(test.actual)
			})));
			this.log(failedTests);
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