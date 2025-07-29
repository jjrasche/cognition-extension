export const manifest = {
  name: "content-script-handler",
  description: "Handles content script registration and injection across browser tabs",
  version: "1.0.0",
  permissions: ["tabs", "scripting", "activeTab"],
  actions: ["register"],
};

// tracks which modules registered for content script injection
const registrations = new Set();
const getRegistration = (moduleName) => [...registrations].find(reg => reg.moduleName === moduleName) || (() => { throw new Error(`Module ${moduleName} not registered`); })();
const addRegistration = (moduleName, contentFunction, css, options) => registrations.add({ moduleName, contentFunction, css, options });

let _state;
export async function initialize(state) {
  _state = state;
  await injectContentIntoExistingTabs();
  await setupTabListeners();
}

const setupTabListeners = async() => _state.watch('tabs.events', handleTabEvent);
const handleTabEvent = async (event) => {
  if (event.changeInfo?.status !== "complete") return;
  if (event.type === 'created') setTimeout(() => handleNewTab(event.tab), 100);
  else if (event.type === 'updated') await handleTabNavigation(event);
};
const requestNewTab = async () => await _state.write('tabs.createRequest', { url: 'about:blank', timestamp: Date.now() });


const forAllValidTabs = async (operation) => {
  const tabs = await _state.read('tabs.all') || [];
  for (const tab of tabs) {
    await operation(tab);
  }
};
const injectAllPatternModules = async (tab) => {
  for (const registration of registrations) {
    if (registration.options.pattern === 'all') await injectModuleScript(registration.moduleName, tab);
  }
};
const injectContentIntoExistingTabs = async () => await forAllValidTabs((tab) => injectAllPatternModules(tab));
const handleNewTab = async (tab) => await injectAllPatternModules(tab);
const handleTabNavigation = async (event) => await injectAllPatternModules(event.tab);

// register a new content script module
const defaultOptions = { pattern: 'all' };
const validatePattern = (pattern) => ['all', 'current', 'new'].includes(pattern) || (() => { throw new Error('Invalid pattern'); })();
const validateModuleName = (moduleName) => moduleName || (() => { throw new Error('Module name is required'); })();
const validateContentFunction = (contentFunction) => typeof contentFunction === 'function' || (() => { throw new Error('Content function must be a function'); })();
export async function register(module) {
  const {contentFunction, css, options = { pattern: 'all' } } = module.contentScript;
  const moduleName = module.manifest.name;
  validateModuleName(moduleName);
  validateContentFunction(contentFunction);
  validatePattern(options.pattern);
  addRegistration(moduleName, contentFunction, css, options);
  
  if (options.pattern === 'all') await injectIntoAllTabs(moduleName);
  else if (options.pattern === 'current') {
    const currentTab = await _state.read('tabs.current');
    if (currentTab) await injectModuleScript(moduleName, currentTab);
  } else if (options.pattern === 'new') await requestNewTab();
  return { success: true, moduleName };
}

// Inject content scripts
const injectIntoAllTabs = async (moduleName) => await forAllValidTabs((tab) => injectModuleScript(moduleName, tab));
async function injectModuleScript(moduleName, tab) {
  try {
    const registration = getRegistration(moduleName);
    const [stateLoaded, moduleLoaded] = await Promise.all([(await ModuleLoadedInDOM(manifest.name, tab)), (await ModuleLoadedInDOM(moduleName, tab))]);
    if (!stateLoaded) await insertState(tab);
    if (!moduleLoaded) {
      await insertContent(registration.contentFunction, tab);
      if (registration.css) await insertCSS(registration.css, tab);
    }
    if (!stateLoaded || !moduleLoaded) console.log(`[ContentHandler] Injecting ${moduleName} into tab ${tab.title || tab.id} ${stateLoaded ? '' : '(state)'}${moduleLoaded ? '' : '(module)'}`);
    // else console.log(`[ContentHandler] ${moduleName} already loaded in tab ${tab.title || tab.id}`);
    return { success: true };
  } catch (error) {
    if (error.message.includes('Cannot access contents')) {
      console.log(`[ContentHandler] Cannot inject into ${tab.url} (CSP/permissions)`);
      return { success: false, error: 'Blocked by site policy', silent: true };
    }
    console.error(`[ContentHandler] Failed to inject ${moduleName} into tab ${tab.title || tab.id}:`, error);
    return { success: false, error: error.message };
  }
}
const world = 'MAIN'; // use MAIN to debug in devtools
const insertContent = async (contentFunction, tab) => { await chrome.scripting.executeScript({ target: { tabId: tab.id }, world, func: contentFunction }); }
const insertState = async (tab) => await chrome.scripting.executeScript({ target: { tabId: tab.id }, world, files: ['./content-state.js'] });
const insertCSS = async (css, tab) => await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css });
const getExtensionObject = async (tab) => await chrome.scripting.executeScript({ target: { tabId: tab.id }, world, func: () => window.__Cognition })
const ModuleLoadedInDOM  = async (moduleName, tab) => {
  try {return (await getExtensionObject(tab))[0].result[moduleName] }
  catch(error) { return false; }
};