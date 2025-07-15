// background.js - Service Worker Entry Point
// This file bootstraps the module system and initializes the extension

// background.js - Service Worker Entry Point
import './dev-reload.js';
import './dev-console-helper.js';
import { StateStore } from './state-store.js';
import { enabledModules } from './enabled-modules.js';

const stateStore = new StateStore();
globalThis.state = stateStore;
const loaded = [];
const errors = [];

chrome.runtime.onInstalled.addListener(async () => await initialize() );
async function initialize() {
  try {
    console.log('[Background] Extension Initializing...');
    await stateStore.write('system.status', 'initializing');
    await stateStore.write('system.modules', []);    
    
    registerModuleOauth();
    registerModules()
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

// initialize module oauth
function registerModuleOauth() {
    for (const module of enabledModules) {
      if (module.oauth) {
        try {
          stateStore.oauthManager.register(module.oauth.provider, module.oauth);
        } catch (error) {
          console.error(`[Background] Failed to register OAuth for ${module.manifest.name}:`, error);
          errors.push({ module: module.manifest.name, error: `OAuth registration: ${error.message}` });
        }
      }
    }
}

async function registerModules() {
  for (const module of enabledModules) {
    try {
      const moduleName = module.manifest.name;
      const config = await stateStore.read(`modules.${moduleName}.config`) || {};
      registerModuleActions(moduleName, module);
      await module.initialize(stateStore, config);
      loaded.push({ name: moduleName, version: module.manifest?.version, status: 'active' });
    } catch (error) {
      console.error(`[Background] Failed to initialize module ${moduleName}:`, error);
      errors.push({ module: moduleName, error: error.message, stack: error.stack });
    }
  }
}

// Register a module's actions with the state store
function registerModuleActions(name, module) {
  const actions = Object.getOwnPropertyNames(module)
    .filter((action) =>  !['initialize', 'manifest', 'tests', 'default'].includes(action));
  for (const action of actions) {
    const fn = module[action];
    if (typeof fn === 'function') {
      if (stateStore.actions) {
        const method = async (params) => await fn(stateStore, params);
        stateStore.actions.register(`${name}.${action}`, method, { module: name, description: `${name} ${action}` });
      }
    }
  }
}

// Handle extension icon click - toggle UI
chrome.action.onClicked.addListener(() => stateStore.actions.execute('ui.toggle'));

// // Message handling for test page and content scripts
// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//   if (request.type === 'EXECUTE_ACTION' && stateStore.actions) {
//     console.log('[Background] Received action request:', request.action, request.params);
    
//     stateStore.actions.execute(request.action, request.params)
//       .then(result => {
//         console.log('[Background] Action result:', result);
//         sendResponse(result);
//       })
//       .catch(error => {
//         console.error('[Background] Action error:', error);
//         sendResponse({ success: false, error: error.message });
//       });
      
//     return true; // Keep channel open for async response
//   }
  
//   if (request.type === 'GET_STATE' && stateStore) {
//     console.log('[Background] Received state request');
    
//     // Return the current state
//     sendResponse({
//       success: true,
//       state: stateStore.localState
//     });
    
//     return false; // Synchronous response
//   }
// });
 