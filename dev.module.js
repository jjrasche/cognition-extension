import { modules } from './module-registry.js';

export const manifest = {
  name: "dev",
  version: "1.0.0",
  description: "Development utilities and shortcuts for debugging",
  permissions: ["storage"],
  actions: [],
  state: {
    reads: [],
    writes: ["system.dev"]
  }
};
const isDevMode = () => !chrome.runtime.getManifest().update_url;
const setDevMode = async () => await _state.write('system.dev', isDevMode());

let _state = {}
export async function initialize(state, config) {
  _state = state;
  await setDevMode();
  createActionShortcuts();
  console.log('[Dev] Initializing development utilities');
}


const createActionShortcuts = () => {
  if (isDevMode()) {
    _state.watch('system.status', (status) => {
      if (status === 'ready') (addModuleActionsToConsole(), addEasyAccessVariablesToConsole())
    });
  }
};
const addModuleActionsToConsole = () => {
  for (let [name, { actionName, moduleName }] of _state.actions.actions.entries()) {
    moduleName = globalThis.cognition.kebabToCamel(moduleName);
    globalThis[moduleName] ??= {};
    globalThis[moduleName][actionName] = (params = {}) => {
      return _state.actions
        .execute(name, params)
        .then(res => {
          console.log(`[Dev] ${moduleName}.${actionName} →`, res.result)
          return res.result;
        })
        .catch(err => console.error(`[Dev] ${moduleName}.${actionName} ✗`, err));
    }
  }
  console.log('[Dev] Created action shortcuts:', Array.from(_state.actions.actions.keys()));
};
const addEasyAccessVariablesToConsole = () => {
  globalThis.state = _state;
  globalThis.modules = modules;
  globalThis.printActions = () => _state.actions.prettyPrint();
  globalThis.printState = () => _state.getAll()
}