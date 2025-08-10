export const manifest = {
  name: "web-search",
  context: "service-worker",
  version: "1.0.0",
  description: "Web search via DuckDuckGo tab scraping",
  permissions: ["tabs", "scripting"],
  actions: ["searchWeb"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const searchWeb = async (params) => {
  const { query, maxResults = 5 } = params;
  let tabId = null;
  
  try {
    runtime.log(`[WebSearch] Searching for: "${query}"`);
    
    // Create hidden tab
    const tab = await chrome.tabs.create({
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
      active: false
    });
    tabId = tab.id;
    
    // Wait for tab to fully load
    await waitForTabComplete(tabId);
    
    // Give React time to render results
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Execute scraping script in the tab
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeResultsInTab,
      args: [maxResults]
    });
    
    // Clean up immediately
    await chrome.tabs.remove(tabId);
    tabId = null;
    
    const results = result.result;
    runtime.log(`[WebSearch] Found ${results.length} results`);
    
    return { 
      success: true, 
      results, 
      query, 
      timestamp: new Date().toISOString() 
    };
    
  } catch (error) {
    // Clean up tab on error
    if (tabId) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
    
    runtime.logError('[WebSearch] Search failed:', error);
    return { success: false, error: error.message, query };
  }
};

// Function that runs inside the DuckDuckGo tab - BACK TO WORKING VERSION
function scrapeResultsInTab(maxResults) {
  // Wait for results to appear (with timeout)
  const waitForResults = () => {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 30; // 3 seconds max
      
      const check = () => {
        const results = document.querySelectorAll('[data-layout="organic"]');
        
        if (results.length > 0 || attempts >= maxAttempts) {
          resolve(results);
        } else {
          attempts++;
          setTimeout(check, 100);
        }
      };
      
      check();
    });
  };
  
  // Execute the search - ORIGINAL WORKING LOGIC
  return waitForResults().then(resultElements => {
    return [...resultElements]
      .slice(0, maxResults)
      .map(el => {
        const title = el.querySelector('h2 a span')?.innerText?.trim() || 
                      el.querySelector('h2')?.innerText?.trim() || '';
        
        // Get the DuckDuckGo redirect URL - this is what we actually want!
        let url = el.querySelector('a')?.href || '';
        
        // If it's a relative URL, make it absolute
        if (url.startsWith('?')) {
          url = 'https://duckduckgo.com/' + url;
        }
        
        const snippet = el.querySelector('[data-result="snippet"]')?.innerText?.trim() || '';
        
        return { title, url, snippet };
      })
      .filter(result => result.title && result.url);
  });
}

// Wait for tab to complete loading
const waitForTabComplete = (tabId) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Tab load timeout'));
    }, 15000);
    
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    
    chrome.tabs.onUpdated.addListener(listener);
    
    // Check if already complete
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
};