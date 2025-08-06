export const manifest = {
  name: "oauth",
  description: "Centralized OAuth management and calls for extension",
  context: "service-worker",
  version: "1.0.0", 
  permissions: ["storage"],
  actions: ["request", "clearTokens"],
};

const url = 'https://chromiumapp.org/';
const providers = new Map();
const tokens = new Map();
const refreshPromises = new Map();
const pkceVerifiers = new Map();

let _runtime;
export const initialize = async (runtime) => {
  _runtime = runtime;
  await loadStoredTokens();
  await autoDiscoverProviders();
  setupListeners();
};

// Auto-discovery of OAuth configs from modules
const autoDiscoverProviders = async () => {
  const oauthModules = _runtime.getModulesWithProperty('oauth');
  oauthModules.forEach(module => registerProvider(module.manifest));
  console.log(`[OAuth] Registered ${providers.size} providers:`, [...providers.keys()]);
};

const registerProvider = (manifest) => {
  verifyConfig(manifest.oauth);
  providers.set(manifest.name, { ...manifest.oauth, provider: manifest.name });
};

const verifyConfig = (config) => !config.clientId || !config.authUrl || !config.tokenUrl || (() => { throw new Error(`Invalid OAuth config`); })();

// Main action - authenticated API calls
export const request = async (params) => {
  const { provider, url } = params;
  !providers.has(provider) && (() => { throw new Error(`OAuth provider ${provider} not registered`); })();
  let token = await checkAndRefresh(provider);
  if (!token) {
    await startAuthFlow(provider);
    token = await waitForToken(provider);
  }
  
  const response = await fetch(url, {  headers: { 'Authorization': `Bearer ${token}` } });  

  if (response.status === 401) {
    await clearTokens({ provider });
    return request(params); // Retry after clearing stale token
  }
  
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
};

// Internal auth flow helpers
const startAuthFlow = async (provider) => {
  const csrf = await generateCSRF(provider);
  const pkce = await generatePKCE(provider);
  const authUrl = buildAuthUrl(provider, csrf, pkce || {});
  await chrome.windows.create({ url: authUrl, type: 'popup', width: 600, height: 800, focused: true });
};

const waitForToken = (provider, timeout = 30000) => new Promise((resolve) => {
  const start = Date.now();
  const check = () => {
    const token = tokens.get(provider)?.accessToken;
    if (token) resolve(token);
    else if (Date.now() - start > timeout) resolve(null);
    else setTimeout(check, 500);
  };
  check();
});

export const clearTokens = async (params) => {
  const { provider } = params;
  tokens.delete(provider);
  await chrome.storage.sync.remove([providerKey(provider)]);
  return { success: true };
};

// Token management
const checkAndRefresh = async (provider) => {
  const token = tokens.get(provider);
  if (!token) return null;
  return token.expiresAt && Date.now() > token.expiresAt
    ? await refreshToken(provider)
    : token.accessToken;
};

const refreshToken = async (provider) => {
  if (refreshPromises.has(provider)) return refreshPromises.get(provider);
  const promise = doRefresh(provider);
  refreshPromises.set(provider, promise);
  try { return await promise; }
  finally { refreshPromises.delete(provider); }
};

const doRefresh = async (provider) => {
  const config = providers.get(provider);
  const token = tokens.get(provider);
  
  if (!token?.refreshToken) {
    console.error(`[OAuth] No refresh token for ${provider}`);
    return null;
  }
  
  try {
    const response = await requestRefresh(config, token.refreshToken);
    const newTokens = await response.json();
    await storeTokens(provider, newTokens);
    return newTokens.access_token;
  } catch (error) {
    console.error(`[OAuth] Refresh failed for ${provider}:`, error);
    await clearTokens({ provider });
    return null;
  }
};

// Auth flow helpers
const buildAuthUrl = (provider, csrf, pkceParams = {}) => {
  const config = providers.get(provider);
  const params = buildAuthParams(config, csrf, pkceParams);
  return `${config.authUrl}?${params}`;
};

const buildAuthParams = (config, csrf, pkceParams = {}) => {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code', 
    redirect_uri: config.redirectUri || url,
    scope: config.scopes.join(' '),
    state: csrf
  });
  
  pkceParams.codeChallenge && (
    params.set('code_challenge', pkceParams.codeChallenge),
    params.set('code_challenge_method', 'S256')
  );
  
  config.authParams && Object.entries(config.authParams).forEach(([k, v]) => params.set(k, v));
  return params;
};

