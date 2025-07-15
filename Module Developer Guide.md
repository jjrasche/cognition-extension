# Module Developer Guide

This guide shows you how to build production-ready modules using patterns from our working Fitbit integration.

## Core Concepts

### Modules are Functions, Not Classes

Every module exports functions. Use file-scoped variables for state that needs to persist between calls:

```javascript
// fitbit-module.js
let accessToken = null;  // Persists between function calls
let refreshToken = null;

export async function initialize(state, config) {
  // Load tokens from storage (survives service worker restarts)
  const stored = await chrome.storage.sync.get(['fitbitTokens']);
  if (stored.fitbitTokens) {
    accessToken = stored.fitbitTokens.accessToken;
    refreshToken = stored.fitbitTokens.refreshToken;
  }
}

export async function refreshAllData() {
  if (!accessToken) {
    throw new Error('Not authenticated. Run fitbitAuth() first.');
  }
  
  // Real API call with real error handling
  try {
    const sleep = await fetchWithAuth('/1.2/user/-/sleep/date/today.json');
    await state.write('sleep.lastNight.hours', sleep.summary.totalMinutesAsleep / 60);
    
    return { success: true, sleepHours: sleep.summary.totalMinutesAsleep / 60 };
  } catch (error) {
    if (error.message.includes('401')) {
      // Token expired - refresh it
      await refreshAccessToken();
      return refreshAllData(); // Retry
    }
    throw error;
  }
}
```

### Actions = Exported Functions

Any function you export (except `initialize`) becomes an action the LLM can call:

```javascript
// These are actions the LLM can use
export async function refreshAllData() { }
export async function setDailyGoal({ steps }) { }

// This is NOT an action (not exported)
async function refreshAccessToken() { }
```

### How Actions Actually Get Called

The module system maintains an action registry. When you export a function, it gets registered:

```javascript
// In startup.js
state.actions.register('fitbit.refreshAllData', fitbitModule.refreshAllData, {
  module: 'fitbit',
  description: 'Sync all Fitbit data',
  parameters: []
});

// When LLM wants to call it, the system:
// 1. Looks up the action in the registry
// 2. Calls the function
// 3. Returns results to the LLM
```

You don't implement this - just export functions and return results.

## State Management


### State is Your Communication Layer

Modules don't call each other. They communicate through state:

```javascript
// Fitbit module writes data
await state.write('activity.today.steps', 10432);
await state.write('sleep.lastNight.hours', 7.5);

// Other modules read it
const steps = await state.read('activity.today.steps');

// Or watch for changes
state.watch('activity.*', (value) => {
  console.log('Activity data changed:', value);
});
```

### State Naming Pattern

Follow `noun.type.property`:
- ✅ `fitbit.auth.status`
- ✅ `sleep.lastNight.hours`
- ✅ `activity.today.calories`
- ❌ `fitbitAuthStatus` (no structure)

### Single Writer Rule

Only ONE module writes to each domain:
- Fitbit module owns all `sleep.*` and `activity.*` paths
- UI module owns all `ui.*` paths
- Never write to another module's domain

### The Notification Queue Pattern

For cross-module communication, use append-only queues:

```javascript
// Fitbit module adds notification
const current = await state.read('ui.notify.queue') || [];
await state.write('ui.notify.queue', [...current, {
  message: 'Fitbit sync complete',
  type: 'success',
  timestamp: Date.now()
}]);

// UI module watches and displays
state.watch('ui.notify.queue', async (queue) => {
  if (queue?.length > 0) {
    const notification = queue[0];
    showNotification(notification);
    // Remove after showing
    await state.write('ui.notify.queue', queue.slice(1));
  }
});
```

## Service Worker Lifecycle

**Critical:** Service workers restart after ~30 seconds of inactivity. Your module MUST handle this.

### What Survives Restarts
- ✅ `chrome.storage.sync` - Permanent storage
- ✅ `state` (via chrome.storage) - Shared state
- ❌ Module variables - Lost on restart
- ❌ Timers/intervals - Cancelled on restart

## Handling OAuth Properly

```javascript
export async function initialize(state, config) {
  // ALWAYS reload tokens from storage
  const stored = await chrome.storage.sync.get(['fitbitTokens']);
  if (stored.fitbitTokens) {
    accessToken = stored.fitbitTokens.accessToken;
    refreshToken = stored.fitbitTokens.refreshToken;
  }
}

async function saveTokens(tokens) {
  // ALWAYS persist immediately
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  await chrome.storage.sync.set({
    fitbitTokens: {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + (tokens.expiresIn * 1000)
    }
  });
}
```

## Action Handling
You're right that we should document the action pattern. Here's what modules need to know:

```javascript
// In your HTML content
<button data-action="fitbit.refresh" data-params='{"force":true}'>Refresh</button>

// The UI captures clicks and writes to state:
// ui.action.request = {action: "fitbit.refresh", params: {force: true}}

// Your module watches for its actions:
state.watch('ui.action.request', (request) => {
  if (request.action.startsWith('fitbit.')) {
    // Handle your action
  }
});
```
## Real-World Example: OAuth Flow

Here's how the Fitbit module handles actual OAuth:

```javascript
export async function startAuth() {
  // Generate random state for security
  const authState = Math.random().toString(36).substring(7);
  await chrome.storage.sync.set({ fitbitAuthState: authState });
  
  // Build OAuth URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'activity heartrate sleep profile',
    state: authState
  });
  
  // Open auth window
  chrome.windows.create({
    url: `https://www.fitbit.com/oauth2/authorize?${params}`,
    type: 'popup',
    width: 500,
    height: 750
  });
  
  return { 
    status: 'auth_window_opened',
    message: 'Complete authorization in the popup window'
  };
}

