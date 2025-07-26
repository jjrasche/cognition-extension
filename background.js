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
    await beginInitialization()
    await registerModules();
    await registerOauth();
    registerActions();
    await registerContentScripts();
    await registerInference();
    await completeInitialization();
  } catch (error) { await handleInitializationExceptions(error); }
};
const logAndWrite = async (msg, update, err) => (console.log(`[Background] ${msg}`, err ?? ""), await _state.writeMany(update));
const beginInitialization = async () => logAndWrite('Starting extension initialization...', {'system.status': 'initializing', 'system.modules': [], 'system.errors': []});
const completeInitialization = async () => (logAndWrite('Extension initialization complete', {'system.status': 'ready', 'system.modules': loaded, 'system.errors': errors}), printErrors());
const printErrors = async () => errors.length > 0 && console.log('[Background] Errors:', errors);
const handleInitializationExceptions = async (err) => logAndWrite('Error during initialization', {'system.status': 'error', 'system.errors': errors, 'system.modules': loaded}, err);
const getModuleConfig = async (module) => await _state.read(`modules.${module.manifest.name}.config`) || {};

const registerModules = async () => forAllModules("module", async (module) => {
  await module.initialize(_state, await getModuleConfig(module));
  loaded.push({ name: module.manifest.name, version: module.manifest?.version, status: 'active' });
});
const registerOauth = async () => forAllModules('oauth', async (module) => 'oauth' in module && await _state.oauthManager.register(module) );
const registerContentScripts = async () => forAllModules("contentScript", async (module) => 'contentScript' in module && await _state.actions.execute("content-script-handler.register", module));
const registerInference = async () => forAllModules("inference", async (module) => {
  if (module.manifest.defaultModel) {
    await _state.actions.execute("inference.register", module);
  }
});
const registerActions = () => forAllModules("actions", async (module) => Object.getOwnPropertyNames(module)
  .filter((prop) => typeof module[prop] === 'function')
  .filter((actionName) => !['initialize', 'manifest', 'tests', 'default'].includes(actionName))
  .forEach(actionName => _state.actions.register(module.manifest.name, actionName, module[actionName]))
);

const forAllModules = async (action, operation) => {
  for (const module of modules) {
    try { await operation(module) }
    catch (err) { 
      console.error(`[Background] Failed to register ${action} for ${module.manifest.name}:`, err);
      errors.push({ module: module.manifest.name, error: `${action}: ${err.message}` });
    }
  }
}
