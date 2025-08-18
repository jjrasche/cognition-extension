export const manifest = {
    name: "web-search",
    context: ["service-worker"],
    version: "1.0.0",
    description: "Web search via DuckDuckGo tab scraping",
    permissions: ["tabs", "scripting"],
    actions: ["getSearchResults", "displaySearchResults"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const getSearchResults = async (query, maxResults = 5) => {
    let tab;
    try {
        runtime.log(`[WebSearch] Searching for: "${query}"`);
        tab = await chrome.tabs.create({ url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, active: false });
        if (!tab || !tab.id) throw new Error('Failed to create tab');
        await waitForTabComplete(tab.id);
        //    await new Promise(resolve => setTimeout(resolve, 3000));
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeResultsInTab, args: [maxResults] });
        //[0].result;
        await chrome.tabs.remove(tab.id);
        return results;
    } catch (error) { if (tab && tab.id) chrome.tabs.remove(tab.id).catch(() => { }); }
};
export const displaySearchResults = async (query, maxResults = 5) => {
    const searchResults = await getSearchResults(query, maxResults);
    await runtime.call('ui.renderTree', {
        "search-container": { tag: "div", class: "search-results",
            "results-header": { tag: "h2", text: `Results for "${query}"` },
            ...createResultNodes(searchResults.results)
        },
    });
};
const createResultNodes = (results) => Object.fromEntries(
    results.flatMap((result, i) => {
        const resultId = `result-${i}`;
        return [
            [resultId, { tag: "div", class: "search-result clickable", data: { url: result.url }, events: { click: "handleResultClick" } }],
            [`${resultId}-title`, { tag: "h3", text: result.title, parent: resultId, class: "result-title" }],
            [`${resultId}-snippet`, { tag: "p", text: result.snippet, parent: resultId, class: "result-snippet" }],
            [`${resultId}-url`, { tag: "small", text: result.url, parent: resultId, class: "result-url" }]
        ];
    })
);

function scrapeResultsInTab(maxResults) {
    const waitForResults = () => new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
            const results = document.querySelectorAll('[data-layout="organic"]');
            (results.length > 0 || attempts >= 30) ? resolve(results) : (attempts++, setTimeout(check, 100));
        };
        check();
    });

    return waitForResults().then(resultElements =>
        [...resultElements].slice(0, maxResults).map(el => {
            const title = el.querySelector('h2 a span')?.innerText?.trim() || el.querySelector('h2')?.innerText?.trim() || '';
            let url = el.querySelector('a')?.href || '';
            if (url.startsWith('?')) url = 'https://duckduckgo.com/' + url;
            const snippet = el.querySelector('[data-result="snippet"]')?.innerText?.trim() || '';
            return { title, url, snippet };
        }).filter(result => result.title && result.url)
    );
}

// const scrapeResultsInTab = async (maxResults) => {
//     const resultElements = await runtime.waitForCondition(() => document.querySelectorAll('[data-layout="organic"]').length > 0, { maxAttempts: 30, interval: 100 });
//     return [...resultElements].slice(0, maxResults).map(el => ({ title: getTitle(el), url: getUrl(el), snippet: getSnippet(el) }))
//         .filter(result => result.title && result.url);
// };
const getUrl = (el) => {
    let url = el.querySelector('a')?.href || '';
    return url.startsWith('?') ? 'https://duckduckgo.com/' + url : url;
};
const getTitle = (el) => el.querySelector('h2 a span')?.innerText?.trim() || el.querySelector('h2')?.innerText?.trim() || '';
const getSnippet = (el) => el.querySelector('[data-result="snippet"]')?.innerText?.trim() || '';
const waitForTabComplete = (tabId) => {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { reject(new Error('Tab load timeout')) }, 15000);
        const listener = (updatedTabId, changeInfo) => updatedTabId === tabId && changeInfo.status === 'complete' && complete()
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId).then(tab => tab.status === 'complete' && complete());
        const complete = () => (clearTimeout(timeout), chrome.tabs.onUpdated.removeListener(listener), resolve(null));
    });
};
