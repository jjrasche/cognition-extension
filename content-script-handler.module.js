export const manifest = {
  name: "content-script-handler",
  description: "Handles content script registration and injection across browser tabs",
  version: "1.0.0",
  permissions: ["tabs", "scripting", "activeTab"],
  actions: ["register"],
};

const restrictedPatterns = [ 'chrome://', 'chrome-extension://', 'edge://', 'about:', 'file:///', 'view-source:', 'chrome-devtools://', 'moz-extension://', 'webkit-extension://', 'chrome-search://', 'chrome-native://'];
// tracks which modules registered for content script injection
const registrations = new Set();
const getRegistration = (moduleName) => [...registrations].find(reg => reg.moduleName === moduleName) || (() => { throw new Error(`Module ${moduleName} not registered`); })();
const addRegistration = (moduleName, contentFunction, css, options) => registrations.add({ moduleName, contentFunction, css, options });
// track which modules are injected into which tabs
const tabInjectionState = new Map()

export async function initialize(state) {
  await injectContentIntoExistingTabs(state);
  await setupTabListeners(state);
}

// Set up tab state listeners
async function setupTabListeners(state) {
  state.watch('tabs.events', handleTabEvent);
}
const handleTabEvent = async (event) => {
  if (event.type === 'created' && shouldInjectIntoTab(event.tab)) {
    setTimeout(() => handleNewTab(event.tab), 100);
  } else if (event.type === 'updated' && shouldInjectIntoTab(event.tab)) {
    await handleTabNavigation(event.tab);
  } else if (event.type === 'removed') {
    await removeTabFromInjected(event.tab);
  }
};
const requestNewTab = async (state) => await state.write('tabs.createRequest', { url: 'about:blank', timestamp: Date.now() });

const hasTabAndUrl = (tab) => !!(tab && tab.url);
const isAllowedUrl = (tab) => !restrictedPatterns.some(pattern => tab.url.startsWith(pattern));
const isNotAuthUrl = (tab) => !(tab.url.includes('oauth') || tab.url.includes('login') || tab.url.includes('auth'));
const isNotErrorPage = (tab) => !(tab.status === 'error' || tab.url.includes('chrome-error://'));
const shouldInjectIntoTab = (tab) => hasTabAndUrl(tab) 
  && isAllowedUrl(tab)
  && isNotAuthUrl(tab)
  && isNotErrorPage(tab);

const forAllValidTabs = async (state, operation) => {
  const tabs = await state.read('tabs.all') || [];
  for (const tab of tabs) {
    if (shouldInjectIntoTab(tab)) await operation(tab);
  }
};
const injectAllPatternModules = async (tab) => {
  for (const registration of registrations) {
    if (registration.options.pattern === 'all') await injectModuleScript(registration.moduleName, tab);
  }
};
const injectContentIntoExistingTabs = async (state) => await forAllValidTabs(state, (tab) => injectAllPatternModules(tab));
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
export async function register(state, params) {
  const { moduleName, contentFunction, css, options = { pattern: 'all' } } = params;
  validateModuleName(moduleName);
  validateContentFunction(contentFunction);
  validatePattern(options.pattern);
  addRegistration(moduleName, contentFunction, css, options);
  
  if (options.pattern === 'all') {
    await injectIntoAllTabs(state, moduleName);
  } else if (options.pattern === 'current') {
    const currentTab = await state.read('tabs.current');
    if (currentTab) await injectModuleScript(moduleName, currentTab);
  } else if (options.pattern === 'new') {
    await requestNewTab(state);
  }
  
  return { success: true, moduleName };
}

// Inject content scripts
const injectIntoAllTabs = async (state, moduleName) => await forAllValidTabs(state, (tab) => injectModuleScript(moduleName, tab));
async function injectModuleScript(moduleName, tab) {
  if (!shouldInjectIntoTab(tab)) return { success: false, error: 'Cannot inject into restricted tab' };
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