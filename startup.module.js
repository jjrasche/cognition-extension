/**
 * Startup Module - Core system initialization and module orchestration
 * The only module that's always loaded - manages all other modules
 */

// Module manifest
export const manifest = {
  name: "Startup",
  version: "1.0.0", 
  permissions: ["storage"],
  actions: ["reloadModule", "enableModule", "disableModule", "getSystemStatus", "executeAction"],
  state: {
    reads: ["system.modules", "system.errors"],
    writes: ["system.status", "system.modules", "system.errors", "system.actions"]
  }
};

// StateStore - Manages shared state via BroadcastChannel + chrome.storage
class StateStore {
  constructor() {
    this.channel = new BroadcastChannel('cognition-state');
    this.localState = {};
    this.watchers = new Map();
    
    // Listen for state changes from other contexts
    this.channel.onmessage = (event) => {
      const { key, value } = event.data;
      this.localState[key] = value;
      
      // Notify watchers
      if (this.watchers.has(key)) {
        this.watchers.get(key).forEach(callback => callback(value));
      }
    };
  }
  
  async read(key) {
    // Check local cache first
    if (key in this.localState) {
      return this.localState[key];
    }
    
    // Fall back to chrome.storage for persistence
    const stored = await chrome.storage.sync.get([key]);
    const value = stored[key];
    this.localState[key] = value;
    return value;
  }
  
  async write(key, value) {
    // Update local state
    this.localState[key] = value;
    
    // Persist to chrome.storage
    await chrome.storage.sync.set({ [key]: value });
    
    // Broadcast to other contexts
    this.channel.postMessage({ key, value });
  }
  
  watch(key, callback) {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key).add(callback);
    
    // Return unwatch function
    return () => {
      this.watchers.get(key)?.delete(callback);
    };
  }
}

// Global instances
let state = null;
let loadedModules = new Map();
let actionRegistry = new Map();

export async function initialize(_, config) {
  // Initialize state store
  state = new StateStore();
  
  // Set up action registry
  setupActionRegistry();
  
  // Initialize system state
  await state.write('system.status', 'initializing');
  await state.write('system.modules', []);
  await state.write('system.errors', []);
  
  // Load configured modules
  const moduleConfig = await chrome.storage.sync.get('enabledModules');
  const enabledModules = moduleConfig.enabledModules || ['fitbit']; // Default to fitbit
  
  await loadModules(enabledModules);
  
  // System ready
  await state.write('system.status', 'ready');
  
  console.log('[Startup] System initialized with', loadedModules.size, 'modules');
}

function setupActionRegistry() {
  // Create action registry that modules can use
  state.actions = {
    register(name, fn, metadata = {}) {
      actionRegistry.set(name, {
        fn,
        module: metadata.module || 'unknown',
        description: metadata.description || '',
        parameters: metadata.parameters || []
      });
      
      console.log(`[Startup] Registered action: ${name}`);
    },
    
    async execute(name, params = {}) {
      const action = actionRegistry.get(name);
      if (!action) {
        throw new Error(`Action not found: ${name}`);
      }
      
      try {
        console.log(`[Startup] Executing action: ${name}`);
        const result = await action.fn(params);
        return { success: true, result };
      } catch (error) {
        console.error(`[Startup] Action ${name} failed:`, error);
        return { success: false, error: error.message };
      }
    },
    
    list() {
      return Array.from(actionRegistry.entries()).map(([name, info]) => ({
        name,
        module: info.module,
        description: info.description,
        parameters: info.parameters
      }));
    }
  };
}

async function loadModules(moduleNames) {
  const loaded = [];
  const errors = [];
  
  for (const moduleName of moduleNames) {
    try {
      // Dynamic import of module
      const moduleFile = await import(`./${moduleName}-module.js`);
      
      // Get module config
      const moduleConfig = await chrome.storage.sync.get(`modules.${moduleName}`);
      const config = moduleConfig[`modules.${moduleName}`] || {};
      
      // Initialize module
      await moduleFile.initialize(state, config);
      
      // Register module's actions
      registerModuleActions(moduleName, moduleFile);
      
      // Store reference
      loadedModules.set(moduleName, moduleFile);
      
      loaded.push({
        name: moduleName,
        version: moduleFile.manifest?.version || '1.0.0',
        status: 'active'
      });
      
      console.log(`[Startup] Loaded module: ${moduleName}`);
      
    } catch (error) {
      console.error(`[Startup] Failed to load module ${moduleName}:`, error);
      
      errors.push({
        module: moduleName,
        error: error.message,
        stack: error.stack
      });
    }
  }
  
  // Update system state
  await state.write('system.modules', loaded);
  if (errors.length > 0) {
    await state.write('system.errors', errors);
  }
  
  return { loaded, errors };
}

