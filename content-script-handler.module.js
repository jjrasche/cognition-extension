export const manifest = {
  name: "contentHandler",
  description: "Handles content script registration and injection across browser tabs",
  version: "1.0.0",
  permissions: ["tabs", "scripting", "activeTab"],
  actions: ["register"],
};

const restrictedPatterns = [ 'chrome://', 'chrome-extension://', 'edge://', 'about:', 'file:///', 'view-source:', 'chrome-devtools://', 'moz-extension://', 'webkit-extension://', 'chrome-search://', 'chrome-native://'];
// tracks which modules registered for content script injection
let registrations = new Set();
const getRegistration = async (moduleName) => [...registrations].find(reg => reg.moduleName === moduleName) || (() => { throw new Error(`Module ${moduleName} not registered`); })();
const addRegistration = (moduleName, contentFunction, css, options) => registrations.add({ moduleName, contentFunction, css, options });
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

const hasTabAndUrl = (tab) => logAndReturn(!!(tab && tab.url), '❌ No tab or URL:', tab);
const isAllowedUrl = (tab) => logAndReturn(!restrictedPatterns.some(pattern => tab.url.startsWith(pattern)), '❌ Restricted URL:', tab);
const isNotAuthUrl = (tab) => logAndReturn(!(tab.url.includes('oauth') || tab.url.includes('login') || tab.url.includes('auth')), '❌ Auth URL:', tab);
const isNotErrorPage = (tab) => logAndReturn(!(tab.status === 'error' || tab.url.includes('chrome-error://')), '❌ Error page:', tab);
const shouldInjectIntoTab = (tab) => hasTabAndUrl(tab) 
  && isAllowedUrl(tab)
  && isNotAuthUrl(tab)
  && isNotErrorPage(tab)
  && (debugLog('✅ Valid tab for injection:', tab.url), true);

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
  const { moduleName, contentFunction, css, options = { pattern: 'all' } } = params;
  validateModuleName(moduleName);
  validateContentFunction(contentFunction);
  validatePattern(options.pattern);
  addRegistration(moduleName, contentFunction, css, options);
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
    await insertState(tabId);
    await insertContent(registration.contentFunction, tabId);
    if (registration.css) await insertCSS(registration.css, tabId);
    addInjectedTabId(tabId, moduleName);
    return { success: true };
  } catch (error) {
    console.error(`[ContentHandler] Failed to inject ${moduleName} into tab ${tabId}:`, error);
    return { success: false, error: error.message };
  }
}
const insertContent = async (contentFunction, tabId) => await chrome.scripting.executeScript({ target: { tabId }, func: contentFunction, world: 'ISOLATED' });
const insertState = async (tabId) => await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', files: ['./content-state.js'] });
const insertCSS = async (css, tabId) => await chrome.scripting.insertCSS({ target: { tabId }, css });
const ensure = (condition, message) => condition || (() => { throw new Error(message); })();
const debugLog = (message, ...args) => null//console.log('[ContentHandler]', message, ...args);
const logAndReturn = (condition, message, tab) => { if (!condition) debugLog(message, tab.url || tab); return condition; };