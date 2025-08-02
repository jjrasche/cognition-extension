/**
 * Fitbit Module - Bridge to Fitbit API for health data
 * Provides sleep, activity, and heart rate data from user's Fitbit device
 */

// Module manifest
export const manifest = {
  name: "fitbit",
  keywords: ["health", "fitness", "wearable"],
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["refreshAllData"],
  state: {
    reads: [],
    writes: ["fitbit.auth.status", "fitbit.lastSync", "sleep.lastNight.hours", "sleep.lastNight.quality", "activity.today.calories", "heart.current.bpm"]
  }
};

// OAuth configuration
export const oauth = {
  provider: 'fitbit',
  clientId: '23QNT9',
  clientSecret: 'd046fb1a90585a96647164f1b2bd4282',
  authUrl: 'https://www.fitbit.com/oauth2/authorize',
  tokenUrl: 'https://api.fitbit.com/oauth2/token',
  scopes: ['activity', 'heartrate', 'sleep'],
  redirectUri: 'https://chromiumapp.org/'
};

let pollTimer = null;

export async function initialize(state, config) {
  if (state.oauthManager.isAuthenticated('fitbit') && config.pollInterval && config.pollInterval > 0) {
    await refreshAllData(state);
    pollTimer = setInterval(() => refreshAllData(state), config.pollInterval * 60 * 1000);
  }
}


// Refresh all data from Fitbit
export async function refreshAllData(state) {
  const token = await state.oauthManager.getToken('fitbit');
  if (!token) {
    await state.write('fitbit.auth.status', 'disconnected');
    return { success: false, error: 'Not authenticated' };
  }
  
  try {
    const [sleepData, activityData, heartData] = await Promise.all([
      fetchSleepData(token),
      fetchActivityData(token),
      fetchHeartRate(token)
    ]);
    
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
    
    await state.write('fitbit.lastSync', new Date().toISOString());
    
    return { 
      success: true, 
      data: { sleepData, activityData, heartData }
    };
    
  } catch (error) {
    console.error('[Fitbit] Refresh error:', error);
    
    // If 401, token might be invalid
    if (error.message?.includes('401')) {
      await state.write('fitbit.auth.status', 'token_invalid');
    }
    
    return { success: false, error: error.message };
  }
}

// Fitbit API helper
const fitbitFetch = async (endpoint, token) => {
  const response = await fetch(`https://api.fitbit.com${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!response.ok) throw new Error(`Fitbit API error: ${response.status}`);
  return response.json();
};

// Fetch sleep data
const fetchSleepData = async (token) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  
  const data = await fitbitFetch(`/1.2/user/-/sleep/date/${dateStr}.json`, token);
  
  if (data.sleep?.length > 0) {
    const mainSleep = data.sleep.find(s => s.isMainSleep) || data.sleep[0];
    return {
      hours: Math.round(mainSleep.duration / (1000 * 60 * 60) * 10) / 10,
      quality: mainSleep.efficiency || 0
    };
  }
  
  return null;
};

// Fetch activity data
const fetchActivityData = async (token) => {
  const today = new Date().toISOString().split('T')[0];
  const data = await fitbitFetch(`/1/user/-/activities/date/${today}.json`, token);
  
  return {
    calories: data.summary?.caloriesOut || 0
  };
};

// Fetch heart rate data
const fetchHeartRate = async (token) => {
  const today = new Date().toISOString().split('T')[0];
  const data = await fitbitFetch(`/1/user/-/activities/heart/date/${today}/1d.json`, token);
  
  if (data['activities-heart']?.[0]?.value) {
    const todayData = data['activities-heart'][0].value;
    
    if (todayData.restingHeartRate) {
      return { bpm: todayData.restingHeartRate };
    }
    
    // Estimate from zones if no resting rate
    const fatBurnZone = todayData.heartRateZones?.find(z => z.name === 'Fat Burn');
    if (fatBurnZone) {
      return { bpm: Math.round((fatBurnZone.min + fatBurnZone.max) / 2) };
    }
  }
  
  return { bpm: 0 };
};

// Cleanup
export async function cleanup() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Tests
export const tests = [
  {
    name: 'refreshAllData handles missing token gracefully',
    fn: async () => {
      const mockState = {
        oauthManager: { getToken: async () => null },
        write: async () => {}
      };
      
      const result = await refreshAllData(mockState);
      assert(result.success === false);
      assert(result.error === 'Not authenticated');
    }
  },
  
  {
    name: 'fitbitFetch throws on non-ok response',
    fn: async () => {
      global.fetch = async () => new Response('', { status: 404, statusText: 'Not Found' });
      try {
        await fitbitFetch('/test', 'fake_token');
        assert(false, 'Should have thrown');
      } catch (error) {
        assert(error.message.includes('404'));
      }
    }
  }
];

// Test helpers
function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}