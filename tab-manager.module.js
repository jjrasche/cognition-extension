export const manifest = {
  name: "tab-manager",
  version: "1.0.0",
  description: "Single source of truth for browser tab state and events",
  permissions: ["tabs"],
  actions: ["getAllTabs", "getCurrentTab"],
  state: {
    reads: [],
    writes: ["tabs.all", "tabs.current", "tabs.events"]
  }
};

const restrictedPatterns = [ 'chrome://', 'chrome-extension://', 'edge://', 'about:', 'file:///', 'view-source:', 'chrome-devtools://', 'moz-extension://', 'webkit-extension://', 'chrome-search://', 'chrome-native://'];
const hasTabAndUrl = (tab) => !!(tab && tab.url);
const isNotAuthUrl = (tab) => !(tab.url.includes('oauth') || tab.url.includes('login') || tab.url.includes('auth'));
const isAllowedUrl = (tab) => !restrictedPatterns.some(pattern => tab.url.startsWith(pattern));
const isNotErrorPage = (tab) => !(tab.status === 'error' || tab.url.includes('chrome-error://'));
const trackableTab = (tab) => hasTabAndUrl(tab) && isAllowedUrl(tab) && isNotAuthUrl(tab) && isNotErrorPage(tab);

export const getAllTabs = async () => await _state.read('tabs.all') || [];
export const getCurrentTab = async () => await _state.read('tabs.current') || await getCurrentSimplifiedTab();
const simplifyTab = (tab) => ({  id: tab.id,  url: tab.url,  title: tab.title,  windowId: tab.windowId,  status: tab.status,  index: tab.index, favIconUrl: tab.favIconUrl, incognito: tab.incognito, pinned: tab.pinned, audible: tab.audible, mutedInfo: tab.mutedInfo, openerTabId: tab.openerTabId, lastAccessed: tab.lastAccessed });
const getSimplifiedTabs = async (query = {}) => (await chrome.tabs.query(query)).filter(trackableTab).map(simplifyTab);
const getCurrentSimplifiedTab = async () => {
  const tabs = await getSimplifiedTabs({ active: true, currentWindow: true });
  return tabs.length > 0 ? simplifyTab(tabs[0]) : null;
};

let _state;
export async function initialize(state) {
  _state = state;
  await _state.write('tabs.all', await getSimplifiedTabs());
  const current = await getCurrentSimplifiedTab();
  if (current) await _state.write('tabs.current', current);
  setupTabListeners();
}

const setupTabListeners = () => {
  chrome.tabs.onCreated.addListener((tab) => onTabCreated(tab));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => onTabUpdated(tabId, changeInfo, tab));
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => onTabRemoved(tabId, removeInfo));
  chrome.tabs.onActivated.addListener((activeInfo) => onTabActivated(activeInfo));
};

const onTabCreated = async (tab) => {
  if (!trackableTab(tab)) return;
  const simplified = simplifyTab(tab);
  const allTabs = await _state.read('tabs.all') || [];
  await _state.write('tabs.all', [...allTabs, simplified]);
  await _state.write('tabs.events', { type: 'created', tab: simplified, timestamp: Date.now() });
};

const onTabUpdated = async (tabId, changeInfo, tab) => {
  if (!trackableTab(tab)) return;
  const simplified = simplifyTab(tab);
  const allTabs = await _state.read('tabs.all') || [];
  const index = allTabs.find(t => t.id === tabId);
  if (index !== -1) {
    allTabs[index] = simplified;
    await _state.write('tabs.all', allTabs);
  }
  if (tab.active) await _state.write('tabs.current', simplified);
  await _state.write('tabs.events', { type: 'updated', tab: simplified, changeInfo, timestamp: Date.now() });
};

const onTabRemoved = async (tabId, removeInfo) => {
  const allTabs = await _state.read('tabs.all') || [];
  await _state.write('tabs.all', allTabs.filter(t => t.id !== tabId));
  await _state.write('tabs.events', { type: 'removed', tab: { id: tabId }, removeInfo, timestamp: Date.now() });
};

const onTabActivated = async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!trackableTab(tab)) return;
  const simplified = simplifyTab(tab);
  await _state.write('tabs.current', simplified);
  await _state.write('tabs.events', { type: 'activated', tab: simplified, timestamp: Date.now() });
};