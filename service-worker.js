import './dev-reload.js';
import { initializeRuntime } from "./runtime.js";
let runtime;
chrome.runtime.onInstalled.addListener(async () => ( runtime = initializeRuntime('service-worker'), initializeOffscreenDocument(), initializeExtensionPage() ));
const initializeOffscreenDocument = async () => await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['LOCAL_STORAGE'], justification: 'Run ML models that require full browser APIs' });
const initializeExtensionPage = async () => !(await extensionPageExists()) && await createExtensionPage();
const extensionPageExists = async () => {
    const storedTabId = await getExtensionPageTabId();
    if (storedTabId) {
        try { await chrome.tabs.get(storedTabId) } 
        catch (e) { await removeExtensionPageTabId(); return false; }
    }
    return !!storedTabId;
}

const createExtensionPage = async () => {
    const tab = await chrome.tabs.create({ url: 'extension-page.html', active: false });
    await setExtensionPageTabId(tab.id);
}
// chrome.tabs.onRemoved.addListener(async (tabId) => {
//     const storedTabId = await getExtensionPageTabId();
//     if (tabId === storedTabId) (await removeExtensionPageTabId(), await createExtensionPage());
// });

const getExtensionPageTabId = async () => (await chrome.storage.local.get(['extensionPageTabId'])).extensionPageTabId;
const removeExtensionPageTabId = async () => await chrome.storage.local.remove(['extensionPageTabId']);
const setExtensionPageTabId = async (tabId) => await chrome.storage.local.set({ extensionPageTabId: tabId });












// todo: add the self registering portions below to their own modules
// // background.js - Service Worker Entry Point : This file bootstraps the module system and initializes the extension
// import { ExtensionStore } from './extension-state.js';
// import { modules } from './module-registry.js';
// const { getId } = globalThis.cognition;

// const _state = new ExtensionStore();
// const loaded = [];
// const errors = [];
// chrome.runtime.onInstalled.addListener(async () => await initialize());

// async function initialize() {
//   try {
//     await beginInitialization()
//     // await initializeOffscreenDocument();
//     await registerModules();
//     await registerActions();
//     // await registerOauth();
//     // await registerInference();
//     // await registerContentScripts();
//     // await loadModels();
//     await completeInitialization();
//   } catch (error) { await handleInitializationExceptions(error); }
// };
// const logAndWrite = async (msg, update, err) => (console.log(`[Background] ${msg}`, err ?? ""), await _state.writeMany(update));
// const beginInitialization = async () => await logAndWrite('Starting extension initialization...', {'system.status': 'initializing', 'system.modules': [], 'system.errors': []});
// const completeInitialization = async () => (await logAndWrite('Extension initialization complete', {'system.status': 'ready', 'system.modules': loaded, 'system.errors': errors}), printErrors());
// const printErrors = async () => errors.length > 0 && console.log('[Background] Errors:', errors);
// const handleInitializationExceptions = async (err) => await logAndWrite('Error during initialization', {'system.status': 'error', 'system.errors': errors, 'system.modules': loaded}, err);
// const getModuleConfig = async (module) => await _state.read(`modules.${module.manifest.name}.config`) || {};

// const registerModules = async () => await forAllModules("module", async (module) => {
//   await module.initialize(_state, await getModuleConfig(module));
//   loaded.push(module.manifest);
// }, (m) => !m.manifest.offscreen);
// const registerOauth = async () => await forAllModules('oauth', async (module) => await _state.oauthManager.register(module), (m) => 'oauth' in m );
// const registerContentScripts = async () => await forAllModules("contentScript", async (module) => await _state.actions.execute("content-script-handler.register", module), (m) => 'contentScript' in m);
// const registerInference = async () => await forAllModules("inference", async (module) => module.manifest.defaultModel && await _state.actions.execute("inference.register", module));
// const registerActions = async() => await forAllModules("actions", (module) => Object.getOwnPropertyNames(module)
//   .filter((prop) => typeof module[prop] === 'function')
//   .filter((actionName) => !['initialize', 'manifest', 'tests', 'default'].includes(actionName))
//   .forEach(actionName => _state.actions.register(module.manifest.name, actionName, module[actionName]))
// );
// const loadModels = async () => await forAllModules("localModels", async (module) => module.manifest.localModels && module.manifest.localModels.forEach(async (m) => await _state.actions.execute('transformer.loadModel', {modelId: m})));

// const forAllModules = async (action, operation, filter = () => true) => {
//   for (const module of modules.filter(filter)) {
//     try { await operation(module) }
//     catch (err) { 
//       console.error(`[Background] Failed to register ${action} for ${module.manifest.name}:`, err);
//       errors.push({ module: module.manifest.name, error: `${action}: ${err.message}` });
//     }
//   }
// }

