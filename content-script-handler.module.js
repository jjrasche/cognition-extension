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
// track which modules are injected into which tabs
const tabInjectionState = new Map()

let _state;
export async function initialize(state) {
  _state = state;
  await injectContentIntoExistingTabs();
  await setupTabListeners();
}

const setupTabListeners = async() => _state.watch('tabs.events', handleTabEvent);
const handleTabEvent = async (event) => {
  if (event.type === 'created') setTimeout(() => handleNewTab(event.tab), 100);
  else if (event.type === 'updated') await handleTabNavigation(event.tab);
  else if (event.type === 'removed') await removeTabFromInjected(event.tab);
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
const handleTabNavigation = async (tab) => {
  await removeTabFromInjected(tab);
  await injectAllPatternModules(tab);
}
const removeTabFromInjected = async (tab) => tabInjectionState.has(tab.id) && tabInjectionState.delete(tab.id);

// register a new content script module
const defaultOptions = { pattern: 'all' };
const validatePattern = (pattern) => ['all', 'current', 'new'].includes(pattern) || (() => { throw new Error('Invalid pattern'); })();
const validateModuleName = (moduleName) => moduleName || (() => { throw new Error('Module name is required'); })();
const validateContentFunction = (contentFunction) => typeof contentFunction === 'function' || (() => { throw new Error('Content function must be a function'); })();
export async function register(params) {
  const { moduleName, contentFunction, css, options = { pattern: 'all' } } = params;
  validateModuleName(moduleName);
  validateContentFunction(contentFunction);
  validatePattern(options.pattern);
  addRegistration(moduleName, contentFunction, css, options);
  
  if (options.pattern === 'all') {
    await injectIntoAllTabs(moduleName);
  } else if (options.pattern === 'current') {
    const currentTab = await _state.read('tabs.current');
    if (currentTab) await injectModuleScript(moduleName, currentTab);
  } else if (options.pattern === 'new') {
    await requestNewTab();
  }
  return { success: true, moduleName };
}

// Inject content scripts
const injectIntoAllTabs = async (moduleName) => await forAllValidTabs((tab) => injectModuleScript(moduleName, tab));
async function injectModuleScript(moduleName, tab) {
  try {
    const registration = getRegistration(moduleName);
    const tabState = tabInjectionState.get(tab.id) || {};
    if (!tabState.state)
      await insertState(tab);
    if (!tabState[moduleName]) {
      await insertContent(registration.contentFunction, tab);
      if (registration.css) await insertCSS(registration.css, tab);
    }
    tabInjectionState.set(tab.id, { ...tabState, state: true, [moduleName]: true});
    console.log(`[ContentHandler] Injected ${moduleName} into tab ${tab.title || tab.id}`);
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
const insertContent = async (contentFunction, tab) => await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: contentFunction, world: 'ISOLATED' });
const insertState = async (tab) => {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', files: ['./content-state.js'] });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', files: ['./content-state.js'] }); // enable access in dev console
}
const insertCSS = async (css, tab) => await chrome.scripting.insertCSS({ target: { tabId: tab.id }, css });