const generatePKCE = async (provider) => {
  const config = providers.get(provider);
  if (config.clientSecret) return null;
  
  const verifier = generateRandomString();
  pkceVerifiers.set(provider, verifier);
  
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  
  return { codeChallenge: challenge, codeVerifier: verifier };
};

const generateRandomString = () => {
  const array = new Uint32Array(28);
  crypto.getRandomValues(array);
  return Array.from(array, dec => ('0' + dec.toString(16)).substr(-2)).join('');
};

// CSRF management  
const generateCSRF = async (provider) => {
  const csrf = crypto.randomUUID();
  await chrome.storage.local.set({ [csrfKey(provider)]: csrf });
  return csrf;
};

const getStoredCSRF = async (provider) => {
  const stored = await chrome.storage.local.get([csrfKey(provider)]);
  return stored[csrfKey(provider)];
};

const clearCSRF = async (provider) => 
  await chrome.storage.local.remove([csrfKey(provider)]);

// Storage helpers
const providerKey = (provider) => `oauth_${provider}`;
const csrfKey = (provider) => `oauth_csrf_${provider}`;

const loadStoredTokens = async () => {
  const stored = await chrome.storage.sync.get(null);
  Object.entries(stored)
    .filter(([key]) => key.startsWith('oauth_') && !key.includes('csrf'))
    .forEach(([key, tokenData]) => {
      const provider = key.replace('oauth_', '');
      tokens.set(provider, tokenData);
    });
};

const storeTokens = async (provider, newTokens) => {
  const existingToken = tokens.get(provider);
  const tokenData = {
    accessToken: newTokens.access_token,
    refreshToken: newTokens.refresh_token || existingToken?.refreshToken,
    expiresAt: newTokens.expires_in ? Date.now() + (newTokens.expires_in * 1000) : null,
    tokenType: newTokens.token_type || 'Bearer'
  };
  
  tokens.set(provider, tokenData);
  await chrome.storage.sync.set({ [providerKey(provider)]: tokenData });
};

// Network requests
const requestRefresh = async (config, refreshToken) => {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.clientId,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
  });
  
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (config.clientSecret) {
    headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  }
  
  const response = await fetch(config.tokenUrl, { method: 'POST', headers, body });
  !response.ok && (() => { throw new Error(`Refresh failed: ${response.status}`); })();
  return response;
};

// Callback handling
const handleCallback = async (callbackUrl) => {
  const params = extractCallbackParams(callbackUrl);
  if (params.error) return { success: false, error: params.error };
  if (!params.code || !params.state) return { success: false, error: 'Missing code or state' };
  
  const provider = await findProviderByState(params.state);
  if (!provider) return { success: false, error: 'Invalid state - possible CSRF' };
  
  await clearCSRF(provider);
  return await exchangeCodeForTokens(provider, params.code);
};

const extractCallbackParams = (callbackUrl) => {
  const url = new URL(callbackUrl);
  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error')
  };
};

const findProviderByState = async (state) => {
  for (const [provider] of providers) {
    const storedState = await getStoredCSRF(provider);
    if (storedState === state) return provider;
  }
  return null;
};

const exchangeCodeForTokens = async (provider, code) => {
  try {
    const config = providers.get(provider);
    const response = await requestTokens(config, code);
    const tokens = await response.json();
    await storeTokens(provider, tokens);
    return { success: true, provider };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const requestTokens = async (config, code) => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri || url,
    client_id: config.clientId,
    ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
  });
  
  if (!config.clientSecret) {
    const verifier = pkceVerifiers.get(config.provider);
    verifier && (body.set('code_verifier', verifier), pkceVerifiers.delete(config.provider));
  }
  
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (config.clientSecret) {
    headers.Authorization = `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;
  }
  
  const response = await fetch(config.tokenUrl, { method: 'POST', headers, body });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${error}`);
  }
  return response;
};

// Event listeners
const setupListeners = () => {
  chrome.webNavigation.onBeforeNavigate.addListener(
    async (details) => handleNavigationEvent(details),
    { url: [{ urlMatches: `${url}.*` }] }
  );
};

const handleNavigationEvent = async (details) => {
  if (!isOAuthCallback(details.url)) return;
  
  const result = await handleCallback(details.url);
  if (result.success) {
    setTimeout(() => chrome.tabs.remove(details.tabId).catch(() => {}), 100);
  }
};

const isOAuthCallback = (callbackUrl) => 
  callbackUrl.includes('code=') || callbackUrl.includes('error=');