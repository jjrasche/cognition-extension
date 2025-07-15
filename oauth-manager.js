// oauth-manager.js - Complete OAuth handling for all modules
const url = 'https://chromiumapp.org/'; 
export class OAuthManager {
  constructor() {
    this.providers = new Map();
    this.tokens = new Map();
    this.refreshPromises = new Map();
    this.setupListeners();
  }
  
  register(provider, config) {
    this.verifyConfig(config);
    this.providers.set(provider, config);
    this.loadStoredTokens(provider);
    console.log(`[OAuthManager] Registered ${provider} with scopes:`, config.scopes);
  }

  verifyConfig(config) {
    if (!config.provider || !config.clientId || !config.authUrl || !config.tokenUrl) 
      throw new Error(`Invalid OAuth config for ${config.provider}`);
  }

  async getToken(provider) {
    if (!this.providers.has(provider)) throw new Error(`OAuth provider ${provider} not registered`);
    return await this.checkAndRefresh(provider)
  }

  async checkAndRefresh(provider) {
    const token = this.tokens.get(provider);
    if (token.expiresAt && Date.now() > token.expiresAt) {
      console.log(`[OAuthManager] Token expired for ${provider}, refreshing...`);
      return await this.refreshToken(provider);
    }
    return token.accessToken;
  }
  
  async startAuth(provider) {
    const csrf = await this.generateCSRF(provider);
    const authUrl = this.buildAuthUrl(provider, csrf);
    await chrome.windows.create({ url: authUrl, type: 'popup', width: 600, height: 800, focused: true });
    return { success: true, message: 'Complete authorization in the popup window' };
  }
  
  // Generate CSRF state
  async generateCSRF(provider) {
    const csrf = crypto.randomUUID();
    await chrome.storage.local.set({ [`oauth_${provider}`]: csrf });
    return csrf;
  }

  // create OAuth URL
  buildAuthUrl(provider) {
    const config = this.providers.get(provider);
    if (!config) throw new Error(`Unknown provider: ${provider}`);
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri || url,
      scope: config.scopes.join(' '),
      state: csrf
    });
    // Add any provider-specific params
    if (config.authParams) {
      Object.entries(config.authParams).forEach(([k, v]) => params.set(k, v));
    }
    return `${config.authUrl}?${params}`;
  }

  // Handle OAuth callback
  async handleCallback(url) {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');
    const error = urlObj.searchParams.get('error');
    
    if (error) {
      console.error('[OAuthManager] OAuth error:', error);
      return { success: false, error };
    }
    
    if (!code || !state) return { success: false, error: 'Missing code or state' };
    
    // Find which provider this is for by checking states
    let provider = null;
    for (const [name, config] of this.providers) {
      const storedState = await chrome.storage.local.get([`oauth_${name}`]);
      if (storedState[`oauth_${name}`] === state) {
        provider = name;
        await chrome.storage.local.remove([`oauth_${name}`]);
        break;
      }
    }
    
    if (!provider) {
      console.error('[OAuthManager] No matching state found');
      return { success: false, error: 'Invalid state - possible CSRF' };
    }
    
    // Exchange code for tokens
    const config = this.providers.get(provider);
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(config.clientSecret ? {
          'Authorization': `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`
        } : {})
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri || url,
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
      })
    });
    
    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error(`[OAuthManager] Token exchange failed for ${provider}:`, error);
      return { success: false, error: `Token exchange failed: ${tokenResponse.status}` };
    }
    
    const tokens = await tokenResponse.json();
    await this.storeTokens(provider, tokens);
    
    console.log(`[OAuthManager] Successfully authenticated ${provider}`);
    return { success: true, provider };
  }
  
  // Refresh expired token
  async refreshToken(provider) {
    // Prevent concurrent refresh attempts
    if (this.refreshPromises.has(provider)) {
      return this.refreshPromises.get(provider);
    }
    
    const refreshPromise = this._doRefresh(provider);
    this.refreshPromises.set(provider, refreshPromise);
    
    try {
      const token = await refreshPromise;
      return token;
    } finally {
      this.refreshPromises.delete(provider);
    }
  }
  
  async _doRefresh(provider) {
    const config = this.providers.get(provider);
    const token = this.tokens.get(provider);
    
    if (!token?.refreshToken) {
      console.error(`[OAuthManager] No refresh token for ${provider}`);
      return null;
    }
    
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(config.clientSecret ? {
          'Authorization': `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`
        } : {})
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
      })
    });
    
    if (!response.ok) {
      console.error(`[OAuthManager] Refresh failed for ${provider}:`, response.status);
      // Clear invalid tokens
      await this.clearTokens(provider);
      return null;
    }
    
    const tokens = await response.json();
    await this.storeTokens(provider, tokens);
    
    console.log(`[OAuthManager] Refreshed token for ${provider}`);
    return tokens.access_token;
  }
  
  // Store tokens
  async storeTokens(provider, tokens) {
    const tokenData = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || this.tokens.get(provider)?.refreshToken,
      expiresAt: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : null,
      tokenType: tokens.token_type || 'Bearer',
      raw: tokens // Store full response in case modules need extra data
    };
    
    this.tokens.set(provider, tokenData);
    
    // Persist to chrome.storage.sync for cross-device
    await chrome.storage.sync.set({
      [`oauth_${provider}`]: {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt
      }
    });
  }
  
  // Load stored tokens on startup
  async loadStoredTokens(provider) {
    const stored = await chrome.storage.sync.get([`oauth_${provider}`]);
    if (stored[`oauth_${provider}`]) {
      this.tokens.set(provider, stored[`oauth_${provider}`]);
      console.log(`[OAuthManager] Loaded stored tokens for ${provider}`);
    }
  }
  
  // Clear tokens for a provider
  async clearTokens(provider) {
    this.tokens.delete(provider);
    await chrome.storage.sync.remove([`oauth_${provider}`]);
    console.log(`[OAuthManager] Cleared tokens for ${provider}`);
  }
  
  // Check if authenticated
  isAuthenticated(provider) {
    return this.tokens.has(provider) && !!this.tokens.get(provider)?.accessToken;
  }
  
  // Set up redirect listeners
  setupListeners() {
    chrome.webNavigation.onBeforeNavigate.addListener(
      async (details) => {
        if (details.url.includes('code=') || details.url.includes('error=')) {
          const result = await this.handleCallback(details.url);
          if (result.success) {
            setTimeout(() => chrome.tabs.remove(details.tabId).catch(() => {}), 100);
          }
        }
      },
      { urls: [url + '*'] }
    );
  }
}