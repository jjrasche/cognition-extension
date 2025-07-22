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

const simplifyTab = (tab) => ({  id: tab.id,  url: tab.url,  title: tab.title,  windowId: tab.windowId,  status: tab.status,  index: tab.index, favIconUrl: tab.favIconUrl, incognito: tab.incognito, pinned: tab.pinned, audible: tab.audible, mutedInfo: tab.mutedInfo, openerTabId: tab.openerTabId, lastAccessed: tab.lastAccessed });
const getAllSimplifiedTabs = async () => (await chrome.tabs.query({})).map(simplifyTab);
const getCurrentSimplifiedTab = async () => simplifyTab((await chrome.tabs.query({ active: true, currentWindow: true }))[0]);

export async function initialize(state) {
  await state.write('tabs.all', await getAllSimplifiedTabs());
  const current = await getCurrentSimplifiedTab();
  if (current) await state.write('tabs.current', current);
  setupTabListeners(state);
}

const setupTabListeners = (state) => {
  chrome.tabs.onCreated.addListener((tab) => onTabCreated(state, tab));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => onTabUpdated(state, tabId, changeInfo, tab));
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => onTabRemoved(state, tabId, removeInfo));
  chrome.tabs.onActivated.addListener((activeInfo) => onTabActivated(state, activeInfo));
};

const onTabCreated = async (state, tab) => {
  const simplified = simplifyTab(tab);
  const allTabs = await state.read('tabs.all') || [];
  await state.write('tabs.all', [...allTabs, simplified]);
  await state.write('tabs.events', { type: 'created', tab: simplified, timestamp: Date.now() });
};

const onTabUpdated = async (state, tabId, changeInfo, tab) => {
  const simplified = simplifyTab(tab);
  const allTabs = await state.read('tabs.all') || [];
  const index = allTabs.find(t => t.id === tabId);
  if (index !== -1) {
    allTabs[index] = simplified;
    await state.write('tabs.all', allTabs);
  }
  if (tab.active) await state.write('tabs.current', simplified);
  await state.write('tabs.events', { type: 'updated', tab: simplified, changeInfo, timestamp: Date.now() });
};

const onTabRemoved = async (state, tabId, removeInfo) => {
  const allTabs = await state.read('tabs.all') || [];
  await state.write('tabs.all', allTabs.filter(t => t.id !== tabId));
  await state.write('tabs.events', { type: 'removed', tab: { id: tabId }, removeInfo, timestamp: Date.now() });
};

const onTabActivated = async (state, activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    const simplified = simplifyTab(tab);
    await state.write('tabs.current', simplified);
    await state.write('tabs.events', { type: 'activated', tab: simplified, timestamp: Date.now() });
  } catch (error) {
    console.error('[TabManager] Error handling tab activation:', error);
  }
};

export const getAllTabs = async (state) => await state.read('tabs.all') || [];

export const getCurrentTab = async (state) => {
  const current = await state.read('tabs.current');
  return current || await getCurrentSimplifiedTab();
};