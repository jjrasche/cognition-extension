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
    return await this.checkAndRefresh(provider);
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

  buildAuthUrl(provider, csrf) {
    const config = this.providers.get(provider);
    if (!config) throw new Error(`Unknown provider: ${provider}`);
    const params = this.buildAuthParams(config, csrf);
    return `${config.authUrl}?${params}`;
  }

  buildAuthParams(config, csrf) {
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri || url,
      scope: config.scopes.join(' '),
      state: csrf
    });
    if (config.authParams) {
      Object.entries(config.authParams).forEach(([k, v]) => params.set(k, v));
    }
    return params;
  }

  async handleCallback(callbackUrl) {
    const params = this.extractCallbackParams(callbackUrl);
    if (params.error) return this.handleCallbackError(params);
    if (!params.code || !params.state) return { success: false, error: 'Missing code or state' };
    
    const provider = await this.findProviderByState(params.state);
    if (!provider) return { success: false, error: 'Invalid state - possible CSRF' };
    
    await this.clearCSRF(provider);
    return await this.exchangeCodeForTokens(provider, params.code);
  }

  extractCallbackParams(callbackUrl) {
    const urlObj = new URL(callbackUrl);
    return {
      code: urlObj.searchParams.get('code'),
      state: urlObj.searchParams.get('state'),
      error: urlObj.searchParams.get('error'),
      errorDescription: urlObj.searchParams.get('error_description')
    };
  }

  handleCallbackError(params) {
    console.error('[OAuthManager] OAuth error:', params.error, params.errorDescription);
    return { success: false, error: params.error };
  }

  async findProviderByState(state) {
    for (const [provider, config] of this.providers) {
      const storedState = await this.getStoredCSRF(provider);
      if (storedState === state) return provider;
    }
    return null;
  }

  providerName = (provider) =>  `oauth_${provider}`
  async generateCSRF(provider) {
    const csrf = crypto.randomUUID();
    await chrome.storage.local.set({ [this.providerName(provider)]: csrf });
    return csrf;
  }
  async getStoredCSRF(provider) {
    const stored = await chrome.storage.local.get([this.providerName(provider)]);
    return stored[this.providerName(provider)];
  }
  async clearCSRF(provider) {
    await chrome.storage.local.remove([this.providerName(provider)]);
  }

  async exchangeCodeForTokens(provider, code) {
    try {
      const config = this.providers.get(provider);
      const response = await this.requestTokens(config, code);
      const tokens = await this.parseTokenResponse(response);
      await this.storeTokens(provider, tokens);
      console.log(`[OAuthManager] Successfully authenticated ${provider}`);
      return { success: true, provider };
    } catch (error) {
      console.error(`[OAuthManager] Token exchange failed for ${provider}:`, error);
      return { success: false, error: error.message };
    }
  }

  async requestTokens(config, code) {
    const body = this.buildTokenRequestBody(config, code);
    const headers = this.buildTokenRequestHeaders(config);
    const response = await fetch(config.tokenUrl, { method: 'POST', headers, body });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${response.status} - ${error}`);
    }
    return response;
  }

  buildTokenRequestBody(config, code) {
    return new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri || url,
      client_id: config.clientId,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
    });
  }

  buildTokenRequestHeaders(config) {
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (config.clientSecret) {
      headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
    }
    return headers;
  }

  parseTokenResponse = async (response) => await response.json();

  async refreshToken(provider) {
    if (this.refreshPromises.has(provider)) {
      return this.refreshPromises.get(provider);
    }
    const refreshPromise = this.doRefresh(provider);
    this.refreshPromises.set(provider, refreshPromise);
    
    try {
      return await refreshPromise;
    } finally {
      this.refreshPromises.delete(provider);
    }
  }

  async doRefresh(provider) {
    const config = this.providers.get(provider);
    const token = this.tokens.get(provider);
    
    if (!token?.refreshToken) {
      console.error(`[OAuthManager] No refresh token for ${provider}`);
      return null;
    }
    
    try {
      const response = await this.requestRefresh(config, token.refreshToken);
      const tokens = await this.parseTokenResponse(response);
      await this.storeTokens(provider, tokens);
      console.log(`[OAuthManager] Refreshed token for ${provider}`);
      return tokens.access_token;
    } catch (error) {
      console.error(`[OAuthManager] Refresh failed for ${provider}:`, error);
      await this.clearTokens(provider);
      return null;
    }
  }

  async requestRefresh(config, refreshToken) {
    const body = this.buildRefreshRequestBody(config, refreshToken);
    const headers = this.buildTokenRequestHeaders(config);
    const response = await fetch(config.tokenUrl, { method: 'POST', headers, body });
    if (!response.ok) {
      throw new Error(`Refresh failed: ${response.status}`);
    } 
    return response;
  }

  buildRefreshRequestBody(config, refreshToken) {
    return new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
    });
  }

  async storeTokens(provider, tokens) {
    const tokenData = this.buildTokenData(provider, tokens);
    this.tokens.set(provider, tokenData);
    await this.persistTokens(provider, tokenData);
  }

  buildTokenData(provider, tokens) {
    const existingToken = this.tokens.get(provider);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || existingToken?.refreshToken,
      expiresAt: tokens.expires_in ? Date.now() + (tokens.expires_in * 1000) : null,
      tokenType: tokens.token_type || 'Bearer',
      raw: tokens
    };
  }

  async persistTokens(provider, tokenData) {
    await chrome.storage.sync.set({
      [this.providerName(provider)]: {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: tokenData.expiresAt
      }
    });
  }

  async loadStoredTokens(provider) {
    const stored = await chrome.storage.sync.get([this.providerName(provider)]);
    if (stored[this.providerName(provider)]) {
      this.tokens.set(provider, stored[this.providerName(provider)]);
      console.log(`[OAuthManager] Loaded stored tokens for ${provider}`);
    }
  }

  async clearTokens(provider) {
    this.tokens.delete(provider);
    await chrome.storage.sync.remove([this.providerName(provider)]);
    console.log(`[OAuthManager] Cleared tokens for ${provider}`);
  }

  isAuthenticated(provider) {
    return this.tokens.has(provider) && !!this.tokens.get(provider)?.accessToken;
  }

  setupListeners() {
    chrome.webNavigation.onBeforeNavigate.addListener(
      async (details) => this.handleNavigationEvent(details),
      { urls: [`${url}*`] }
    );
  }

  async handleNavigationEvent(details) {
    if (!this.isOAuthCallback(details.url)) return;
    
    const result = await this.handleCallback(details.url);
    if (result.success) {
      this.closeTab(details.tabId);
    }
  }

  isOAuthCallback(callbackUrl) {
    return callbackUrl.includes('code=') || callbackUrl.includes('error=');
  }

  closeTab(tabId) {
    setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), 100);
  }
}