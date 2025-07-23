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
    for (const [name, action] of _state.actions.actions.entries()) {
    if (!globalThis[action.metadata.module]) globalThis[action.metadata.module] = {};
    const actionName = name.split('.').pop();
    globalThis[action.metadata.module][actionName] = (params) => _state.actions.execute(name, params);
    }
    globalThis.state = _state;
    globalThis.printActions = () => _state.actions.readableList();
    console.log('[Dev] Created action shortcuts:', Array.from(_state.actions.actions.keys()));
};