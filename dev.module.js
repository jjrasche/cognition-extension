import { kebabToCamel } from './helpers.js';

export const manifest = {
  name: "dev",
  context: "service-worker",
  version: "1.0.0",
  description: "Development utilities and shortcuts for debugging",
  permissions: ["storage"],
  actions: [],
  dependencies: [], // No dependencies
};

let _runtime;

export async function initialize(runtime) {
  _runtime = runtime;
  console.log('[Dev] Initializing development helpers...');
  createActionShortcuts();
  console.log('[Dev] Development helpers ready');
}

const isDevMode = () => !chrome.runtime.getManifest().update_url;

const createActionShortcuts = () => {
  if (!isDevMode()) {
    console.log('[Dev] Production mode - skipping dev shortcuts');
    return;
  }
  
  addModuleActionsToConsole();
  addEasyAccessVariablesToConsole();
};

const addModuleActionsToConsole = () => {
  // Create shortcuts for all registered actions
  for (let [name] of _runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    const camelModuleName = kebabToCamel(moduleName);
    
    globalThis[camelModuleName] ??= {};
    globalThis[camelModuleName][actionName] = (params = {}) => {
      return _runtime.call(name, params)
        .then(res => {
          console.log(`[Dev] ${camelModuleName}.${actionName} →`, res);
          return res;
        })
        .catch(err => {
          console.error(`[Dev] ${camelModuleName}.${actionName} ✗`, err);
          throw err;
        });
    };
  }
  
  console.log('[Dev] Created action shortcuts:', Array.from(_runtime.getActions().keys()));
};

const addEasyAccessVariablesToConsole = () => {
  // Add runtime reference
  globalThis.runtime = _runtime;
  
  // Add module list
  globalThis.modules = _runtime.getModules();
  
  // Add pretty print functions
  globalThis.printActions = prettyPrintActions;
  globalThis.printModules = prettyPrintModules;
  globalThis.printModuleState = prettyPrintModuleState;
  // Add quick status check
  globalThis.printStatus = () => {
    console.log('=== Extension Status ===');
    console.log('Context:', _runtime.runtimeName);
    console.log('Loaded Modules:', _runtime.getModules().map(m => m.manifest.name));
    console.log('Module States:', Object.fromEntries(_runtime.moduleState));
    console.log('Registered Actions:', Array.from(_runtime.getActions().keys()).length);
    console.log('Errors:', _runtime.errors);
  };

  console.log('[Dev] Added global helpers: runtime, modules, printActions(), printModules(), printModuleState(), Status()');
};

const prettyPrintActions = () => {
  const actions = {};
  for (let [name] of _runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    actions[name] = { module: moduleName, action: actionName };
  }
  console.table(actions);
};

const prettyPrintModules = () => {
  const moduleInfo = _runtime.getModules().map(module => ({
    name: module.manifest.name,
    version: module.manifest.version,
    context: module.manifest.context || 'any',
    dependencies: (module.manifest.dependencies || []).join(', ') || 'none',
    actions: (module.manifest.actions || []).length
  }));
  console.table(moduleInfo);
};

const prettyPrintModuleState = () => {
  const states = {};
  for (let [name, state] of _runtime.moduleState.entries()) {
    states[name] = state;
  }
  console.table(states);
};