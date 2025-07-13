// background.js - Service Worker Entry Point
// This file bootstraps the module system and initializes the extension

// Import all modules statically (required for Manifest V3)
import * as startupModule from './startup.module.js';
import * as fitbitModule from './fitbit.module.js';
import * as uiModule from './ui.module.js';

// Module registry - maps module names to their exports
const moduleRegistry = {
  'startup': startupModule,
  'fitbit': fitbitModule,
  'ui': uiModule
};

// Global state store instance
let globalState = null;

// Initialize the extension
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed, initializing...');
  await initializeExtension();
});

// Also initialize on service worker startup
initializeExtension();

async function initializeExtension() {
  try {
    // Create the global state store
    globalState = new StateStore();
    
    // Initialize the startup module first
    await startupModule.initialize(globalState, {});
    
    // Register all modules with the startup module
    for (const [name, module] of Object.entries(moduleRegistry)) {
      if (name !== 'startup') {
        registerModule(name, module);
      }
    }
    
    // Get enabled modules from storage
    const { enabledModules = ['fitbit', 'ui'] } = await chrome.storage.sync.get('enabledModules');
    
    // Initialize enabled modules
    for (const moduleName of enabledModules) {
      if (moduleRegistry[moduleName]) {
        console.log(`[Background] Initializing module: ${moduleName}`);
        const config = await getModuleConfig(moduleName);
        await moduleRegistry[moduleName].initialize(globalState, config);
      }
    }
    
    console.log('[Background] Extension initialized successfully');
  } catch (error) {
    console.error('[Background] Failed to initialize:', error);
  }
}

// Register a module's actions with the startup module
function registerModule(name, module) {
  const exports = Object.getOwnPropertyNames(module);
  
  for (const exportName of exports) {
    if (exportName === 'initialize' || exportName === 'manifest' || exportName === 'tests' || exportName === 'default') {
      continue;
    }
    
    const fn = module[exportName];
    if (typeof fn === 'function') {
      const actionName = `${name}.${exportName}`;
      
      // Register with the global action system
      if (globalState?.actions) {
        globalState.actions.register(actionName, async (params) => {
          return await fn(globalState, params);
        }, {
          module: name,
          description: `${name} ${exportName}`
        });
      }
    }
  }
}

// Get module configuration from storage
async function getModuleConfig(moduleName) {
  const key = `modules.${moduleName}`;
  const stored = await chrome.storage.sync.get(key);
  return stored[key] || {};
}

// StateStore implementation that all modules will use
class StateStore {
  constructor() {
    this.channel = new BroadcastChannel('cognition-state');
    this.localState = {};
    this.watchers = new Map();
    this.actions = this.createActionRegistry();
    
    // Listen for state changes
    this.channel.onmessage = (event) => {
      const { key, value } = event.data;
      this.localState[key] = value;
      
      // Notify watchers
      if (this.watchers.has(key)) {
        this.watchers.get(key).forEach(callback => callback(value));
      }
    };
    
    // Load initial state from storage
    this.loadPersistedState();
  }
  
  async loadPersistedState() {
    const stored = await chrome.storage.local.get('cognitionState');
    if (stored.cognitionState) {
      this.localState = { ...stored.cognitionState };
    }
  }
  
  async read(key) {
    if (key in this.localState) {
      return this.localState[key];
    }
    
    const stored = await chrome.storage.local.get('cognitionState');
    const value = stored.cognitionState?.[key];
    if (value !== undefined) {
      this.localState[key] = value;
    }
    return value;
  }
  
  async write(key, value) {
    this.localState[key] = value;
    
    // Persist to storage
    const stored = await chrome.storage.local.get('cognitionState');
    const state = stored.cognitionState || {};
    state[key] = value;
    await chrome.storage.local.set({ cognitionState: state });
    
    // Broadcast change
    this.channel.postMessage({ key, value });
    
    // Notify watchers
    if (this.watchers.has(key)) {
      this.watchers.get(key).forEach(callback => callback(value));
    }
  }
  
  watch(key, callback) {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, new Set());
    }
    this.watchers.get(key).add(callback);
    
    return () => {
      this.watchers.get(key)?.delete(callback);
    };
  }
  
  createActionRegistry() {
    const actionMap = new Map();
    
    return {
      register(name, fn, metadata = {}) {
        actionMap.set(name, {
          fn,
          module: metadata.module || 'unknown',
          description: metadata.description || '',
          parameters: metadata.parameters || []
        });
        console.log(`[StateStore] Registered action: ${name}`);
      },
      
      async execute(name, params = {}) {
        const action = actionMap.get(name);
        if (!action) {
          throw new Error(`Action not found: ${name}`);
        }
        
        try {
          console.log(`[StateStore] Executing action: ${name}`);
          const result = await action.fn(params);
          return { success: true, result };
        } catch (error) {
          console.error(`[StateStore] Action ${name} failed:`, error);
          return { success: false, error: error.message };
        }
      },
      
      list() {
        return Array.from(actionMap.entries()).map(([name, info]) => ({
          name,
          module: info.module,
          description: info.description,
          parameters: info.parameters
        }));
      }
    };
  }
}

// Handle extension icon click - toggle UI
chrome.action.onClicked.addListener(async () => {
  if (globalState?.actions) {
    await globalState.actions.execute('ui.toggle');
  }
});

// Listen for OAuth redirects (for Fitbit)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes(`${chrome.runtime.id}.chromiumapp.org`)) {
    // This is our OAuth redirect
    const url = new URL(changeInfo.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    
    if (code && moduleRegistry.fitbit?.handleAuthCallback) {
      try {
        await moduleRegistry.fitbit.handleAuthCallback(globalState, { code, state });
        // Close the tab
        chrome.tabs.remove(tabId);
      } catch (error) {
        console.error('[Background] OAuth callback error:', error);
      }
    }
  }
});

// Message handling for content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXECUTE_ACTION' && globalState?.actions) {
    globalState.actions.execute(request.action, request.params)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

// Export for debugging
global.cognitionState = globalState;
global.cognitionModules = moduleRegistry;