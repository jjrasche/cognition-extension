// background.js - Service Worker Entry Point
// This file bootstraps the module system and initializes the extension

// Import all modules statically (required for Manifest V3)
import './dev-reload.js';
import './dev-console-helper.js';
import * as fitbitModule from './fitbit.module.js';
import * as uiModule from './ui.module.js';
import * as transcriptModule from './transcript.module.js';
// Module registry - maps module names to their exports
const moduleRegistry = {
  'fitbit': fitbitModule,
  'ui': uiModule,
  'transcript': transcriptModule
};

// Global state store instance
let globalState = null; 

// Track OAuth codes being processed to prevent duplicate handling
const processingOAuthCodes = new Set();

// Track active OAuth flows to prevent concurrent auth attempts
let isOAuthFlowActive = false;

// StateStore implementation that all modules will use
class StateStore {
  constructor() {
    this.channel = new BroadcastChannel('cognition-state');
    this.localState = {};
    this.watchers = new Map();
    this.actions = this.createActionRegistry();
    this.isLoaded = false;
    this.pendingWrites = new Map();
    this.writeTimer = null;
    
    // Register built-in state management actions
    this.registerStateActions();
    
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
  
  registerStateActions() {
    // Register read action for external access
    this.actions.register('state.read', async (params) => {
      const { key } = params;
      return await this.read(key);
    }, {
      module: 'state',
      description: 'Read a value from state',
      parameters: ['key']
    });
    
    // Register write action for external access
    this.actions.register('state.write', async (params) => {
      const { key, value } = params;
      await this.write(key, value);
      return { success: true };
    }, {
      module: 'state',
      description: 'Write a value to state',
      parameters: ['key', 'value']
    });
  }
  
  async loadPersistedState() {
    if (this.isLoaded) return;
    
    try {
      const stored = await chrome.storage.local.get('cognitionState');
      if (stored.cognitionState) {
        this.localState = { ...stored.cognitionState };
      }
      this.isLoaded = true;
      console.log('[StateStore] Initial state loaded:', Object.keys(this.localState));
    } catch (error) {
      console.error('[StateStore] Failed to load persisted state:', error);
      this.isLoaded = true; // Continue with empty state
    }
  }
  
  async ensureLoaded() {
    if (!this.isLoaded) {
      await this.loadPersistedState();
    }
  }
  
  async read(key) {
    await this.ensureLoaded();
    return this.localState[key];
  }
  
  async write(key, value) {
    await this.ensureLoaded();
    
    // Update local state immediately
    this.localState[key] = value;
    
    // Queue for batched persistence
    this.pendingWrites.set(key, value);
    this.schedulePersistence();
    
    // Broadcast change immediately
    this.channel.postMessage({ key, value });
    
    // Notify watchers immediately
    if (this.watchers.has(key)) {
      this.watchers.get(key).forEach(callback => callback(value));
    }
  }
  
  schedulePersistence() {
    // Clear existing timer
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }
    
    // Schedule batched write
    this.writeTimer = setTimeout(async () => {
      await this.flushPendingWrites();
    }, 100); // Batch writes over 100ms
  }
  
  async flushPendingWrites() {
    if (this.pendingWrites.size === 0) return;
    
    try {
      // Get current state from storage and merge with pending writes
      const currentState = { ...this.localState };
      
      // Write entire state at once
      await chrome.storage.local.set({ cognitionState: currentState });
      
      console.log(`[StateStore] Persisted ${this.pendingWrites.size} changes to storage`);
      this.pendingWrites.clear();
    } catch (error) {
      console.error('[StateStore] Failed to persist state:', error);
      // Don't clear pendingWrites on error - they'll be retried
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

// Get module configuration from StateStore
async function getModuleConfig(moduleName) {
  const key = `modules.${moduleName}.config`;
  return await globalState.read(key) || {};
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
    
    // Get enabled modules from StateStore
    let enabledModules = await globalState.read('system.enabledModules');
    if (!enabledModules) {
      // Default modules if not set
      enabledModules = ['fitbit', 'ui'];
      await globalState.write('system.enabledModules', enabledModules);
    }
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

    // Export for debugging (only in development)
    if (globalThis.chrome?.runtime?.id) {
      globalThis.cognitionState = globalState;
      globalThis.cognitionModules = moduleRegistry;
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
        // Check if we're already processing this code
        if (processingOAuthCodes.has(code)) {
          console.log('[Background] OAuth code already being processed by other listener, skipping');
          return;
        }
        
        // Mark this code as being processed
        processingOAuthCodes.add(code);
        
        console.log('[Background] webNavigation: OAuth code found:', code, 'state:', state);
        
        const result = await globalState.actions.execute('fitbit.handleAuthCallback', { code, state });
        console.log('[Background] webNavigation: OAuth callback result:', result);
        
        if (result.success) {
          setTimeout(() => {
            chrome.tabs.remove(details.tabId).catch(() => {
              // Tab might already be closed
            });
          }, 100);
        }
        
        // Remove code from processing set after a delay
        setTimeout(() => {
          processingOAuthCodes.delete(code);
        }, 5000);
      }
    } catch (error) {
      console.error('[Background] webNavigation: OAuth redirect error:', error);
      // Clean up on error
      const url = new URL(details.url);
      const code = url.searchParams.get('code');
      if (code) {
        processingOAuthCodes.delete(code);
      }
    }
  },
  {
    urls: ['https://chromiumapp.org/*']
  }
);

// Listen for OAuth redirects (for Fitbit) - backup listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.startsWith('https://chromiumapp.org/')) {
    console.log('[Background] OAuth redirect detected in tabs.onUpdated:', changeInfo.url);
    
    try {
      const url = new URL(changeInfo.url);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      
      if (code) {
        // Check if we're already processing this code
        if (processingOAuthCodes.has(code)) {
          console.log('[Background] OAuth code already being processed by other listener, skipping');
          return;
        }
        
        // Mark this code as being processed
        processingOAuthCodes.add(code);
        
        console.log('[Background] tabs.onUpdated: OAuth code found:', code, 'state:', state);
        
        if (globalState?.actions) {
          const result = await globalState.actions.execute('fitbit.handleAuthCallback', { code, state });
          console.log('[Background] tabs.onUpdated: OAuth callback result:', result);
          
          // Close the tab on success
          if (result.success) {
            setTimeout(() => {
              chrome.tabs.remove(tabId).catch(() => {
                // Tab might already be closed by the other listener
              });
            }, 100);
          }
          
          // Remove code from processing set after a delay
          setTimeout(() => {
            processingOAuthCodes.delete(code);
          }, 5000);
        } else {
          console.error('[Background] globalState.actions not available yet');
          processingOAuthCodes.delete(code);
        }
      }
    } catch (error) {
      console.error('[Background] tabs.onUpdated: OAuth callback error:', error);
      // Clean up on error
      const url = new URL(changeInfo.url);
      const code = url.searchParams.get('code');
      if (code) {
        processingOAuthCodes.delete(code);
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
  
  if (request.type === 'GET_STATE' && globalState) {
    console.log('[Background] Received state request');
    
    // Return the current state
    sendResponse({
      success: true,
      state: globalState.localState
    });
    
    return false; // Synchronous response
  }
});
