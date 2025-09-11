import './dev-reload.js';
import { initializeRuntime } from "./runtime.js";

let runtime;

chrome.runtime.onInstalled.addListener(async () => {
	try {
		runtime = initializeRuntime('service-worker');
		// await initializeOffscreenDocument();
		// await initializeExtensionPage();
	} catch (error) {
		console.error('Error initializing service worker:', error);
	}
});

const initializeOffscreenDocument = async () =>
	await chrome.offscreen.createDocument({
		url: 'offscreen.html',
		reasons: ['LOCAL_STORAGE'],
		justification: 'Run ML models that require full browser APIs'
	});

const initializeExtensionPage = async () => !(await extensionPageExists()) && await createExtensionPage();

const extensionPageExists = async () => {
	const storedTabId = await getExtensionPageTabId();
	if (storedTabId) {
		try {
			await chrome.tabs.get(storedTabId);
			runtime.log("[service worker] Extension page exists");
			return true;
		} catch (e) {
			await removeExtensionPageTabId();
			runtime.log("[service worker] Extension page does not exist", e);
			return false;
		}
	}
	runtime.log("[service worker] Extension page does not exist");
	return false;
};

const createExtensionPage = async () => {
	runtime.log("[service worker] Creating extension page...");
	try {
		const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('extension-page.html'), active: false });
		runtime.log(`[service worker] Created extension page (tab ${tab.id})`);
		await setExtensionPageTabId(tab.id);
	} catch (error) {
		runtime.logError('Error creating extension page:', error);
	}
};

const getExtensionPageTabId = async () => {
	try {
		return await runtime.call("chrome-local.get", 'extensionPageTabId');
	} catch (error) {
		runtime.logError('Error getting extension page tab ID:', error);
		return undefined;
	}
};

const removeExtensionPageTabId = async () => {
	try {
		await runtime.call("chrome-local.remove", 'extensionPageTabId');
	} catch (error) {
		runtime.logError('Error removing extension page tab ID:', error);
	}
};

const setExtensionPageTabId = async (tabId) => {
	try {
		await runtime.call("chrome-local.set", { extensionPageTabId: tabId });
	} catch (error) {
		runtime.logError('Error setting extension page tab ID:', error);
	}
};