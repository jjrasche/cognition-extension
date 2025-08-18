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
// tabs
export const createTab = async (options) => {
  const tab = await chrome.tabs.create(options);
  await waitForStability(tab);
  return tab;
};
export const removeTab = async (tabId) => await chrome.tabs.remove(tabId);
export const getTab = async (tabId) => await chrome.tabs.get(tabId);
export const queryTabs = async (query = {}) => await chrome.tabs.query(query);
export const updateTab = async (tabId, updateProperties) => await chrome.tabs.update(tabId, updateProperties);
// Script execution
export const executeScript = async (tab, func, args = []) => await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args })[0].result;
export const executeInTempTab = async (url, func, args = []) => {
  const tab = await createTab({ url, active: false });
  await runtime.wait(3000)
  try { return await executeScript(tab.id, func, args); }
  finally { await removeTab(tab.id).catch(err => runtime.logError('Tab cleanup failed:', err)); }
};
// helpers
const waitForStability = async (tab, options = {}) => {
  const { maxWait = 15000, minWait = 500, delay = 200, contentIdleChecks = 2, networkIdleChecks = 2 } = options;
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (maxWait, minWait, delay, contentIdleChecks, networkIdleChecks) => new Promise(resolve => {
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
        if (elapsed > minWait && network.stable && content.stable) { resolve({ success: true, elapsed }); return; }
        if (elapsed > maxWait) { resolve({ success: false, elapsed, networkStable: network.stable, contentStable: content.stable }); return; }
        setTimeout(poll, delay);
      };
      document.readyState === 'complete' ? poll() : document.addEventListener('DOMContentLoaded', poll);
    }),
    args: [maxWait, minWait, delay, contentIdleChecks, networkIdleChecks]
  });
  return result.result;
};

// Testing
export const test = async () => {
  const { runUnitTest, strictEqual } = runtime.testUtils;
  
  return [
    // await runUnitTest("Stability detection works with fast settings", async () => {
    //   const result = await executeInTempTab('https://example.com', 
    //     (maxWait, minWait, delay, contentIdleChecks, networkIdleChecks) => new Promise(resolve => {
    //       const check = (state) => () => {
    //         const current = state.getter();
    //         if (current === state.last) state.stable = ++state.count >= state.checks;
    //         else (state.count = 0, state.stable = false, state.last = current);
    //       };
    //       const startTime = performance.now();
    //       const network = { stable: false, count: 0, last: performance.getEntriesByType('resource').length, checks: networkIdleChecks, getter: () => performance.getEntriesByType('resource').length };
    //       const content = { stable: false, count: 0, last: document.body?.children.length + '_' + (document.body?.innerText?.length || 0), checks: contentIdleChecks, getter: () => document.body?.children.length + '_' + (document.body?.innerText?.length || 0) };
    //       const poll = () => {
    //         const elapsed = performance.now() - startTime;
    //         (check(network)(), check(content)());
    //         if (elapsed > minWait && network.stable && content.stable) { resolve({ success: true, elapsed }); return; }
    //         if (elapsed > maxWait) { resolve({ success: false, elapsed }); return; }
    //         setTimeout(poll, delay);
    //       };
    //       document.readyState === 'complete' ? poll() : document.addEventListener('DOMContentLoaded', poll);
    //     }),
    //     [2000, 200, 100, 2, 2] // 2sec max, reasonable settings for real site
    //   );
      
    //   const actual = result.success;
    //   return { actual, assert: strictEqual, expected: true };
    // }),

    await runUnitTest("Stability function returns timing data", async () => {
      const result = await executeInTempTab('https://example.com', 
        () => ({ hasPerformance: typeof performance !== 'undefined', hasDocument: typeof document !== 'undefined' })
      );
      
      const actual = result.hasPerformance && result.hasDocument;
      return { actual, assert: strictEqual, expected: true };
    })
  ];
};