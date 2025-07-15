// oauth-manager.js - Centralized OAuth handling for all modules
// Handles redirect detection, deduplication, and routing to appropriate modules

export class OAuthManager {
  constructor() {
    this.handlers = new Map();
    this.processingCodes = new Set();
    this.pendingFlows = new Map();
    
    // Set up listeners
    this.setupListeners();
  }
  
  register(pattern, module, handler) {
    console.log(`[OAuthManager] Registered handler for ${module} with pattern: ${pattern}`);
    this.handlers.set(pattern, { module, handler });
  }
  
  async startFlow(module, authUrl, metadata = {}) {
    const flowId = crypto.randomUUID();
    
    this.pendingFlows.set(flowId, {
      module,
      startTime: Date.now(),
      metadata
    });
    
    // Clean up old flows after 10 minutes
    setTimeout(() => {
      this.pendingFlows.delete(flowId);
    }, 10 * 60 * 1000);
    
    console.log(`[OAuthManager] Starting OAuth flow ${flowId} for ${module}`);
    
    // Open auth window
    const authWindow = await chrome.windows.create({
      url: authUrl,
      type: 'popup',
      width: 600,
      height: 800,
      focused: true
    });
    
    // Store window ID with flow
    const flow = this.pendingFlows.get(flowId);
    if (flow) {
      flow.windowId = authWindow.id;
    }
    
    return flowId;
  }
  
  setupListeners() {
    // Primary listener - webNavigation API
    chrome.webNavigation.onBeforeNavigate.addListener(
      async (details) => {
        await this.handlePotentialRedirect(details.url, details.tabId, 'webNavigation');
      },
      { urls: ["<all_urls>"] }
    );
    
    // Backup listener - tabs API
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.url) {
        await this.handlePotentialRedirect(changeInfo.url, tabId, 'tabs.onUpdated');
      }
    });
    
    // Clean up when auth windows close
    chrome.windows.onRemoved.addListener((windowId) => {
      // Find and clean up any flows associated with this window
      for (const [flowId, flow] of this.pendingFlows) {
        if (flow.windowId === windowId) {
          console.log(`[OAuthManager] Auth window closed for flow ${flowId}`);
          this.pendingFlows.delete(flowId);
        }
      }
    });
  }
  
  async handlePotentialRedirect(urlString, tabId, source) {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      // Not a valid URL, ignore
      return;
    }
    
    // Check if this URL matches any registered patterns
    for (const [pattern, { module, handler }] of this.handlers) {
      if (urlString.startsWith(pattern)) {
        console.log(`[OAuthManager] [${source}] Potential OAuth redirect detected for ${module}: ${urlString}`);
        
        // Extract OAuth parameters
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');
        
        if (!code && !error) {
          // Not an OAuth callback
          continue;
        }
        
        // Handle errors
        if (error) {
          console.error(`[OAuthManager] OAuth error for ${module}: ${error} - ${errorDescription}`);
          
          try {
            await handler({
              error,
              errorDescription,
              state,
              url
            });
          } catch (err) {
            console.error(`[OAuthManager] Error handler failed for ${module}:`, err);
          }
          
          // Close the tab
          this.closeTab(tabId);
          return;
        }
        
        // Check if we're already processing this code
        if (this.processingCodes.has(code)) {
          console.log(`[OAuthManager] [${source}] Code already being processed, skipping`);
          return;
        }
        
        // Mark as processing
        this.processingCodes.add(code);
        
        try {
          console.log(`[OAuthManager] Processing OAuth callback for ${module}`);
          
          // Call the module's handler
          const result = await handler({
            code,
            state,
            url,
            tabId
          });
          
          if (result?.success) {
            console.log(`[OAuthManager] OAuth callback handled successfully for ${module}`);
            this.closeTab(tabId);
          } else {
            console.error(`[OAuthManager] OAuth handler returned failure for ${module}:`, result?.error);
          }
          
        } catch (error) {
          console.error(`[OAuthManager] OAuth handler error for ${module}:`, error);
        } finally {
          // Clean up processing code after a delay
          setTimeout(() => {
            this.processingCodes.delete(code);
          }, 5000);
        }
        
        // Found a match, don't check other patterns
        break;
      }
    }
  }
  
  closeTab(tabId) {
    setTimeout(() => {
      chrome.tabs.remove(tabId).catch(() => {
        // Tab might already be closed
        console.log(`[OAuthManager] Tab ${tabId} already closed`);
      });
    }, 100);
  }
  
  /**
   * Get pending flows for a module
   */
  getPendingFlows(module) {
    const flows = [];
    for (const [flowId, flow] of this.pendingFlows) {
      if (flow.module === module) {
        flows.push({ flowId, ...flow });
      }
    }
    return flows;
  }
  
  /**
   * Cancel a pending flow
   */
  cancelFlow(flowId) {
    const flow = this.pendingFlows.get(flowId);
    if (flow) {
      this.pendingFlows.delete(flowId);
      
      // Close the window if it exists
      if (flow.windowId) {
        chrome.windows.remove(flow.windowId).catch(() => {
          // Window might already be closed
        });
      }
      
      console.log(`[OAuthManager] Cancelled flow ${flowId}`);
      return true;
    }
    return false;
  }
}