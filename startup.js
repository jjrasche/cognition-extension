/**
 * Startup Module - The only module that's always loaded
 * Responsible for initializing the system and loading other modules
 */

export const moduleDefinition = {
  manifest: {
    name: "System Startup",
    version: "1.0.0",
    permissions: ["storage"],
    dependencies: [],
    actions: ["reloadModule", "enableModule", "disableModule", "getSystemStatus"],
    state: {
      reads: ["system.modules"],
      writes: ["system.status", "system.modules", "system.errors"]
    }
  },
  
  settings: {
    schema: {
      debugMode: { type: "boolean", default: false },
      errorNotifications: { type: "boolean", default: true }
    }
  },

  implementation: class StartupModule {
    constructor() {
      this.loadedModules = new Map();
      this.moduleErrors = new Map();
    }

    async initialize(state, config) {
      this.state = state;
      this.config = config;
      
      // Initialize core state structure
      await this.initializeStateStructure();
      
      // Load module configuration
      const moduleConfig = await chrome.storage.sync.get('enabledModules');
      const enabledModules = moduleConfig.enabledModules || DEFAULT_MODULES;
      
      // Load all enabled modules
      await this.loadModules(enabledModules);
      
      // Set system ready
      await this.state.write('system.status', 'ready');
    }

    async initializeStateStructure() {
      // Set up the action registry
      if (!this.state.actions) {
        this.state.actions = {
          registry: new Map(),
          
          register(name, fn, metadata = {}) {
            this.registry.set(name, { 
              fn, 
              module: metadata.module || 'unknown',
              description: metadata.description || '',
              parameters: metadata.parameters || []
            });
            
            // Notify listeners that new action is available
            if (this.state.notify) {
              this.state.notify('action.registered', { name, metadata });
            }
          },
          
          get(name) {
            return this.registry.get(name);
          },
          
          list() {
            return Array.from(this.registry.entries()).map(([name, info]) => ({
              name,
              module: info.module,
              description: info.description,
              parameters: info.parameters
            }));
          }
        };
      }
      
      // Set up system namespace
      await this.state.write('system.status', 'initializing');
      await this.state.write('system.modules', []);
      await this.state.write('system.errors', []);
    }

    async loadModules(moduleList) {
      const loaded = [];
      const errors = [];
      
      for (const ModuleClass of moduleList) {
        try {
          const instance = new ModuleClass();
          
          // Get module config from storage
          const moduleConfig = await chrome.storage.sync.get(`modules.${ModuleClass.name}`);
          
          // Initialize the module
          await instance.initialize(this.state, moduleConfig[`modules.${ModuleClass.name}`] || {});
          
          // Store reference
          this.loadedModules.set(ModuleClass.name, instance);
          
          loaded.push({
            name: ModuleClass.name,
            version: instance.constructor.manifest?.version || '1.0.0',
            status: 'active'
          });
          
          if (this.config.debugMode) {
            console.log(`[Startup] Loaded module: ${ModuleClass.name}`);
          }
        } catch (error) {
          errors.push({
            module: ModuleClass.name,
            error: error.message,
            stack: error.stack
          });
          
          this.moduleErrors.set(ModuleClass.name, error);
          
          if (this.config.errorNotifications) {
            console.error(`[Startup] Failed to load module ${ModuleClass.name}:`, error);
          }
        }
      }
      
      // Update state with results
      await this.state.write('system.modules', loaded);
      if (errors.length > 0) {
        await this.state.write('system.errors', errors);
      }
      
      return { loaded, errors };
    }

    async reloadModule(moduleName) {
      // Find the module class
      const ModuleClass = MODULE_LIST.find(M => M.name === moduleName);
      if (!ModuleClass) {
        return { success: false, error: 'Module not found' };
      }
      
      // Clean up old instance
      const oldInstance = this.loadedModules.get(moduleName);
      if (oldInstance && oldInstance.cleanup) {
        await oldInstance.cleanup();
      }
      
      // Load fresh instance
      try {
        const instance = new ModuleClass();
        const moduleConfig = await chrome.storage.sync.get(`modules.${moduleName}`);
        await instance.initialize(this.state, moduleConfig[`modules.${moduleName}`] || {});
        
        this.loadedModules.set(moduleName, instance);
        
        return { success: true, message: `Reloaded ${moduleName}` };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    async enableModule(moduleName) {
      const enabled = await chrome.storage.sync.get('enabledModules');
      const list = enabled.enabledModules || [];
      
      if (!list.includes(moduleName)) {
        list.push(moduleName);
        await chrome.storage.sync.set({ enabledModules: list });
        
        // Load the module immediately
        const ModuleClass = MODULE_LIST.find(M => M.name === moduleName);
        if (ModuleClass) {
          await this.loadModules([ModuleClass]);
        }
      }
      
      return { success: true, message: `Enabled ${moduleName}` };
    }

    async disableModule(moduleName) {
      // Don't allow disabling startup module
      if (moduleName === 'StartupModule') {
        return { success: false, error: 'Cannot disable startup module' };
      }
      
      const enabled = await chrome.storage.sync.get('enabledModules');
      const list = enabled.enabledModules || [];
      
      const index = list.indexOf(moduleName);
      if (index > -1) {
        list.splice(index, 1);
        await chrome.storage.sync.set({ enabledModules: list });
        
        // Clean up the module
        const instance = this.loadedModules.get(moduleName);
        if (instance && instance.cleanup) {
          await instance.cleanup();
        }
        this.loadedModules.delete(moduleName);
      }
      
      return { success: true, message: `Disabled ${moduleName}` };
    }

    async getSystemStatus() {
      const modules = await this.state.read('system.modules');
      const errors = await this.state.read('system.errors');
      const actions = this.state.actions.list();
      
      return {
        status: await this.state.read('system.status'),
        modules: modules,
        errors: errors,
        totalActions: actions.length,
        actionsByModule: actions.reduce((acc, action) => {
          acc[action.module] = (acc[action.module] || 0) + 1;
          return acc;
        }, {})
      };
    }

    getActions() {
      return {
        reloadModule: {
          fn: this.reloadModule.bind(this),
          description: 'Reload a specific module',
          parameters: ['moduleName']
        },
        enableModule: {
          fn: this.enableModule.bind(this),
          description: 'Enable and load a module',
          parameters: ['moduleName']
        },
        disableModule: {
          fn: this.disableModule.bind(this),
          description: 'Disable and unload a module',
          parameters: ['moduleName']
        },
        getSystemStatus: {
          fn: this.getSystemStatus.bind(this),
          description: 'Get current system status and loaded modules',
          parameters: []
        }
      };
    }
  },

  tests: {
    unit: [
      {
        name: "initializes state structure",
        fn: async () => {
          const module = new StartupModule();
          const mockState = createMockState();
          await module.initialize(mockState, {});
          
          assert(mockState.actions !== undefined);
          assert(mockState.actions.registry instanceof Map);
          assert(typeof mockState.actions.register === 'function');
        }
      },
      {
        name: "loads modules successfully",
        fn: async () => {
          const module = new StartupModule();
          const mockState = createMockState();
          
          class TestModule {
            async initialize() { this.initialized = true; }
          }
          
          await module.initialize(mockState, {});
          const result = await module.loadModules([TestModule]);
          
          assert(result.loaded.length === 1);
          assert(result.errors.length === 0);
        }
      },
      {
        name: "handles module loading errors",
        fn: async () => {
          const module = new StartupModule();
          const mockState = createMockState();
          
          class FailingModule {
            async initialize() { throw new Error('Test error'); }
          }
          
          await module.initialize(mockState, {});
          const result = await module.loadModules([FailingModule]);
          
          assert(result.loaded.length === 0);
          assert(result.errors.length === 1);
          assert(result.errors[0].error === 'Test error');
        }
      }
    ],
    coverage: 85
  }
};

// Bootstrap code - absolute minimum
export async function bootstrap() {
  const state = new StateStore();
  const startup = new moduleDefinition.implementation();
  await startup.initialize(state, {});
  // That's it - startup module handles everything else
}

// Helper to create mock state for testing
function createMockState() {
  const data = {};
  return {
    async read(key) { return data[key]; },
    async write(key, value) { data[key] = value; },
    notify(event, data) { /* mock */ }
  };
}

// Module exports
export default moduleDefinition.implementation;
export const manifest = moduleDefinition.manifest;
export const tests = moduleDefinition.tests;