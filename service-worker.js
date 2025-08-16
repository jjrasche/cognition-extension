import './dev-reload.js';
import { initializeRuntime } from "./runtime.js";
let runtime;
chrome.runtime.onInstalled.addListener(async () => { 
    try {
        await initializeOffscreenDocument();
        await initializeExtensionPage();
        runtime = await initializeRuntime('service-worker');
    } catch (error) {
        runtime.logError('Error initializing service worker:', error);
    }
});
const initializeOffscreenDocument = async () => await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['LOCAL_STORAGE'], justification: 'Run ML models that require full browser APIs' });
const initializeExtensionPage = async () => !(await extensionPageExists()) && await createExtensionPage();
const extensionPageExists = async () => {
    const storedTabId = await getExtensionPageTabId();
    if (storedTabId) {
        try { await chrome.tabs.get(storedTabId) } 
        catch (e) { await removeExtensionPageTabId(); return false; }
    }
    return !!storedTabId;
}

const createExtensionPage = async () => {
    const tab = await chrome.tabs.create({ url: 'extension-page.html', active: false });
    await setExtensionPageTabId(tab.id);
}
// chrome.tabs.onRemoved.addListener(async (tabId) => {
//     const storedTabId = await getExtensionPageTabId();
//     if (tabId === storedTabId) (await removeExtensionPageTabId(), await createExtensionPage());
// });

const getExtensionPageTabId = async () => (await chrome.storage.local.get(['extensionPageTabId'])).extensionPageTabId;
const removeExtensionPageTabId = async () => await chrome.storage.local.remove(['extensionPageTabId']);
const setExtensionPageTabId = async (tabId) => await chrome.storage.local.set({ extensionPageTabId: tabId });