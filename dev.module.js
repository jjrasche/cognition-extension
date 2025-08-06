import { kebabToCamel } from './helpers.js';

export const manifest = {
  name: "dev",
  context: "service-worker", // todo: this will likely live in the extension page context
  version: "1.0.0",
  description: "Development utilities and shortcuts for debugging",
  permissions: ["storage"],
  actions: [],
};

let _runtime = {}
export async function initialize(runtime) {
  _runtime = runtime;
  createActionShortcuts();
}

const isDevMode = () => !chrome.runtime.getManifest().update_url;
const createActionShortcuts = () => {
  if (isDevMode()) (addModuleActionsToConsole(), addEasyAccessVariablesToConsole())
};
const addModuleActionsToConsole = () => {
  for (let [name, { actionName, moduleName }] of _runtime.getActions().entries()) {
    moduleName = kebabToCamel(moduleName);
    globalThis[moduleName] ??= {};
    globalThis[moduleName][actionName] = (params = {}) => {
      return _runtime.executeAction(name, params)
        .then(res => {
          console.log(`[Dev] ${moduleName}.${actionName} →`, res)
          return res;
        })
        .catch(err => console.error(`[Dev] ${moduleName}.${actionName} ✗`, err));
    }
  }
  console.log('[Dev] Created action shortcuts:', Array.from(_runtime.getActions().keys()));
};
// todo: change this to pull from runtime.js
const addEasyAccessVariablesToConsole = () => {
  globalThis.state = _runtime.getState();
  globalThis.modules = _runtime.getModules();
  globalThis.printActions = () => _runtime.getActions().prettyPrint();
}