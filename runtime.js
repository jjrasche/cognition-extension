import { modules } from './module-registry.js';
import { logError, logInfo } from './logging.module.js';

class Runtime {
    constructor(runtimeName) {
        this.runtimeName = runtimeName;
        this.actions = new Map();
        this.modules = [];
        this.errors = [];
        this.moduleState = new Map(); // Tracks all modules across all contexts
    }

    initialize = async () => {
        try {
            logInfo({ module: 'Runtime', message: `Starting module initialization in ${this.runtimeName}...` });
            await this.loadModulesForContext();
            this.registerActions();
            this.setupMessageListener();
            await this.initializeModules();
            logInfo({ module: 'Runtime', message: `Module initialization complete.`, data: { 
                context: this.runtimeName,
                loadedModules: this.modules.map(m => m.manifest.name),
                moduleStates: Object.fromEntries(this.moduleState)
            }});
        } catch (error) {
            logError({ module: 'Runtime', message: `Initialization failed in ${this.runtimeName}`, data: { error: error.message } });
        }
    }

    loadModulesForContext = async () => {
        this.modules = modules.filter(module => !module.manifest.context || module.manifest.context === this.runtimeName);
        console.log(`[${this.runtimeName}] Loading modules:`, this.modules.map(m => m.manifest.name));
    }

    getModuleActions = (module) => module.manifest.actions?.filter(action => this.exportedActions(module).includes(action)) || [];
    
    exportedActions = (module) => Object.getOwnPropertyNames(module)
        .filter(prop => typeof module[prop] === 'function')
        .filter(name => !['initialize', 'cleanup', 'manifest', 'default'].includes(name));

    registerActions = () => {
        // Register actions from ALL modules (not just context modules)
        // This allows cross-context calls
        modules.forEach(module => {
            this.getModuleActions(module)
                .filter(action => typeof module[action] === 'function')
                .forEach(action => {
                    this.actions.set(`${module.manifest.name}.${action}`, module[action]);
                });
        });
        console.log(`[${this.runtimeName}] Registered actions:`, Array.from(this.actions.keys()));
    }

    setupMessageListener = () => {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            // Handle module state broadcasts
            if (message.type === 'MODULE_READY') {
                this.moduleState.set(message.moduleName, 'ready');
                console.log(`[${this.runtimeName}] Module ${message.moduleName} ready in ${message.fromContext}`);
                return;
            }
            
            if (message.type === 'MODULE_FAILED') {
                this.moduleState.set(message.moduleName, 'failed');
                console.error(`[${this.runtimeName}] Module ${message.moduleName} failed in ${message.fromContext}: ${message.error}`);
                return;
            }

            // Handle action calls
            if (!message.action) return;

            // Check if this context can handle the action
            const [moduleName] = message.action.split('.');
            const moduleForAction = this.modules.find(m => m.manifest.name === moduleName);
            
            if (!moduleForAction) {
                // This context doesn't have the module, ignore the message
                return false;
            }

            this.executeAction(message.action, message.params || {})
                .then(result => sendResponse(result))
                .catch(error => {
                    logError({
                        module: 'Runtime',
                        message: `Action ${message.action} failed`,
                        data: { error: error.message, context: this.runtimeName }
                    });
                    sendResponse({ error: error.message });
                });

            return true; // Keep message channel open for async response
        });
    }

    initializeModules = async () => {
        console.log(`[${this.runtimeName}] Starting module initialization...`);
        const pending = [...this.modules];
        const maxAttempts = 30;
        
        for (let attempt = 0; attempt < maxAttempts && pending.length > 0; attempt++) {
            if (attempt > 0) {
                console.log(`[${this.runtimeName}] Retry attempt ${attempt}, pending modules:`, pending.map(m => m.manifest.name));
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            for (let i = pending.length - 1; i >= 0; i--) {
                const module = pending[i];
                
                if (this.areDependenciesReady(module)) {
                    try {
                        console.log(`[${this.runtimeName}] Initializing ${module.manifest.name}...`);
                        
                        if (typeof module.initialize !== 'function') {
                            console.warn(`[${this.runtimeName}] Module ${module.manifest.name} has no initialize function`);
                            this.broadcastModuleReady(module.manifest.name);
                            pending.splice(i, 1);
                            continue;
                        }

                        await module.initialize(this);
                        console.log(`[${this.runtimeName}] ✅ ${module.manifest.name} initialized successfully`);
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
                    console.log(`[${this.runtimeName}] ${module.manifest.name} waiting for dependencies:`, notReady);
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
        
        console.log(`[${this.runtimeName}] Module initialization complete. Errors:`, this.errors);
    }

    areDependenciesReady = (module) => {
        const dependencies = module.manifest.dependencies || [];
        if (dependencies.length === 0) return true;
        
        return dependencies.every(dep => {
            const state = this.moduleState.get(dep);
            return state === 'ready';
        });
    }

    broadcastModuleReady = (moduleName) => {
        this.moduleState.set(moduleName, 'ready');
        chrome.runtime.sendMessage({
            type: 'MODULE_READY',
            moduleName,
            fromContext: this.runtimeName
        }).catch(() => {
            // Ignore errors when no other contexts are listening
        });
    }

    broadcastModuleFailed = (moduleName, error) => {
        this.moduleState.set(moduleName, 'failed');
        chrome.runtime.sendMessage({
            type: 'MODULE_FAILED',
            moduleName,
            error: error.message,
            fromContext: this.runtimeName
        }).catch(() => {
            // Ignore errors when no other contexts are listening
        });
    }

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
            logInfo({ 
                module: 'Runtime', 
                message: `Action executed: ${actionName}`, 
                data: { params: Object.keys(params || {}), success: true } 
            });
            return result;
        } catch (error) {
            logError({ 
                module: 'Runtime', 
                message: `Action failed: ${actionName}`, 
                data: { error: error.message, params: Object.keys(params || {}) } 
            });
            throw error;
        }
    }

    getAction = (actionName) => {
        const action = this.actions.get(actionName);
        if (!action) {
            const message = `Action not found: ${actionName}`;
            logError({ module: 'Runtime', message, data: { context: this.runtimeName } });
            throw new Error(message);
        }
        return action;
    }

    // Utility methods for modules
    getModules = () => [...this.modules];
    getActions = () => new Map(this.actions);
    getModulesWithProperty = (prop) => modules.filter(module => prop in module || prop in module.manifest);
}

export async function initializeRuntime(runtimeName) {
    const initializer = new Runtime(runtimeName);
    await initializer.initialize();
    return initializer;
}