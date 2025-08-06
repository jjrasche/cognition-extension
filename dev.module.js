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
  for (let [name] of _runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    const camelModuleName = kebabToCamel(moduleName);
    
    globalThis[camelModuleName] ??= {};
    globalThis[camelModuleName][actionName] = (params = {}) => {
      return _runtime.executeAction(name, params)
        .then(res => {
          console.log(`[Dev] ${camelModuleName}.${actionName} →`, res)
          return res;
        })
        .catch(err => console.error(`[Dev] ${camelModuleName}.${actionName} ✗`, err));
    }
  }
  console.log('[Dev] Created action shortcuts:', Array.from(_runtime.getActions().keys()));
};

const addEasyAccessVariablesToConsole = () => {
  globalThis.modules = _runtime.getModules();
  globalThis.printActions = () => _runtime.getActions().prettyPrint();
  globalThis.printActions = prettyPrintActions;
}

const prettyPrintActions = () => {
  const actions = {};
  for (let [name] of _runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    actions[name] = { module: moduleName, action: actionName };
  }
  console.table(actions);
};