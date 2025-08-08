export const manifest = {
  name: "site-index",
  version: "1.0.0", 
  description: "Crawls and indexes entire websites into hierarchical content structures",
  permissions: ["storage"],
  actions: [
    "indexWebsite", 
    "getIndexedContent", 
    "searchIndexedContent",
    "getWebsiteHierarchy",
    "clearIndex"
  ],
  state: {
    reads: [],
    writes: [
      "indexer.sites", 
      "indexer.crawl.status", 
      "indexer.crawl.progress"
    ]
  }
};

// Main indexing function
export async function indexWebsite(params) {
  // params: { baseUrl, maxPages=50, maxDepth=3, includePatterns=[], excludePatterns=[] }
  // returns: { siteId, totalPages, hierarchy, estimatedTokens }
}

// Retrieve indexed content
export async function getIndexedContent(params) {
  // params: { siteId, format='hierarchical'|'flat'|'rag-chunks' }
  // returns: structured content in requested format
}

// Search within indexed content  
export async function searchIndexedContent(params) {
  // params: { siteId, query, maxResults=10 }
  // returns: ranked results with page URLs and content snippets
}

// Get site structure/navigation
export async function getWebsiteHierarchy(params) {
  // params: { siteId }
  // returns: { navigation, pageTree, linkStructure }
}

// Management
export async function clearIndex(params) {
  // params: { siteId } or {} for all
}