export async function handleAuthCallback(code, state) {
  // Verify state matches
  const stored = await chrome.storage.sync.get(['fitbitAuthState']);
  if (state !== stored.fitbitAuthState) {
    throw new Error('Invalid state parameter - possible CSRF attack');
  }
  
  // Exchange code for tokens
  const response = await fetch('https://api.fitbit.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: config.redirectUri
    })
  });
  
  const tokens = await response.json();
  await saveTokens(tokens);
  
  // Notify success
  const queue = await state.read('ui.notify.queue') || [];
  await state.write('ui.notify.queue', [...queue, {
    message: 'Fitbit connected successfully!',
    type: 'success'
  }]);
  
  return { success: true };
}
```

## Testing Your Module

Export tests that verify real behavior:

```javascript
export const tests = [
  {
    name: 'handles expired token by refreshing',
    fn: async () => {
      // Mock expired token response
      global.fetch = async (url) => {
        if (url.includes('/sleep/')) {
          return { 
            status: 401,
            json: async () => ({ errors: [{ errorType: 'expired_token' }] })
          };
        }
        // Token refresh succeeds
        if (url.includes('/oauth2/token')) {
          return {
            ok: true,
            json: async () => ({ 
              access_token: 'new_token',
              expires_in: 28800 
            })
          };
        }
      };
      
      // Should handle token refresh transparently
      const result = await refreshAllData();
      assert(result.success === true);
      assert(accessToken === 'new_token');
    }
  }
];
```

## Quick Checklist

✅ **Module exports functions** (not classes)  
✅ **State follows naming pattern** (domain.type.property)  
✅ **Only write to your domain** (single writer rule)  
✅ **Handle service worker restarts** (use chrome.storage.sync)  
✅ **Return results from actions** (for LLM to use)  
✅ **Add notifications via queue** (cross-module communication)  
✅ **Test real scenarios** (OAuth, errors, retries)  

## Complete Minimal Module

Here's a working module that follows all patterns:

todo fix to use the patterns
~~```javascript
// weather-module.js
let apiKey = null;

export async function initialize(state, config) {
  // Load API key from storage (survives restarts)
  const stored = await chrome.storage.sync.get(['weatherApiKey']);
  apiKey = stored.weatherApiKey || config.apiKey;
}

export async function getCurrentWeather({ location = 'current' }) {
  if (!apiKey) {
    throw new Error('Weather API key not configured');
  }
  
  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${location}&appid=${apiKey}&units=imperial`
    );
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Write to state
    await state.write('weather.current.temp', data.main.temp);
    await state.write('weather.current.description', data.weather[0].description);
    await state.write('weather.current.location', data.name);
    
    // Notify UI
    const queue = await state.read('ui.notify.queue') || [];
    await state.write('ui.notify.queue', [...queue, {
      message: `${data.name}: ${Math.round(data.main.temp)}°F, ${data.weather[0].description}`,
      type: 'info'
    }]);
    
    return {
      location: data.name,
      temp: data.main.temp,
      description: data.weather[0].description,
      humidity: data.main.humidity
    };
    
  } catch (error) {
    console.error('[Weather] Error:', error);
    throw error;
  }
}

export const tests = [
  {
    name: 'fetches and stores weather data',
    fn: async () => {
      const mockState = createMockState();
      apiKey = 'test_key';
      
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          name: 'Seattle',
          main: { temp: 65.5, humidity: 78 },
          weather: [{ description: 'partly cloudy' }]
        })
      });
      
      const result = await getCurrentWeather({ location: 'Seattle' });
      
      assert(result.temp === 65.5);
      assert(result.location === 'Seattle');
      
      const temp = await mockState.read('weather.current.temp');
      assert(temp === 65.5);
    }
  }
];
```~~

That's it. Build real modules that handle real complexity. The system handles the rest.


## Debugging Your Module

The extension includes built-in dev console helpers that make debugging much easier.

### Accessing the Dev Console

1. Open `chrome://extensions`
2. Find Cognition Extension
3. Click "service worker" link to open the console
4. Wait 2-3 seconds for initialization to complete

### Available Debug Commands

```javascript
// View all state
viewState()

// View specific state value  
getState('sleep.lastNight.hours')

// List all registered actions
listActions()

// Execute any action directly
executeAction('fitbit.refreshAllData')

// Test Fitbit connection
testFitbit()

// View Fitbit auth status
viewFitbitAuth()

// Watch state changes in real-time
watchState('sleep.lastNight.hours')
stopWatching()

// Debug initialization issues
debugInit()
```

### Common Issues

**Actions not showing up?**
```javascript
// Check if your module is loaded
getState('system.modules')

// Verify actions are registered
listActions()  // Should show your module's actions
```

**State not updating?**
```javascript
// Watch for state changes
watchState('your.state.key')

// Manually trigger your action
executeAction('yourmodule.youraction')
```

**OAuth or async issues?**
- Check for multiple auth windows (state mismatch)
- Ensure tokens are persisted to chrome.storage
- Look for "already being processed" messages in logs

### Service Worker Gotchas

1. **No dynamic imports** - Must use static imports at file top
2. **Restarts frequently** - Always reload state from storage
3. **No window object** - Use `globalThis` instead
4. **Timing matters** - State initializes async, may need to wait

### Testing Pattern

```javascript
// In your tests, create proper mock state
function createMockState() {
  const data = {};
  return {
    async read(key) { return data[key]; },
    async write(key, value) { data[key] = value; },
    watch(key, callback) { /* mock */ },
    actions: {
      register: () => {},
      execute: async () => ({ success: true }),
      list: () => []
    }
  };
}
```