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

let _state = {}
export async function initialize(state, config) {
  _state = state;
  const isDevMode = () => !chrome.runtime.getManifest().update_url;
  await _state.write('system.dev', isDevMode());

  if (isDevMode()) {
    console.log('[Dev] Initializing development utilities');
    createActionShortcuts();
  }
}

const createActionShortcuts = () => {
    for (let [name, { actionName, moduleName }] of _state.actions.actions.entries()) {
      moduleName = globalThis.cognition.kebabToCamel(moduleName);
      globalThis[moduleName] ??= {};
      globalThis[moduleName][actionName] = (params) => _state.actions
          .execute(name, params)
          .then(res => console.log(`[Dev] ${moduleName}.${actionName} →`, res.result))
          .catch(err => console.error(`[Dev] ${moduleName}.${actionName} ✗`, err));
    }
    globalThis.state = _state;
    globalThis.printActions = () => _state.actions.prettyPrint();
    console.log('[Dev] Created action shortcuts:', Array.from(_state.actions.actions.keys()));
};