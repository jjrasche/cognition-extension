self.addEventListener('error', (event) => {
  console.error('Service Worker Error:', event.error);
  console.error('Stack:', event.error.stack);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled Promise Rejection:', event.reason);
});

// background.js - Service Worker Entry Point
// This file bootstraps the module system and initializes the extension
import './dev-reload.js';
import { ExtensionStore } from './extension-state.js';
import { modules } from './module-registry.js';
const _state = new ExtensionStore();
const loaded = [];
const errors = [];
chrome.runtime.onInstalled.addListener(async () => await initialize());

async function initialize() {
  try {
    console.log('[Background] Extension Initializing...');
    await _state.write('system.modules', []);
    await _state.write('system.status', 'initializing');
    await registerModules();
    registerModuleOauth();
    registerModuleContentScripts();
    console.log('[Background] Extension initialized successfully');
    await _state.write('system.modules', loaded);
    await _state.write('system.errors', errors);
    await _state.write('system.status', 'ready');
    if (errors.length > 0) {
      console.log('[Background] Errors:', errors);
    }
  } catch (error) {
    console.error('[Background] Failed to initialize extension:', error);
    await _state.write('system.status', 'error');
    await _state.write('system.errors', [{ module: 'background', error: error.message, stack: error.stack }]);
  }
};

function registerModuleOauth() {
  for (const module of modules) {
    if (module && 'oauth' in module) {
      try {
        _state.oauthManager.register(module.oauth.provider, module.oauth);
      } catch (error) {
        console.error(`[Background] Failed to register OAuth for ${module.manifest.name}:`, error);
        errors.push({ module: module.manifest.name, error: `OAuth registration: ${error.message}` });
      }
    }
  }
}

function registerModuleContentScripts() {
  for (const module of modules) {
    if (module && 'contentScript' in module) {
      console.log(`[Background] content script registered for: ${module.manifest.name}`);
      _state.actions.execute("content-script-handler.register", {
        moduleName: module.manifest.name,
        ...module.contentScript
      });
    }
  }
}

async function registerModules() {
  for (const module of modules) {
    const moduleName = module.manifest.name;
    try {
      const config = await _state.read(`modules.${moduleName}.config`) || {};
      registerModuleActions(moduleName, module);
      await module.initialize(_state, config);
      loaded.push({ name: moduleName, version: module.manifest?.version, status: 'active' });
    } catch (error) {
      console.error(`[Background] Failed to initialize module ${moduleName}:`, error);
      errors.push({ module: moduleName, error: error.message, stack: error.stack });
    }
  }
}

const registerModuleActions = (moduleName, moduleObject) => Object.getOwnPropertyNames(moduleObject)
    .filter((prop) => typeof moduleObject[prop] === 'function')
    .filter((actionName) => !['initialize', 'manifest', 'tests', 'default'].includes(actionName))
    .forEach(actionName => _state.actions.register(moduleName, actionName, moduleObject[actionName]));

// Handle extension icon click - toggle UI
chrome.action.onClicked.addListener(() => _state.actions.execute('ui.toggle'));