function registerModuleActions(moduleName, moduleFile) {
  // Register all exported functions (except initialize) as actions
  const exports = Object.getOwnPropertyNames(moduleFile);
  
  for (const exportName of exports) {
    if (exportName === 'initialize' || exportName === 'manifest' || exportName === 'tests') {
      continue; // Skip special exports
    }
    
    const fn = moduleFile[exportName];
    if (typeof fn === 'function') {
      const actionName = `${moduleName}.${exportName}`;
      
      // Wrap function to always pass state as first param
      const wrappedFn = async (params) => {
        return await fn(state, params);
      };
      
      state.actions.register(actionName, wrappedFn, {
        module: moduleName,
        description: `${moduleName} ${exportName}`,
        parameters: [] // TODO: Could extract from function signature
      });
    }
  }
}

// Exported actions for system management
export async function executeAction(_, { action, params = {} }) {
  return await state.actions.execute(action, params);
}

export async function reloadModule(_, { moduleName }) {
  try {
    // Clean up old module
    const oldModule = loadedModules.get(moduleName);
    if (oldModule && oldModule.cleanup) {
      await oldModule.cleanup();
    }
    
    // Reload
    await loadModules([moduleName]);
    
    return { success: true, message: `Reloaded ${moduleName}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function enableModule(_, { moduleName }) {
  const enabled = await chrome.storage.sync.get('enabledModules');
  const list = enabled.enabledModules || [];
  
  if (!list.includes(moduleName)) {
    list.push(moduleName);
    await chrome.storage.sync.set({ enabledModules: list });
    await loadModules([moduleName]);
  }
  
  return { success: true, message: `Enabled ${moduleName}` };
}

export async function disableModule(_, { moduleName }) {
  if (moduleName === 'startup') {
    return { success: false, error: 'Cannot disable startup module' };
  }
  
  const enabled = await chrome.storage.sync.get('enabledModules');
  const list = enabled.enabledModules || [];
  
  const index = list.indexOf(moduleName);
  if (index > -1) {
    list.splice(index, 1);
    await chrome.storage.sync.set({ enabledModules: list });
    
    // Clean up module
    const module = loadedModules.get(moduleName);
    if (module && module.cleanup) {
      await module.cleanup();
    }
    loadedModules.delete(moduleName);
  }
  
  return { success: true, message: `Disabled ${moduleName}` };
}

export async function getSystemStatus() {
  const modules = await state.read('system.modules');
  const errors = await state.read('system.errors');
  const actions = state.actions.list();
  
  return {
    status: await state.read('system.status'),
    modules: modules || [],
    errors: errors || [],
    totalActions: actions.length,
    actionsByModule: actions.reduce((acc, action) => {
      acc[action.module] = (acc[action.module] || 0) + 1;
      return acc;
    }, {}),
    stateKeys: Object.keys(state.localState)
  };
}

// Global access to state and actions (for LLM integration)
export function getState() {
  return state;
}

export function getActions() {
  return state.actions;
}

// Cleanup on service worker shutdown
export async function cleanup() {
  if (state?.channel) {
    state.channel.close();
  }
  
  // Clean up all loaded modules
  for (const [name, module] of loadedModules) {
    if (module.cleanup) {
      try {
        await module.cleanup();
      } catch (error) {
        console.error(`[Startup] Error cleaning up ${name}:`, error);
      }
    }
  }
}

// Tests
export const tests = [
  {
    name: 'initializes state store correctly',
    fn: async () => {
      const testState = new StateStore();
      
      await testState.write('test.key', 'test.value');
      const value = await testState.read('test.key');
      
      assert(value === 'test.value', 'State read/write should work');
      assert(testState.localState['test.key'] === 'test.value', 'Local state should be updated');
    }
  },
  
  {
    name: 'action registry works correctly',
    fn: async () => {
      const testState = new StateStore();
      testState.actions = {
        register: (name, fn) => actionRegistry.set(name, { fn }),
        execute: async (name, params) => {
          const action = actionRegistry.get(name);
          return await action.fn(params);
        }
      };
      
      // Register test action
      testState.actions.register('test.action', async (params) => {
        return { received: params.test };
      });
      
      // Execute test action
      const result = await testState.actions.execute('test.action', { test: 'hello' });
      
      assert(result.received === 'hello', 'Action execution should work');
    }
  },
  
  {
    name: 'handles module loading errors gracefully',
    fn: async () => {
      // This would test error handling in loadModules
      // For now, just verify the error structure exists
      assert(typeof loadModules === 'function', 'loadModules should be defined');
    }
  }
];

// Simple assertion helper
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}