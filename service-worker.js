import './dev-reload.js';
import { initializeRuntime } from "./runtime.js";

let runtime, log;

chrome.runtime.onInstalled.addListener(async () => {
	try {
		runtime = initializeRuntime('service-worker');
		await initializeOffscreenDocument();
		await initializeExtensionPage();
	} catch (error) {
		runtime.error('Error initializing service worker:', error);
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
			return true;
		} catch (e) {
			await removeExtensionPageTabId();
			return false;
		}
	}
	return false;
};

const createExtensionPage = async () => {
	try {
		const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('extension-page.html'), active: false });
		await setExtensionPageTabId(tab.id);
	} catch (error) {
	}
};

const getExtensionPageTabId = async () => {
	try {
		return await runtime.call("chrome-local.get", 'extensionPageTabId');
	} catch (error) {
		return undefined;
	}
};

const removeExtensionPageTabId = async () => {
	try {
		await runtime.call("chrome-local.remove", 'extensionPageTabId');
	} catch (error) {
	}
};

const setExtensionPageTabId = async (tabId) => {
	try {
		await runtime.call("chrome-local.set", { extensionPageTabId: tabId });
	} catch (error) {
	}
};