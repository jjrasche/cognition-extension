import { modules } from './module-registry.js';
import { logError, logInfo } from './logging.module.js';

class Runtime {
    constructor(runtimeName) {
        this.runtimeName = runtimeName;
        this.actions = new Map();
        this.modules = [];
        this.errors = [];
    }

    initialize = async () => {
        try {
            logInfo({ module: 'Runtime', message: `Starting module initialization...` });
            await this.loadModulesForContext();
            this.registerActions();
            this.setupMessageListener();
            await this.initializeModules();
            logInfo({ module: 'Runtime', message: `Module initialization complete.`, data: { ...this } });
        } catch (error) {
            logError({ module: 'Runtime', message: `Initialization failed in ${this.runtimeName}`, data: { error: error.message } });
        }
    }

    loadModulesForContext = async () => this.modules = modules.filter(module => module.manifest.context === this.runtimeName);
    getModuleActions = (module) => module.manifest.actions.filter(action => this.exportedActions(module).includes(action));
    exportedActions = (module) => Object.getOwnPropertyNames(module)
        .filter(prop => typeof module[prop] === 'function')
        .filter(name => !['initialize', 'cleanup', 'manifest', 'default'].includes(name));
    registerActions = async () => this.modules.forEach(module => this.getModuleActions(module)
        .filter(action => typeof module[action] === 'function')
        .forEach(action => this.actions.set(`${module.manifest.name}.${action}`, module[action])));
    getAction = (actionName) => {
        const action = this.actions.get(actionName);
        if (!action) {
            const message = `Action not found: ${actionName}`;
            logError({ module: 'Runtime', message, data: { context: this.runtimeName } });
            throw new Error(message);
        }
        return action;
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!message.action) return;

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

    // initializeModules = async () => await Promise.all(this.modules.map(async module => {
    //     try {
    //         await module.initialize();
    //         logInfo({ module: 'Runtime', message: `Module ${module.manifest.name} initialized successfully`, data: { context: this.runtimeName } });
    //     } catch (error) {
    //         this.errors.push({ module: module.manifest.name, error: `Failed to initialize ${module.manifest.name}: ${error.message}` });
    //     }
    // }));
    // initializeModules = async () => {
    //     for (const module of this.modules) {
    //         try { await module.initialize() }
    //         catch (error) {
    //             this.errors.push({ module: module.manifest?.name, error: `Failed to initialize: ${error.message}`, stack: error.stack });
    //         }
    //     }
    // }
    initializeModules = async () => {
        console.log('[DEBUG] Starting module initialization...');
        console.log('[DEBUG] Modules to initialize:', this.modules.map(m => m.manifest?.name));

        for (const module of this.modules) {
            try {
                console.log(`[DEBUG] Initializing ${module.manifest?.name}...`);

                // Check if initialize function exists
                if (typeof module.initialize !== 'function') {
                    console.error(`[DEBUG] Module ${module.manifest?.name} has no initialize function!`);
                    // continue;
                }

                await module.initialize(this);
                console.log(`[DEBUG] ✅ ${module.manifest?.name} initialized successfully`);

            } catch (error) {
                console.error(`[DEBUG] ❌ ${module.manifest?.name} failed:`, error);
                console.error(`[DEBUG] Full error details:`, {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });

                // Don't let one module break the others
                this.errors.push({
                    module: module.manifest?.name,
                    error: `Failed to initialize: ${error.message}`,
                    stack: error.stack
                });
            }
        }

        console.log('[DEBUG] Module initialization complete. Errors:', this.errors);
    };

    async executeAction(actionName, params) {
        const action = this.getAction(actionName);
        try {
            const result = await action(params);
            logInfo({ module: 'Runtime', message: `Action executed: ${actionName}`, data: { module: action.module, params: Object.keys(params || {}), success: true } });
            return result;

        } catch (error) {
            // Log failed action execution
            logError({ module: 'Runtime', message: `Action failed: ${actionName}`, data: { module: action.module, error: error.message, params: Object.keys(params || {}) } });
            throw error;
        }
    }

    getModules = () => [...this.modules]; // Returns shallow copy to prevent mutation
    getActions = () => new Map(this.actions); // Returns copy of actions Map
    getModulesWithProperty = (prop) => this.modules.filter(module => prop in module);
}

export async function initializeContext(runtimeName) {
    const initializer = new Runtime(runtimeName);
    await initializer.initialize();
    return initializer;
}