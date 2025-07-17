export const manifest = {
  name: "contentHandler",
  description: "Handles content script registration and injection across browser tabs",
  version: "1.0.0",
  permissions: ["tabs", "scripting"],
  actions: ["register"],
};

const restrictedPatterns = [ 'chrome://', 'chrome-extension://', 'edge://', 'about:', 'file:///', 'view-source:', 'chrome-devtools://', 'moz-extension://', 'webkit-extension://', 'chrome-search://', 'chrome-native://'];
// tracks which modules registered for content script injection
let registrations = new Set();
const getRegistration = async (moduleName) => [...registrations].find(reg => reg.moduleName === moduleName) || (() => { throw new Error(`Module ${moduleName} not registered`); })();
const addRegistration = (moduleName, contentFunction, cssFunction, options) => registrations.add({ moduleName, content: contentFunction.toString(), css: cssFunction?.toString(), options });
// track which modules are injected into which tabs
let injectedTabIds = new Map();
const isInjected = (tabId, moduleName) => injectedTabIds.get(tabId) && (!moduleName || injectedTabIds.get(tabId).has(moduleName));
const addInjectedTabId = (tabId, moduleName) => injectedTabIds.set(tabId, (injectedTabIds.get(tabId) || new Set()).add(moduleName));

export async function initialize() {
  await injectContentIntoExistingTabs();
  await setupTabListeners();
}

// Set up tab lifecycle listeners
async function setupTabListeners() {
  newTabListener();
  tabNavigationListener();
  tabRemovedListener();
}
const newTabListener = () => chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id && shouldInjectIntoTab(tab)) {
    setTimeout(() => handleNewTab(tab.id), 100);
  }
});
const tabNavigationListener = () => chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && shouldInjectIntoTab(tab)) {
    await handleTabNavigation(tabId);
  }
});
const tabRemovedListener = () => chrome.tabs.onRemoved.addListener(async (tabId) => await removeTabFromInjected(tabId) );
const tab = async (tabId) => await chrome.tabs.get(tabId);
const tabs = async (query = {}) => await chrome.tabs.query(query);
const createNewTab = async () => await chrome.tabs.create({ url: 'about:blank' });
const getCurrentTab = async () => (await tabs({ active: true, currentWindow: true }))[0];
const newTabPattern = async (registration) => registration.options.pattern === 'new' ? (await createNewTab()).id : null;

const shouldInjectIntoTab = (tab) => (!tab || !tab.url) ? false : !restrictedPatterns.some(pattern => tab.url.startsWith(pattern));
const forAllValidTabs = async (operation) => {
  for (const tab of await tabs()) {
    if (shouldInjectIntoTab(tab)) await operation(tab);
  }
};
const injectAllPatternModules = async (tabId) => {
  for (const registration of registrations) {
    if (registration.options.pattern === 'all') await injectModuleScript(registration.moduleName, tabId);
  }
};
const injectContentIntoExistingTabs = async () => await forAllValidTabs((tab) => injectAllPatternModules(tab.id));
const handleNewTab = async (tabId) => await injectAllPatternModules(tabId);
const handleTabNavigation = async (tabId) => {
  await removeTabFromInjected(tabId);
  await injectAllPatternModules(tabId);
}
const removeTabFromInjected = async (tabId) => isInjected(tabId) && injectedTabIds.delete(tabId);

// register a new content script module
const defaultOptions = { pattern: 'all' };
const validatePattern = (pattern) => ensure(['all', 'current', 'new'].includes(pattern), 'Invalid pattern');
const validateModuleName = (moduleName) => ensure(moduleName, 'Module name is required');
const validateContentFunction = (contentFunction) => ensure(typeof contentFunction === 'function', 'Content function must be a function');
export async function register(state, params) {
  const { moduleName, contentFunction, cssFunction, options = { pattern: 'all' } } = params;
  validateModuleName(moduleName);
  validateContentFunction(contentFunction);
  validatePattern(options.pattern);
  addRegistration(moduleName, contentFunction, cssFunction, options);  
  await injectIntoAllTabs(moduleName);
  return { success: true, moduleName };
}

// Inject content scripts
const injectIntoAllTabs = async (moduleName) => await forAllValidTabs((tab) => injectModuleScript(moduleName, tab.id));
async function injectModuleScript(moduleName, tabId) {
  const registration = await getRegistration(moduleName);
  ensure(!isInjected(tabId, moduleName), `Module ${moduleName} already injected into tab ${tabId}`);
  try {
    if (!shouldInjectIntoTab(await tab(tabId))) return { success: false, error: 'Cannot inject into restricted tab' };
    await executeContentFunction(registration, tabId);
    if (registration.css) await executeCssFunction(registration, tabId);
    addInjectedTabId(tabId, moduleName);
    return { success: true };
  } catch (error) {
    console.error(`[ContentHandler] Failed to inject ${moduleName} into tab ${tabId}:`, error);
    return { success: false, error: error.message };
  }
}
const executeContentFunction = async (registration, tabId) => await chrome.scripting.executeScript({ 
  target: { tabId }, 
  func: deserializeFunction(registration.content),
  world: 'ISOLATED' });
const executeCssFunction = async (registration, tabId) => await chrome.scripting.insertCSS({ 
  target: { tabId }, 
  css: await deserializeFunction(registration.css)() });
// eslint-disable-next-line no-new-func
const deserializeFunction = (functionString) => new Function('return ' + functionString)();

const ensure = (condition, message) => condition || (() => { throw new Error(message); })();