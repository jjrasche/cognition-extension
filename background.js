// background.js - Service Worker Entry Point
// This file bootstraps the module system and initializes the extension
import './dev-reload.js';
import './dev-console-helper.js';
import { ExtensionState } from './extension-state.js';
import { modules } from './module-registry.js';

const _state = new ExtensionState();
const loaded = [];
const errors = [];
chrome.runtime.onInstalled.addListener(async () => await initialize());
const isDevelopmentMode = () => !chrome.runtime.getManifest().update_url;

async function initialize() {
  try {
    console.log('[Background] Extension Initializing...');
    await _state.write('system.status', 'initializing');
    await _state.write('system.modules', []);
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
    if (isDevelopmentMode()) createActionShortcuts();
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

// Register a module's actions with the state store
function registerModuleActions(name, module) {
  const actions = Object.getOwnPropertyNames(module)
    .filter((action) => !['initialize', 'manifest', 'tests', 'default'].includes(action));
  for (const action of actions) {
    const fn = module[action];
    if (typeof fn === 'function') {
      if (_state.actions) {
        const method = async (params) => await fn(_state, params);
        _state.actions.register(`${name}.${action}`, method, { module: name, description: `${name} ${action}` });
      }
    }
  }
}

const createActionShortcuts = () => {
  const actions = _state.actions.list();
  for (const action of actions) {
    const moduleName = action.module.replace(/-/g, "");
    const actionName = action.name.replace(`${moduleName}.`, "");
    if (!globalThis[moduleName]) globalThis[moduleName] = {};
    globalThis[moduleName][actionName] = (params) => _state.actions.execute(action.name, params);
  }
  globalThis.state = _state;
  console.log('[Dev] Created action shortcuts:', actions.map(a => a.name).filter(Boolean));
}

// Handle extension icon click - toggle UI
chrome.action.onClicked.addListener(() => _state.actions.execute('ui.toggle'));