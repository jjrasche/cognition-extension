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

    // loadModulesForContext = async () => this.modules = modules.filter(module => module.manifest.context === this.contextName);
    loadModulesForContext = async () => {
        console.log('[DEBUG] All available modules:', modules.map(m => ({ 
            name: m.manifest?.name, 
            context: m.manifest?.context 
        })));
        
        this.modules = modules.filter(module => {
            const hasManifest = !!module.manifest;
            const matchesContext = module.manifest?.context === this.contextName;
            
            console.log(`[DEBUG] Module ${module.manifest?.name}: hasManifest=${hasManifest}, context=${module.manifest?.context}, matches=${matchesContext}`);
            
            return hasManifest && matchesContext;
        });
        
        console.log(`[DEBUG] Filtered modules for ${this.contextName}:`, this.modules.map(m => m.manifest?.name));
    };
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
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!message.action) return;
            
            this.executeAction(message.action, message.params || {})
                .then(result => sendResponse(result))
                .catch(error => {
                    logError({ 
                        module: 'ContextInitializer', 
                        message: `Action ${message.action} failed`, 
                        data: { error: error.message, context: this.contextName } 
                    });
                    sendResponse({ error: error.message });
                });
            
            return true; // Keep message channel open for async response
        });
    }

    // initializeModules = async () => await Promise.all(this.modules.map(async module => {
    //     try {
    //         await module.initialize();
    //         logInfo({ module: 'ContextInitializer', message: `Module ${module.manifest.name} initialized successfully`, data: { context: this.contextName } });
    //     } catch (error) {
    //         this.errors.push({ module: module.manifest.name, error: `Failed to initialize ${module.manifest.name}: ${error.message}` });
    //     }
    // }));
    initializeModules = async () => {
        console.log('[DEBUG] Starting module initialization...');
        console.log('[DEBUG] Modules to initialize:', this.modules.map(m => m.manifest?.name));
        
        for (const module of this.modules) {
            try {
                console.log(`[DEBUG] Initializing ${module.manifest?.name}...`);
                
                // Check if initialize function exists
                if (typeof module.initialize !== 'function') {
                    console.error(`[DEBUG] Module ${module.manifest?.name} has no initialize function!`);
                    continue;
                }
                
                await module.initialize();
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