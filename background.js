// background.js - Service Worker Entry Point
// This file bootstraps the module system and initializes the extension

// Import dev-reload for development (will fail silently in production)
import('./dev-reload.js').catch(() => {
  // Ignore - this file won't exist in production builds
});

// Import dev console helpers for development
import('./dev-console-helpers.js').catch(() => {
  // Ignore - this file won't exist in production builds
});

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

// Register a module's actions with the state store
function registerModuleActions(name, module) {
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

async function initializeExtension() {
  try {
    console.log('[Background] Starting extension initialization...');
    
    // Create the global state store
    globalState = new StateStore();
    
    // Wait for state store to be ready
    await globalState.loadPersistedState();
    
    // Set initial system state
    await globalState.write('system.status', 'initializing');
    await globalState.write('system.modules', []);
    await globalState.write('system.errors', []);
    
    // Get enabled modules from storage
    const { enabledModules = ['fitbit', 'ui'] } = await chrome.storage.sync.get('enabledModules');
    console.log('[Background] Enabled modules:', enabledModules);
    
    const loaded = [];
    const errors = [];
    
    // Initialize each module
    for (const moduleName of enabledModules) {
      if (moduleRegistry[moduleName]) {
        try {
          console.log(`[Background] Initializing module: ${moduleName}`);
          const module = moduleRegistry[moduleName];
          const config = await getModuleConfig(moduleName);
          
          // Register the module's actions first
          registerModuleActions(moduleName, module);
          
          // Then initialize the module
          if (module.initialize) {
            await module.initialize(globalState, config);
          }
          
          loaded.push({
            name: moduleName,
            version: module.manifest?.version || '1.0.0',
            status: 'active'
          });
          
          console.log(`[Background] Module ${moduleName} initialized successfully`);
          
        } catch (error) {
          console.error(`[Background] Failed to initialize module ${moduleName}:`, error);
          errors.push({
            module: moduleName,
            error: error.message,
            stack: error.stack
          });
        }
      } else {
        console.warn(`[Background] Module ${moduleName} not found in registry`);
      }
    }
    
    // Update system state
    await globalState.write('system.modules', loaded);
    await globalState.write('system.errors', errors);
    await globalState.write('system.status', 'ready');
    
    console.log('[Background] Extension initialized successfully');
    console.log('[Background] Loaded modules:', loaded);
    if (errors.length > 0) {
      console.log('[Background] Errors:', errors);
    }
    
  } catch (error) {
    console.error('[Background] Failed to initialize extension:', error);
    if (globalState) {
      await globalState.write('system.status', 'error');
      await globalState.write('system.errors', [{
        module: 'background',
        error: error.message,
        stack: error.stack
      }]);
    }
  }
}

// Initialize the extension when installed
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Background] Extension installed, initializing...');
  await initializeExtension();
});

// Also initialize on service worker startup
initializeExtension();

// Handle extension icon click - toggle UI
chrome.action.onClicked.addListener(async () => {
  if (globalState?.actions) {
    const result = await globalState.actions.execute('ui.toggle');
    console.log('[Background] UI toggle result:', result);
  }
});

// Listen for OAuth redirects using webNavigation API
chrome.webNavigation.onBeforeNavigate.addListener(
  async (details) => {
    console.log('[Background] Navigation detected:', details.url);
    
    try {
      const url = new URL(details.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      
      if (code && globalState?.actions) {
        console.log('[Background] OAuth code found:', code);
        
        const result = await globalState.actions.execute('fitbit.handleAuthCallback', { code, state });
        console.log('[Background] OAuth callback result:', result);
        
        if (result.success) {
          setTimeout(() => {
            chrome.tabs.remove(details.tabId);
          }, 100);
        }
      }
    } catch (error) {
      console.error('[Background] OAuth redirect error:', error);
    }
  },
  {
    urls: ['https://chromiumapp.org/*']
  }
);

// Listen for OAuth redirects (for Fitbit)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes(`${chrome.runtime.id}.chromiumapp.org`)) {
    // This is our OAuth redirect
    const url = new URL(changeInfo.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    
    if (code && globalState?.actions) {
      try {
        const result = await globalState.actions.execute('fitbit.handleAuthCallback', { code, state });
        console.log('[Background] OAuth callback result:', result);
        
        // Close the tab on success
        if (result.success) {
          chrome.tabs.remove(tabId);
        }
      } catch (error) {
        console.error('[Background] OAuth callback error:', error);
      }
    }
  }
});

// Message handling for test page and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXECUTE_ACTION' && globalState?.actions) {
    console.log('[Background] Received action request:', request.action, request.params);
    
    globalState.actions.execute(request.action, request.params)
      .then(result => {
        console.log('[Background] Action result:', result);
        sendResponse(result);
      })
      .catch(error => {
        console.error('[Background] Action error:', error);
        sendResponse({ success: false, error: error.message });
      });
      
    return true; // Keep channel open for async response
  }
});

// Export for debugging (only in development)
if (globalThis.chrome?.runtime?.id) {
  globalThis.cognitionState = globalState;
  globalThis.cognitionModules = moduleRegistry;
}