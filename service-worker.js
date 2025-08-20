import './dev-reload.js';
import { initializeRuntime } from "./runtime.js";
let runtime;
chrome.runtime.onInstalled.addListener(() => { 
    try {
        initializeOffscreenDocument();
        runtime = initializeRuntime('service-worker');
        initializeExtensionPage();
    } catch (error) {
        runtime.logError('Error initializing service worker:', error);
    }
});``
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
    const tab = await runtime.call('tab.create', { url: 'extension-page.html', active: false }).catch(error => {
        runtime.logError('Error creating extension page:', error);
    });
    await setExtensionPageTabId(tab.id);
}
// chrome.tabs.onRemoved.addListener(async (tabId) => {
//     const storedTabId = await getExtensionPageTabId();
//     if (tabId === storedTabId) (await removeExtensionPageTabId(), await createExtensionPage());
// });
const getExtensionPageTabId = async () => (await runtime.call("chrome-local.get", 'extensionPageTabId'))
    .catch(error => runtime.logError('Error getting extension page tab ID:', error))
    .extensionPageTabId;
const removeExtensionPageTabId = async () => await runtime.call("chrome-local.remove", 'extensionPageTabId');
const setExtensionPageTabId = async (tabId) => (await runtime.call("chrome-local.set", { extensionPageTabId: tabId }))
    .catch(error => runtime.logError('Error setting extension page tab ID:', error));