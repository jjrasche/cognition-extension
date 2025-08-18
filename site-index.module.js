export const manifest = {
  name: "site-index",
  version: "1.0.0", 
  description: "Crawls and indexes entire websites into hierarchical content structures",
  permissions: ["storage"],
  actions: [ "indexWebsite" ],
};

export async function indexWebsite(params) {
  // params: { baseUrl, maxPages=50, maxDepth=3, includePatterns=[], excludePatterns=[] }
  // returns: { siteId, totalPages, hierarchy, estimatedTokens }
}