export const manifest = {
	name: "tab",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Centralized Chrome tabs API operations with automatic stability waiting",
	permissions: ["tabs", "scripting"],
	actions: ["createTab", "removeTab", "updateTab", "getTab", "queryTabs", "executeScript", "executeInTempTab"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const createTab = async (options) => {
	const tab = await chrome.tabs.create(options);
	await waitForTabComplete(tab);
	await waitForTabStable(tab);
	return tab;
};
export const removeTab = async (tabId) => await chrome.tabs.remove(tabId);
export const getTab = async (tabId) => await chrome.tabs.get(tabId);
export const queryTabs = async (query = {}) => await chrome.tabs.query(query);
export const updateTab = async (tabId, updateProperties) => await chrome.tabs.update(tabId, updateProperties);
// Script execution
export const executeScript = async (tab, func, args = []) => {
	const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
	runtime.log(`[Tab] Script executed in tab ${tab.id}`, JSON.stringify(result, null, 2));
	return result[0].result;
}
export const executeInTempTab = async (url, func, args = []) => {
	const tab = await createTab({ url, active: true });
	try { return await executeScript(tab, func, args) }
	catch (error) {
		runtime.logError(`[Tab] Error executing script in temp tab ${tab.id}:`, error);
		throw error;
	}
	finally {
		// await removeTab(tab.id).catch(err => runtime.logError('Tab cleanup failed:', err));
	}
};
// helpers
const waitForTabStable = async (tab, options = {}) => {
	const { maxWait = 15000, minWait = 100, delay = 50, contentIdleChecks = 3, networkIdleChecks = 3 } = options;
	return await executeScript(tab,
		(maxWait, minWait, delay, contentIdleChecks, networkIdleChecks) => new Promise(resolve => {
			const check = (state) => () => {
				const current = state.getter();
				if (current === state.last) state.stable = ++state.count >= state.checks;
				else (state.count = 0, state.stable = false, state.last = current);
			};
			const startTime = performance.now();
			const network = { stable: false, count: 0, last: performance.getEntriesByType('resource').length, checks: networkIdleChecks, getter: () => performance.getEntriesByType('resource').length };
			const content = { stable: false, count: 0, last: document.body?.children.length + '_' + (document.body?.innerText?.length || 0), checks: contentIdleChecks, getter: () => document.body?.children.length + '_' + (document.body?.innerText?.length || 0) };
			const poll = () => {
				const elapsed = performance.now() - startTime;
				(check(network)(), check(content)());
				chrome.runtime.sendMessage({ type: 'TAB_STABILITY', data: {  elapsed: Math.round(elapsed),  networkStable: network.stable,  contentStable: content.stable, url: window.location.hostname } }).catch(() => {}); // Ignore errors if extension context is gone
				if (elapsed > minWait && network.stable && content.stable) { resolve({ success: true, elapsed }); return; }
				if (elapsed > maxWait) { resolve({ success: false, elapsed, networkStable: network.stable, contentStable: content.stable }); return; }
				setTimeout(poll, delay);
			};
			document.readyState === 'complete' ? poll() : document.addEventListener('DOMContentLoaded', poll);
		}),
		[maxWait, minWait, delay, contentIdleChecks, networkIdleChecks]
	);
};

const waitForTabComplete = (tab) => {
	return new Promise((resolve) => {
		const listener = (updatedTabId, changeInfo) => (updatedTabId === tab.id) && handleComplete(changeInfo.status);
		chrome.tabs.onUpdated.addListener(listener);
		chrome.tabs.get(tab.id).then(tab => handleComplete(tab.status));
		const handleComplete = (status) => {
			if (status === 'complete') {
				chrome.tabs.onUpdated.removeListener(listener);
				resolve(true);
			}
		};
	});
};
// Testing: having hard time getting to
// export const test = async () => {
// 	const { runUnitTest, strictEqual } = runtime.testUtils;
// 	const makeBlobUrl = (html) => URL.createObjectURL(new Blob([html], { type: 'text/html' }));
// 	return [
// 		await runUnitTest("Data URL basic test", async () => {
// 			// can't work in V3
// 			// const result = await executeInTempTab(makeBlobUrl("<html><body><h1>Test Page</h1><p>Hello World</p></body></html>"), () => {
// 			// 	return {
// 			// 		title: document.querySelector('h1')?.textContent,
// 			// 		paragraph: document.querySelector('p')?.textContent,
// 			// 		url: window.location.href
// 			// 	};
// 			// });
// 			const result = await executeInTempTab('https://httpbin.org/delay/5', () => ({ hasH1: !!document.querySelector('h1'), title: document.title, loaded: document.readyState === 'complete' }));
// 			debugger;
// 			const actual = result.hasH1 && result.loaded;
// 			return { actual, assert: strictEqual, expected: true };
// 		}),
// 	];
// };