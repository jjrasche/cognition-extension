/**
 * Fitbit Module - Bridge to Fitbit API for health data
 * Provides sleep, activity, and heart rate data from user's Fitbit device
 */

// Module manifest
export const manifest = {
  name: "Fitbit",
  version: "1.0.0",
  permissions: ["storage", "identity"],
  actions: ["refreshAllData"],
  state: {
    reads: [],
    writes: ["sleep.lastNight.hours", "sleep.lastNight.quality", "activity.today.calories", "heart.current.bpm", "ui.notify.queue"]
  }
};

// Fitbit app credentials
const CLIENT_ID = "23QNT9";
const CLIENT_SECRET = "d046fb1a90585a96647164f1b2bd4282";
const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;

let pollTimer = null;
let accessToken = null;

// Consolidated Fitbit API fetch helper
async function fitbitFetch(endpoint) {
  if (!accessToken) {
    throw new Error('No access token available');
  }
  
  const response = await fetch(`https://api.fitbit.com${endpoint}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (!response.ok) {
    throw new Error(`Fitbit API error: ${response.status}`);
  }
  
  return response.json();
}

export async function initialize(state, config) {
  // Get stored access token
  const stored = await chrome.storage.sync.get(['fitbitAccessToken']);
  accessToken = stored.fitbitAccessToken;
  
  // Check auth first - if no token, start OAuth
  if (!accessToken) {
    await startOAuthFlow(state);
    return;
  }
  
  // Set up polling only if configured
  if (config.pollInterval && config.pollInterval > 0) {
    // Initial data fetch
    await refreshAllData(state);
    
    // Set up recurring polling
    pollTimer = setInterval(async () => {
      await refreshAllData(state);
    }, config.pollInterval * 60 * 1000);
  }
}


export async function startOAuthFlow(state) {
  try {
    // Generate random state for CSRF protection
    const authState = Math.random().toString(36).substring(7);
    await chrome.storage.sync.set({ fitbitAuthState: authState });
    
    const authUrl = `https://www.fitbit.com/oauth2/authorize?` +
      `client_id=${CLIENT_ID}&` +
      `response_type=code&` +
      `scope=activity%20heartrate%20sleep&` +
      `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
      `state=${authState}`;
    
    // Open auth window
    const authWindow = await chrome.windows.create({
      url: authUrl,
      type: 'popup',
      width: 500,
      height: 750
    });
    
    await appendNotification(state, {
      type: 'info',
      module: 'fitbit',
      message: 'Please authorize Fitbit in the popup window'
    });
    
    return { success: true, message: 'Authorization window opened' };
    
  } catch (error) {
    await appendNotification(state, {
      type: 'error',
      module: 'fitbit',
      message: `Failed to start authorization: ${error.message}`
    });
    
    return { success: false, error: error.message };
  }
}

export async function handleAuthCallback(state, { code, state: authState }) {
  try {
    // Verify state matches
    const stored = await chrome.storage.sync.get(['fitbitAuthState']);
    if (authState !== stored.fitbitAuthState) {
      throw new Error('Invalid state parameter');
    }
    
    // Exchange code for token
    await exchangeCodeForToken(code);
    
    // Notify success
    await appendNotification(state, {
      type: 'success',
      module: 'fitbit',
      message: 'Fitbit connected successfully!'
    });
    
    // Start initial data fetch
    await refreshAllData(state);
    
    return { success: true, message: 'Authorization complete' };
    
  } catch (error) {
    await appendNotification(state, {
      type: 'error',
      module: 'fitbit',
      message: `Authorization failed: ${error.message}`
    });
    
    return { success: false, error: error.message };
  }
}

async function exchangeCodeForToken(code) {
  const response = await fetch('https://api.fitbit.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code: code
    })
  });
  
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }
  
  const data = await response.json();
  accessToken = data.access_token;
  
  // Store token for future use
  await chrome.storage.sync.set({ fitbitAccessToken: accessToken });
}

export async function refreshAllData(state) {
  if (!accessToken) {
    await appendNotification(state || globalState, {
      type: 'error',
      module: 'fitbit',
      message: 'Fitbit not authorized - please complete setup'
    });
    return { success: false, error: 'No access token' };
  }
  
  try {
    // Fetch all data in parallel
    const [sleepData, activityData, heartData] = await Promise.all([
      fetchSleepData(),
      fetchActivityData(),
      fetchHeartRate()
    ]);
    
    // Write to state
    if (sleepData) {
      await state.write('sleep.lastNight.hours', sleepData.hours);
      await state.write('sleep.lastNight.quality', sleepData.quality);
    }
    
    if (activityData) {
      await state.write('activity.today.calories', activityData.calories);
    }
    
    if (heartData) {
      await state.write('heart.current.bpm', heartData.bpm);
    }
    
    return { 
      success: true, 
      updated: new Date().toISOString(),
      data: { sleepData, activityData, heartData }
    };
    
  } catch (error) {
    console.error('[Fitbit] Refresh error:', error);
    
    await appendNotification(state, {
      type: 'error',
      module: 'fitbit',
      message: `Failed to fetch Fitbit data: ${error.message}`
    });
    
    return { success: false, error: error.message };
  }
}

async function fetchSleepData() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  
  const data = await fitbitFetch(`/1.2/user/-/sleep/date/${dateStr}.json`);
  
  if (data.sleep && data.sleep.length > 0) {
    const mainSleep = data.sleep.find(s => s.isMainSleep) || data.sleep[0];
    return {
      hours: Math.round(mainSleep.duration / (1000 * 60 * 60) * 10) / 10,
      quality: mainSleep.efficiency || 0
    };
  }
  
  return null;
}

async function fetchActivityData() {
  const today = new Date().toISOString().split('T')[0];
  const data = await fitbitFetch(`/1/user/-/activities/date/${today}.json`);
  
  return {
    calories: data.summary?.caloriesOut || 0
  };
}

async function fetchHeartRate() {
  const today = new Date().toISOString().split('T')[0];
  const data = await fitbitFetch(`/1/user/-/activities/heart/date/${today}/1d.json`);
  
  // Get most recent heart rate data
  if (data['activities-heart'] && data['activities-heart'].length > 0) {
    const todayData = data['activities-heart'][0];
    
    if (todayData.value && todayData.value.restingHeartRate) {
      return { bpm: todayData.value.restingHeartRate };
    }
    
    // Estimate from zones if no resting rate
    if (todayData.value && todayData.value.heartRateZones) {
      const zones = todayData.value.heartRateZones;
      const fatBurnZone = zones.find(z => z.name === 'Fat Burn');
      if (fatBurnZone) {
        return { bpm: Math.round((fatBurnZone.min + fatBurnZone.max) / 2) };
      }
    }
  }
  
  return { bpm: 0 };
}

async function appendNotification(state, notification) {
  const currentQueue = await state.read('ui.notify.queue') || [];
  currentQueue.push({
    ...notification,
    timestamp: Date.now(),
    id: `fitbit_${Date.now()}`
  });
  await state.write('ui.notify.queue', currentQueue);
}

// Cleanup function for service worker restarts
export async function cleanup() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Test cases
export const tests = [
  {
    name: 'initializes with configurable polling timer',
    fn: async () => {
      const mockState = createMockState();
      const config = { pollInterval: 15 };
      
      await initialize(mockState, config);
      
      // Timer should be set (can't easily test interval, but can test it was called)
      assert(pollTimer !== null, 'Polling timer should be initialized');
      
      // Cleanup
      if (pollTimer) clearInterval(pollTimer);
    }
  },
  
  {
    name: 'handles missing credentials gracefully',
    fn: async () => {
      const mockState = createMockState();
      accessToken = null;
      
      const result = await refreshAllData(mockState);
      
      assert(result.success === false, 'Should fail without access token');
      assert(result.error === 'No access token', 'Should return correct error');
      
      const notifications = await mockState.read('ui.notify.queue');
      assert(notifications.length > 0, 'Should create notification');
      assert(notifications[0].type === 'error', 'Should be error notification');
    }
  },
  
  {
    name: 'refreshAllData writes all state paths correctly',
    fn: async () => {
      const mockState = createMockState();
      accessToken = 'mock_token';
      
      // Mock fetch responses
      const originalFetch = global.fetch;
      global.fetch = async (url) => {
        if (url.includes('sleep')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              sleep: [{
                isMainSleep: true,
                duration: 28800000, // 8 hours in ms
                efficiency: 85
              }]
            })
          };
        }
        if (url.includes('activities/date')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              summary: { caloriesOut: 2500 }
            })
          };
        }
        if (url.includes('heart')) {
          return {
            ok: true,
            json: () => Promise.resolve({
              'activities-heart': [{
                value: { restingHeartRate: 65 }
              }]
            })
          };
        }
      };
      
      const result = await refreshAllData(mockState);
      
      assert(result.success === true, 'Should succeed with mock data');
      
      const sleepHours = await mockState.read('sleep.lastNight.hours');
      const sleepQuality = await mockState.read('sleep.lastNight.quality');
      const calories = await mockState.read('activity.today.calories');
      const heartRate = await mockState.read('heart.current.bpm');
      
      assert(sleepHours === 8, 'Should write correct sleep hours');
      assert(sleepQuality === 85, 'Should write correct sleep quality');
      assert(calories === 2500, 'Should write correct calories');
      assert(heartRate === 65, 'Should write correct heart rate');
      
      // Restore
      global.fetch = originalFetch;
    }
  },
  
  {
    name: 'handles API errors without crashing state',
    fn: async () => {
      const mockState = createMockState();
      accessToken = 'mock_token';
      
      // Mock failing fetch
      const originalFetch = global.fetch;
      global.fetch = async () => {
        return { ok: false, status: 401 };
      };
      
      const result = await refreshAllData(mockState);
      
      assert(result.success === false, 'Should fail gracefully');
      assert(result.error.includes('401'), 'Should include error details');
      
      const notifications = await mockState.read('ui.notify.queue');
      assert(notifications.length > 0, 'Should create error notification');
      
      // Restore
      global.fetch = originalFetch;
    }
  },
  
  {
    name: 'appends error notification to ui.notify.queue on API failure',
    fn: async () => {
      const mockState = createMockState();
      accessToken = 'mock_token';
      
      const originalFetch = global.fetch;
      global.fetch = async () => {
        throw new Error('Network error');
      };
      
      await refreshAllData(mockState);
      
      const notifications = await mockState.read('ui.notify.queue');
      assert(notifications.length === 1, 'Should add one notification');
      
      const notification = notifications[0];
      assert(notification.type === 'error', 'Should be error type');
      assert(notification.module === 'fitbit', 'Should be from fitbit module');
      assert(notification.message.includes('Network error'), 'Should include error message');
      assert(notification.timestamp, 'Should have timestamp');
      assert(notification.id.startsWith('fitbit_'), 'Should have fitbit ID');
      
      global.fetch = originalFetch;
    }
  }
];

// Mock state helper for testing
function createMockState() {
  const data = {};
  return {
    async read(key) { 
      return data[key]; 
    },
    async write(key, value) { 
      data[key] = value; 
    },
    watch(key, callback) {
      // Mock watcher - could be enhanced for testing
    }
  };
}

// Simple assertion helper
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}