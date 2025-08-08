import { modules } from './module-registry.js';
import { retryAsync } from './helpers.js';
class Runtime {
    constructor(runtimeName) {
        this.runtimeName = runtimeName;
        this.actions = new Map();
        this.modules = [];
        this.errors = [];
        this.moduleState = new Map();
    }

    initialize = async () => {
        try {
            this.log('[Runtime] Starting module initialization...');
            await this.loadModulesForContext();
            this.registerActions();
            this.setupMessageListener();
            await this.initializeModules();
            this.log('[Runtime] Module initialization complete', { context: this.runtimeName, loadedModules: this.modules.map(m => m.manifest.name), moduleStates: Object.fromEntries(this.moduleState)});
        } catch (error) {
            this.logError(`[Runtime] Initialization failed in ${this.runtimeName}`, { error: error.message });
        }
    }

    loadModulesForContext = async () => {
        this.modules = modules.filter(module => !module.manifest.context || module.manifest.context === this.runtimeName);
        this.log(`Loading modules:`, this.modules.map(m => JSON.stringify(m.manifest)));
    }

    getModuleActions = (module) => module.manifest.actions?.filter(action => this.exportedActions(module).includes(action)) || [];
    
    exportedActions = (module) => Object.getOwnPropertyNames(module)
        .filter(prop => typeof module[prop] === 'function')
        .filter(name => !['initialize', 'cleanup', 'manifest', 'default'].includes(name));

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
        this.log(`[Runtime] Registered actions in ${this.runtimeName}:`, Array.from(this.actions.keys()));
    }

    setupMessageListener = () => {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (this.handleModuleStateMessage(message)) return;
            if (!message.action) return;

            // Check if this context can handle the action
            const [moduleName] = message.action.split('.');
            const moduleInContext = this.modules.find(m => m.manifest.name === moduleName);
            if (!moduleInContext) return false;
            this.executeAction(message.action, message.params || {})
                .then(result => sendResponse(result))
                .catch(error => {
                    this.logError(`Action ${message.action} failed`, { error: error.message, context: this.runtimeName });
                    sendResponse({ error: error.message });
                });
            return true; // Keep message channel open for async response
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
            if (attempt > 0) {
                this.log(`Retry attempt ${attempt}, pending modules:`, pending.map(m => m.manifest.name));
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
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
                        pending.splice(i, 1);
                    } catch (error) {
                        console.error(`[${this.runtimeName}] ❌ ${module.manifest.name} failed:`, error);
                        this.broadcastModuleFailed(module.manifest.name, error);
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
            this.broadcastModuleFailed(module.manifest.name, error);
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

    // New simplified method for module-to-module calls
    call = async (actionName, params = {}) => {
        const [moduleName] = actionName.split('.');
        
        // Check module state
        const state = this.moduleState.get(moduleName);
        if (state === 'failed') {
            throw new Error(`Module ${moduleName} failed to initialize`);
        }
        
        // Wait for module if not ready yet
        if (state !== 'ready') {
            await this.waitForModule(moduleName, 10000);
        }

        // Check if this action is in the same context
        if (this.modules.find(m => m.manifest.name === moduleName)) {
            // Direct call for same context
            return this.executeAction(actionName, params);
        }
        
        // Send the message
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: actionName, params },
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

    waitForModule = async (moduleName, timeout = 10000) => {
        const start = Date.now();
        while (this.moduleState.get(moduleName) !== 'ready') {
            if (this.moduleState.get(moduleName) === 'failed') {
                throw new Error(`Module ${moduleName} failed to initialize`);
            }
            if (Date.now() - start > timeout) {
                throw new Error(`Module ${moduleName} not ready after ${timeout}ms`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    async executeAction(actionName, params) {
        const action = this.getAction(actionName);
        try {
            const result = await action(params);
            this.log(`[Runtime] Action executed: ${actionName}`, { params: Object.keys(params || {}), result });
            return result;
        } catch (error) {
            this.logError(`[Runtime] Action failed: ${actionName}`, { error: error.message, params: Object.keys(params || {}) });
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
}

export function initializeRuntime(runtimeName) {
    const initializer = new Runtime(runtimeName);
    initializer.initialize();
    return initializer;
}