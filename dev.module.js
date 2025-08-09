import { kebabToCamel } from './helpers.js';

export const manifest = {
  name: "dev",
  context: ["service-worker", "extension-page", "offscreen"],
  version: "1.0.0",
  description: "Development utilities and shortcuts for debugging",
  permissions: ["storage"],
  actions: ["testEmbeddingSpeed"],
  dependencies: []
};

let runtime;
export async function initialize(rt) {
  runtime = rt;
  runtime.log('[Dev] Initializing development helpers...');
  createActionShortcuts();
  runtime.log('[Dev] Development helpers ready');
}

const isDevMode = () => runtime.runtimeName == "offscreen" || !chrome.runtime.getManifest().update_url;

const createActionShortcuts = () => {
  if (!isDevMode()) {
    runtime.log('[Dev] Production mode - skipping dev shortcuts');
    return;
  }
  
  addModuleActionsToConsole();
  addEasyAccessVariablesToConsole();
};

const addModuleActionsToConsole = () => {
  // Create shortcuts for all registered actions
  for (let [name] of runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    const camelModuleName = kebabToCamel(moduleName);
    
    globalThis[camelModuleName] ??= {};
    globalThis[camelModuleName][actionName] = (params = {}) => {
      return runtime.call(name, params)
        .then(res => (runtime.log(`[Dev] ${camelModuleName}.${actionName} →`, res), res))
        .catch(err => (runtime.logError(`[Dev] ${camelModuleName}.${actionName} ✗`, err), Promise.reject(err)));
    };
  }
  
  runtime.log('[Dev] Created action shortcuts:', Array.from(runtime.getActions().keys()));
};

const addEasyAccessVariablesToConsole = () => {
  // Add runtime reference
  globalThis.runtime = runtime;
  
  // Add module list
  globalThis.modules = runtime.getModules();
  
  // Add pretty print functions
  globalThis.printActions = prettyPrintActions;
  globalThis.printModules = prettyPrintModules;
  globalThis.printModuleState = prettyPrintModuleState;
  // Add quick status check
  globalThis.printStatus = () => {
    runtime.log('=== Extension Status ===');
    runtime.log('Context:', runtime.runtimeName);
    runtime.log('Loaded Modules:', runtime.getModules().map(m => m.manifest.name));
    runtime.log('Module States:', Object.fromEntries(runtime.moduleState));
    runtime.log('Registered Actions:', Array.from(runtime.getActions().keys()).length);
    runtime.log('Errors:', runtime.errors);
  };
  runtime.log('[Dev] Added global helpers: runtime, modules, printActions(), printModules(), printModuleState(), Status()');
};

const prettyPrintActions = () => {
  const actions = {};
  for (let [name] of runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    actions[name] = { module: moduleName, action: actionName };
  }
  console.table(actions);
};

const prettyPrintModules = () => {
  const moduleInfo = runtime.getModules().map(module => ({
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
  for (let [name, state] of runtime.moduleState.entries()) {
    states[name] = state;
  }
  console.table(states);
};

export const testEmbeddingSpeed = async (text, runs = 10) => {
  const models = await runtime.call('transformer.listModels');
  
  const results = [];
  for (const modelName of models) {
    const times = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await runtime.call('embedding.embedText', { text, modelName });
      times.push(performance.now() - start);
    }
    const avgDuration = Math.round(times.reduce((sum, time) => sum + time, 0) / runs);
    results.push({ modelName, avgDuration });
  }
  
  const sorted = results.sort((a, b) => a.avgDuration - b.avgDuration);
  console.table(sorted);
  return sorted;
}