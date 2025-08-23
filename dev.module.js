import { kebabToCamel } from './helpers.js';

export const manifest = {
  name: "dev",
  context: ["service-worker", "extension-page", "offscreen"],
  version: "1.0.0",
  description: "Development utilities and shortcuts for debugging",
  permissions: ["storage"],
  actions: ["testEmbeddingSpeed", "updateSuperintendentData", "testModules", "testSegmenterCompleteness"],
  // dependencies: ["file"]//, "inference", "transformer", "embedding"]
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
  addModuleManifestsToConsole();
  addModuleActionsToConsole();
  addEasyAccessVariablesToConsole();
};
const addModuleManifestsToConsole = () => runtime.getContextModules().forEach(module => {
  const camelModuleName = kebabToCamel(module.manifest.name);
  globalThis[camelModuleName] = {};
  globalThis[camelModuleName].manifest = module.manifest;
});

const addModuleActionsToConsole = () => {
  for (let [name] of runtime.getActions().entries()) {
    const [moduleName, actionName] = name.split('.');
    const camelModuleName = kebabToCamel(moduleName);
    globalThis[camelModuleName] ??= {};
    globalThis[camelModuleName][actionName] = (...args) => {
      return runtime.call(name, ...args)
        .then(res => (runtime.log(`[Dev] ${camelModuleName}.${actionName} →`, res), res))
        .catch(err => (runtime.logError(`[Dev] ${camelModuleName}.${actionName} ✗`, err), Promise.reject(err)));
    };
  }
};

const addEasyAccessVariablesToConsole = () => {
  // Add runtime reference
  globalThis.runtime = runtime;  
  // Add pretty print functions
  globalThis.printActions = prettyPrintActions;
  globalThis.printModules = prettyPrintModules;
  globalThis.printModuleState = prettyPrintModuleState;
  // Add quick status check
  globalThis.printStatus = () => {
    runtime.log('=== Extension Status ===');
    runtime.log('Context:', runtime.runtimeName);
    runtime.log('Loaded Modules:', runtime.getContextModules().map(m => m.manifest.name));
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
  const moduleInfo = runtime.getContextModules().map(module => ({
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
      await runtime.call('embedding.embedText', text, modelName);
      times.push(performance.now() - start);
    }
    const avgDuration = Math.round(times.reduce((sum, time) => sum + time, 0) / runs);
    results.push({ modelName, avgDuration });
  }
  
  const sorted = results.sort((a, b) => a.avgDuration - b.avgDuration);
  console.table(sorted);
  return sorted;
}




// Test if Intl.Segmenter can detect sentence completeness without punctuation

const testCases = [
  // Complete sentences without punctuation
  { text: "I went to the store today", expected: "complete", reason: "Complete thought with subject, verb, object" },
  { text: "The weather is really nice", expected: "complete", reason: "Complete descriptive statement" },
  { text: "She finished her homework early", expected: "complete", reason: "Complete action statement" },
  
  // Incomplete fragments
  { text: "When I was", expected: "incomplete", reason: "Subordinate clause without main clause" },
  { text: "Because the rain", expected: "incomplete", reason: "Dependent clause fragment" },
  { text: "After we went to", expected: "incomplete", reason: "Prepositional phrase fragment" },
  
  // Tricky cases
  { text: "Well I think", expected: "incomplete", reason: "Trailing incomplete thought" },
  { text: "So anyway", expected: "incomplete", reason: "Connector without content" },
  { text: "The thing is", expected: "incomplete", reason: "Incomplete explanation setup" }
];

export const testSegmenterCompleteness = () => {
  console.log("🧪 Testing Intl.Segmenter for sentence completeness detection\n");
  
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
  
  testCases.forEach((testCase, index) => {
    const segments = Array.from(segmenter.segment(testCase.text));
    
    console.log(`Test ${index + 1}: "${testCase.text}"`);
    console.log(`Expected: ${testCase.expected}`);
    console.log(`Segments found: ${segments.length}`);
    console.log(`Segments:`, segments.map(s => `"${s.segment}"`));
    
    // Segmenter's logic: if it creates a sentence segment, it thinks it's complete
    const segmenterThinks = segments.length > 0 && segments[0].segment.trim() === testCase.text ? "complete" : "incomplete";
    
    console.log(`Segmenter thinks: ${segmenterThinks}`);
    console.log(`Match: ${segmenterThinks === testCase.expected ? '✅' : '❌'}`);
    console.log(`Reason: ${testCase.reason}\n`);
  });
  
  // Test with punctuation for comparison
  console.log("🔍 Comparison with punctuation:");
  const withPunctuation = "I went to the store today.";
  const segments = Array.from(segmenter.segment(withPunctuation));
  console.log(`"${withPunctuation}" → ${segments.length} segments`);
  console.log(`Segments:`, segments.map(s => `"${s.segment}"`));
};

// Run the test
testSegmenterCompleteness();