// background.js - Service Worker Entry Point
// This file bootstraps the module system and initializes the extension
import './dev-reload.js';
import './dev-console-helper.js';
import { ExtensionState } from './extension-state.js';
import { enabledModules } from './enabled-modules.js';

const extensionState = new ExtensionState();
globalThis.state = extensionState;
const loaded = [];
const errors = [];
chrome.runtime.onInstalled.addListener(async () => await initialize());

async function initialize() {
  try {
    console.log('[Background] Extension Initializing...');
    await extensionState.write('system.status', 'initializing');
    await extensionState.write('system.modules', []);
    await registerModules();
    registerModuleOauth();
    registerModuleContentScripts();
    console.log('[Background] Extension initialized successfully');
    await extensionState.write('system.modules', loaded);
    await extensionState.write('system.errors', errors);
    await extensionState.write('system.status', 'ready');
    if (errors.length > 0) {
      console.log('[Background] Errors:', errors);
    }
  } catch (error) {
    console.error('[Background] Failed to initialize extension:', error);
    if (extensionState) {
      await extensionState.write('system.status', 'error');
      await extensionState.write('system.errors', [{ module: 'background', error: error.message, stack: error.stack }]);
    }
  }
};

function registerModuleOauth() {
  for (const module of enabledModules) {
    if (module && 'oauth' in module) {
      try {
        extensionState.oauthManager.register(module.oauth.provider, module.oauth);
      } catch (error) {
        console.error(`[Background] Failed to register OAuth for ${module.manifest.name}:`, error);
        errors.push({ module: module.manifest.name, error: `OAuth registration: ${error.message}` });
      }
    }
  }
}

function registerModuleContentScripts() {
  for (const module of enabledModules) {
    if (module && 'contentScript' in module) {
      extensionState.actions.execute('contentHandler.register', {
        moduleName: module.manifest.name,
        ... module.contentScript
      });
    }
  }
}

async function registerModules() {
  for (const module of enabledModules) {
    const moduleName = module.manifest.name;
    try {
      const config = await extensionState.read(`modules.${moduleName}.config`) || {};
      if (module.manifest.name === 'content-script-handler') {
        debugger;
      }
      registerModuleActions(moduleName, module);
      await module.initialize(extensionState, config);
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
    .filter((action) => !['initialize', 'manifest', 'tests', 'default'].includes(action));
  for (const action of actions) {
    const fn = module[action];
    if (typeof fn === 'function') {
      if (extensionState.actions) {
        const method = async (params) => await fn(extensionState, params);
        extensionState.actions.register(`${name}.${action}`, method, { module: name, description: `${name} ${action}` });
      }
    }
  }
}

// Handle extension icon click - toggle UI
chrome.action.onClicked.addListener(() => extensionState.actions.execute('ui.toggle'));