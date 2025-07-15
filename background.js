// background.js - Service Worker Entry Point
// This file bootstraps the module system and initializes the extension

// background.js - Service Worker Entry Point
import './dev-reload.js';
import './dev-console-helper.js';
import { StateStore } from './state-store.js';
import { enabledModules } from './enabled-modules.js';

const stateStore = new StateStore();

chrome.runtime.onInstalled.addListener(async () => await initialize() );
async function initialize() {
  try {
    console.log('[Background] Extension Initializing...');
    await stateStore.write('system.status', 'initializing');
    await stateStore.write('system.modules', []);    
    const loaded = [];
    const errors = [];
    for (const moduleName of enabledModules) {
      try {
        const module = moduleRegistry[moduleName];
        const config = await stateStore.read(`modules.${moduleName}.config`) || {};
        registerModuleActions(moduleName, module);
        await module.initialize(stateStore, config);
        loaded.push({ name: moduleName, version: module.manifest?.version, status: 'active' });
        console.log(`[Background] Module ${moduleName} initialized successfully`);
      } catch (error) {
        console.error(`[Background] Failed to initialize module ${moduleName}:`, error);
        errors.push({ module: moduleName, error: error.message, stack: error.stack });
      }
    }
    console.log('[Background] Extension initialized successfully');
    await stateStore.write('system.modules', loaded);
    await stateStore.write('system.errors', errors);
    await stateStore.write('system.status', 'ready');
    if (errors.length > 0) {
      console.log('[Background] Errors:', errors);
    }
  } catch (error) {
    console.error('[Background] Failed to initialize extension:', error);
    if (stateStore) {
      await stateStore.write('system.status', 'error');
      await stateStore.write('system.errors', [{ module: 'background', error: error.message, stack: error.stack }]);
    }
  }
};


// Register a module's actions with the state store
function registerModuleActions(name, module) {
  const actions = Object.getOwnPropertyNames(module);
  actions.remove((action) =>  ['initialize', 'manifest', 'tests', 'default'].includes(action));
  for (const action of actions) {
    const fn = module[action];
    if (typeof fn === 'function') {
      if (stateStore?.actions) {
        stateStore.actions.register(`${name}.${action}`, async (params) => 
          await fn(stateStore, params), { module: name, description: `${name} ${action}` });
      }
    }
  }
}

// Handle extension icon click - toggle UI
chrome.action.onClicked.addListener(async () => {
  if (stateStore?.actions) {
    const result = await stateStore.actions.execute('ui.toggle');
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
      
      if (code && stateStore?.actions) {
        // Check if we're already processing this code
        if (processingOAuthCodes.has(code)) {
          console.log('[Background] OAuth code already being processed by other listener, skipping');
          return;
        }
        
        // Mark this code as being processed
        processingOAuthCodes.add(code);
        
        console.log('[Background] webNavigation: OAuth code found:', code, 'state:', state);
        
        const result = await stateStore.actions.execute('fitbit.handleAuthCallback', { code, state });
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
        
        if (stateStore?.actions) {
          const result = await stateStore.actions.execute('fitbit.handleAuthCallback', { code, state });
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
          console.error('[Background] stateStore.actions not available yet');
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
  if (request.type === 'EXECUTE_ACTION' && stateStore?.actions) {
    console.log('[Background] Received action request:', request.action, request.params);
    
    stateStore.actions.execute(request.action, request.params)
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
  
  if (request.type === 'GET_STATE' && stateStore) {
    console.log('[Background] Received state request');
    
    // Return the current state
    sendResponse({
      success: true,
      state: stateStore.localState
    });
    
    return false; // Synchronous response
  }
});
