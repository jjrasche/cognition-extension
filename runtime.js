import { modules } from './module-registry.js';
import { retryAsync, wait } from './helpers.js';
class Runtime {
    constructor(runtimeName) {
        this.runtimeName = runtimeName;
        this.actions = new Map();
        this.modules = [];
        this.errors = [];
        this.moduleState = new Map();
        this.testResults = [];
        // this.testResults = null;
    }

    initialize = async () => {
        try {
            this.log('[Runtime] Starting module initialization...');
            await this.loadModulesForContext();
            this.registerActions();
            this.setupMessageListener();
            await this.initializeModules();
            if (!!this.testResults) this.showTestResults();
            this.log('[Runtime] Module initialization complete', { context: this.runtimeName, loadedModules: this.modules.map(m => m.manifest.name), moduleStates: Object.fromEntries(this.moduleState)});
        } catch (error) {
            this.logError(`[Runtime] Initialization failed in ${this.runtimeName}`, error);
        }
    }

    loadModulesForContext = async () => {
        this.modules = modules.filter(module => module.manifest.context && module.manifest.context.includes(this.runtimeName));
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
                    .forEach(action => this.actions.set(`${module.manifest.name}.${action}`, module[action]));
                } 
            catch (error) {
                this.logError(` Failed to register [${module.manifest.name}] actions:`, { error: error.message });
            }
        });
    }

    setupMessageListener = () => {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (this.handleModuleStateMessage(message)) return;
            if (!message.action) return;

            const [moduleName] = message.action.split('.');
            const moduleInContext = this.modules.find(m => m.manifest.name === moduleName);
            if (!moduleInContext) return false;
            
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

    handleModuleStateMessage = (message) => (this.handleModuleFailedMessage(message) || this.handleModuleReadyMessage(message));
    handleModuleFailedMessage = (message) => {
        if (message.type === 'MODULE_FAILED') {
            this.moduleState.set(message.moduleName, 'failed');
            this.logError(` Module ${message.moduleName} failed in ${message.fromContext}: ${message.error}`);
            return true;
        }
    }
    handleModuleReadyMessage = (message) => {
        if (message.type === 'MODULE_READY') {
            this.moduleState.set(message.moduleName, 'ready');
            this.log(`Module ${message.moduleName} ready in ${message.fromContext}`);
            return true;
        }
    }

    initializeModules = async () => {
        this.log(`Starting module initialization...`);
        const pending = [...this.modules];
        const maxAttempts = 20;
        
        for (let attempt = 0; attempt < maxAttempts && pending.length > 0; attempt++) {
            if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 5000));
            for (let i = pending.length - 1; i >= 0; i--) {
                const module = pending[i];
                if (this.areDependenciesReady(module)) {
                    try {
                        this.log(`Initializing ${module.manifest.name}...`);
                        if (typeof module.initialize !== 'function') {
                            console.warn(`[${this.runtimeName}] Module ${module.manifest.name} has no initialize function`);
                            this.broadcastModuleReady(module.manifest.name);
                            pending.splice(i, 1);
                            continue;
                        }
                        await module.initialize(this);
                        this.log(`✅ ${module.manifest.name} initialized successfully`);
                        this.broadcastModuleReady(module.manifest.name);
                        this.showTestFailures(await this.testModule(module));
                        pending.splice(i, 1);
                    } catch (error) {
                        console.error(`[${this.runtimeName}] ❌ ${module.manifest.name} failed:`, error);
                        this.broadcastModuleFailed(module.manifest.name);
                        this.errors.push({
                            module: module.manifest.name,
                            error: error.message,
                            stack: error.stack
                        });
                        pending.splice(i, 1);
                    }
                } else {
                    const deps = module.manifest.dependencies || [];
                    const notReady = deps.filter(dep => this.moduleState.get(dep) !== 'ready');
                    this.log(`${module.manifest.name} waiting for dependencies:`, notReady);
                }
            }
        }
        
        // Any remaining modules have unmet dependencies
        pending.forEach(module => {
            const error = new Error(`Dependencies not met after ${maxAttempts} attempts`);
            console.error(`[${this.runtimeName}] ❌ ${module.manifest.name} failed:`, error);
            this.broadcastModuleFailed(module.manifest.name);
            this.errors.push({
                module: module.manifest.name,
                error: error.message
            });
        });
        
        this.log(`Module initialization complete. Errors:`, this.errors);
    }

    areDependenciesReady = (module) => {
        const dependencies = module.manifest.dependencies || [];
        if (dependencies.length === 0) return true;
        
        return dependencies.every(dep => {
            const state = this.moduleState.get(dep);
            return state === 'ready';
        });
    }

    broadcastModuleStatus = async (moduleName, state) => {
        const type = `MODULE_${state.toUpperCase()}`;
        this.moduleState.set(moduleName, state);
        await retryAsync(async () => chrome.runtime.sendMessage({ type, moduleName, fromContext: this.runtimeName }),
            { maxAttempts: 15, delay: 3000, onRetry: (error, attempt, max) => this.log(`[Runtime] Retry ${attempt}/${max} for ${type} message for ${moduleName}`) }
        ).catch(() => this.logError(`[Runtime] Failed to send ${type} message for ${moduleName} in ${this.runtimeName}`));
    };
    broadcastModuleReady = (moduleName) => this.broadcastModuleStatus(moduleName, 'ready');
    broadcastModuleFailed = (moduleName) => this.broadcastModuleStatus(moduleName, 'failed');

    call = async (actionName, ...args) => {
        const [moduleName] = actionName.split('.');
        await this.waitForModule(moduleName);
        
        if (this.modules.find(m => m.manifest.name === moduleName)) {
            return this.executeAction(actionName, ...args);
        }
        
        // Cross-context: serialize args as array
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: actionName, params: args },
                response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response?.error) {
                        reject(new Error(response.error));
                    } else {
                        resolve(response);
                    }
                }
            );
        });
    }

    getState = (moduleName) => this.moduleState.get(moduleName);
    isReady = (moduleName) => this.getState(moduleName) === 'ready';
    throwIfFailed = (moduleName) => this.getState(moduleName) === 'failed' && (() => { throw new Error(`Module ${moduleName} failed to initialize`); })();
    throwIfTimeout = (moduleName, start, timeout) => Date.now() - start > timeout && (() => { throw new Error(`Module ${moduleName} not ready after ${timeout}ms`); })();
    waitForModule = async (moduleName, timeout = 10000) => {
        this.throwIfFailed(moduleName);
        if (this.isReady(moduleName)) {
            const start = Date.now();
            while (this.getState(moduleName) !== 'ready') {
                this.throwIfFailed(moduleName);
                this.throwIfTimeout(moduleName, start, timeout);
                await wait(100);
            }
        }
    }

    createFunctionParamsDebugObject = (func, args) => {
        const match = func.toString().match(/\(([^)]*)\)/);
        const paramNames = match ? match[1].split(',').map(p => p.trim().split('=')[0].trim()).filter(Boolean) : [];
        return paramNames.reduce((debugObj, paramName, index) => { if (index < args.length) debugObj[paramName] = args[index]; return debugObj; }, {});
    };

    async executeAction(actionName, ...args) {
        const action = this.getAction(actionName);
        const params = this.createFunctionParamsDebugObject(action, args);
        try {
            const result = await action(...args);
            this.log(`[Runtime] Action executed: ${actionName}`, { ...params, result });
            return result;
        } catch (error) {
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
    getModules = () => [...this.modules];
    getActions = () => new Map(this.actions);
    getModulesWithProperty = (prop) => modules.filter(module => prop in module || prop in module.manifest);

    log = (message, data) => console.log(`[${this.runtimeName}] ${message}`, data || '');
    logError = (message, data) => console.error(`[${this.runtimeName}] ${message}`, data || '')
    
    // Test utilities
    testUtils = {
        strictEqual: (a, b) => a === b,
        contains: (arr, item) => arr.includes(item),
        deepEqual: (a, b) => {
            if (a === b) return true;
            if (!a || !b || typeof a !== typeof b) return false;
            if (typeof a === 'object') {
                const keysA = Object.keys(a), keysB = Object.keys(b);
                return keysA.length === keysB.length && keysA.every(key => this.testUtils.deepEqual(a[key], b[key]));
            }
            return false;
        },
        // Returns true if A contains all key-value pairs from B
        containsKeyValuePairs: (a, b) => {
            if (a === b) return true;
            if (!a || !b) return false;
            if (typeof a !== 'object' || typeof b !== 'object') return a === b;
            
            // Check if all keys in B exist in A with equal values
            return Object.keys(b).every(key => {
                if (!(key in a)) return false;
                if (typeof a[key] === 'object' && typeof b[key] === 'object') {
                    return this.testUtils.containsKeyValuePairs(a[key], b[key]);
                }
                return a[key] === b[key];
            });
        },
        // constrains single-assertion tests across all modules
        runUnitTest: async (name, testFn) => {
            try {
                const { actual, expected, assert } = await testFn();
                const passed = assert(actual, expected);
                return { name, actual, assert, expected, passed };
            } catch (error) {
                return { name, passed: false, error: error.message };
            }
        }
    };

    testModule = async (module) => {
        if (!this.testResults || !module['test']) return;
        const results = (await module['test']()).map(test => ({...test, module: module.manifest.name})).flat();
        this.testResults = this.testResults.concat(...results);
        return results;
    };
    showTestResults = () => {
        this.showSummary(this.testResults);
        this.showModuleSummary(this.testResults);
    }
    showSummary = (results) => {
        const totalTests = results.reduce((sum, r) => sum + r.totalTests, 0);
        const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
        console.log(`\nOverall: ${totalPassed}/${totalTests} tests passed (${Math.round(totalPassed/totalTests*100)}%)`);
    };
    showModuleSummary = (results) => {
        console.log('\n=== MODULES TESTED ===');
        const moduleStats = results.reduce((acc, test) => {
            if (!acc[test.module]) acc[test.module] = { total: 0, passed: 0 };
            acc[test.module].total++;
            if (test.passed) acc[test.module].passed++;
            return acc;
        }, {});  
        console.table(Object.entries(moduleStats).map(([module, stats]) => ({
            Module: module,
            'Total Tests': stats.total,
            Passed: stats.passed,
            Failed: stats.total - stats.passed,
            'Pass Rate': stats.total > 0 ? `${Math.round(stats.passed / stats.total * 100)}%` : '0%'
        })));
    };
    showTestFailures = (results) => {
        const failedTests = results.filter(test => !test.passed)
        if (failedTests.length > 0) {
            console.log('\n=== FAILED TEST DETAILS ===');
            console.table(Object.fromEntries(failedTests.map((test, i) => [`${test.module} ${i+1}`, {
                'Test Name': test.name,
                'Expected': this.truncateOrNA(test.expected),
                'Assert': test?.assert?.name ?? 'N/A',
                'Actual': this.truncateOrNA(test.actual)
            }])));
            console.log(JSON.stringify(failedTests, null, 2),failedTests);
        } else {
            console.log('\n🎉 All tests passed!');
        }
    };
    truncateOrNA = (value, maxLength = 50) => {
        if (value == null) return 'N/A';
        const str = JSON.stringify(value);
        return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    }
}

export function initializeRuntime(runtimeName) {
    const initializer = new Runtime(runtimeName);
    initializer.initialize();
    return initializer;
}