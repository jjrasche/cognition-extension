export const manifest = {
    name: "web-search",
    context: ["extension-page"],
    version: "1.0.0",
    description: "Web search via DuckDuckGo tab scraping",
    permissions: ["tabs", "scripting"],
    actions: ["getSearchResults", "getSearchTree"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const getSearchResults = async (query, maxResults = 5) => {
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    return runtime.call("tab.executeInTempTab", url, scrapeResultsInTab, [maxResults]);
};
export const getSearchTree = async (query, maxResults = 5) => {
    const results = await getSearchResults(query, maxResults);
    return {
        "search-container": { tag: "div", class: "search-results",
            "results-header": { tag: "h2", text: `Results for "${query}"` },
            ...createResultNodes(results)
        },
    };
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

const scrapeResultsInTab = (maxResults) => {
    const resultSelectors = [
        '[data-layout="organic"]',
        'article[data-nrn]', 
        'div[data-nrn]',
        '.result',
        '.web-result'
    ];
    let resultElements = [];
    for (const selector of resultSelectors) {
        resultElements = [...document.querySelectorAll(selector)];
        if (resultElements.length > 0) break;
    }
    
    const results = resultElements.slice(0, maxResults).map(el => {
        const title = el.querySelector('h2 a span')?.innerText?.trim() ||
                     el.querySelector('h2 a')?.innerText?.trim() ||
                     el.querySelector('h3 a')?.innerText?.trim() || '';
        
        const snippet = el.querySelector('[data-result="snippet"]')?.innerText?.trim() ||
                       el.querySelector('.result__snippet')?.innerText?.trim() || '';
        
        let url = el.querySelector('a')?.href || '';
        if (url.includes('duckduckgo.com/l/?')) {
            const match = url.match(/uddg=([^&]+)/);
            url = match ? decodeURIComponent(match[1]) : url;
        }
        
        return { title, url, snippet };
    }).filter(result => result.title && result.url);
    
    return results;
};