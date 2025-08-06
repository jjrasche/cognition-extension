import { modules } from './module-registry.js';
import { logError, logInfo } from './logging.module.js';

class ContextInitializer {
    constructor(contextName) {
        this.contextName = contextName;
        this.actions = new Map();
        this.modules = [];
        this.errors = [];
    }

    initialize = async () => {
        try {
            logInfo({ module: 'ContextInitializer', message: `Starting module initialization...` });
            await this.loadModulesForContext();
            this.registerActions();
            this.setupMessageListener();
            await this.initializeModules();
            logInfo({ module: 'ContextInitializer', message: `Module initialization complete.`, data: { ...this } });
        } catch (error) {
            logError({ module: 'ContextInitializer', message: `Initialization failed in ${this.contextName}`, data: { error: error.message } });
        }
    }

    loadModulesForContext = async () => this.modules = modules.filter(module => module.manifest.context === this.contextName);

    getModuleActions = (module) => module.manifest.actions.filter(action => this.exportedActions(module).includes(action));
    exportedActions = (module) => Object.getOwnPropertyNames(module)
        .filter(prop => typeof module[prop] === 'function')
        .filter(name => !['initialize', 'cleanup', 'manifest', 'default'].includes(name));
    registerActions = async () => this.modules.forEach(module => {
        this.getModuleActions(module)
            .filter(action => typeof module[action] === 'function')
            .forEach(action => this.actions.set(`${module.manifest.name}.${action}`, module[action]));
    });

    getAction = (actionName) => {
        const action = this.actions.get(actionName);
        if (!action) {
            const message = `Action not found: ${actionName}`;
            logError({ module: 'ContextInitializer', message, data: { context: this.contextName } });
            throw new Error(message);
        }
        return action;
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((params) => {
            const { action, callback } = params;
            this.executeAction(action, params || {})
                .then(result => callback(result))
                .catch(error => {
                    logError({ module: 'ContextInitializer', message: `Action ${action} failed`, data: { error: error.message, context: this.contextName } });
                    callback({ error: error.message });
                });
        });
    }

    initializeModules = async () => await Promise.all(this.modules.map(async module => {
        try {
            await module.initialize();
            logInfo({ module: 'ContextInitializer', message: `Module ${module.manifest.name} initialized successfully`, data: { context: this.contextName } });
        } catch (error) {
            this.errors.push({ module: module.manifest.name, error: `Failed to initialize ${module.manifest.name}: ${error.message}` });
        }
    }));

    async executeAction(actionName, params) {
        const action = this.getAction(actionName);
        try {
            const result = await action.handler(params);
            logInfo({ module: 'ContextInitializer', message: `Action executed: ${actionName}`, data: { module: action.module, params: Object.keys(params || {}), success: true } });
            return result;

        } catch (error) {
            // Log failed action execution
            logError({ module: 'ContextInitializer', message: `Action failed: ${actionName}`, data: { module: action.module, error: error.message, params: Object.keys(params || {}) } });
            throw error;
        }
    }
}

export async function initializeContext(contextName) {
    const initializer = new ContextInitializer(contextName);
    await initializer.initialize();
    return initializer;
}