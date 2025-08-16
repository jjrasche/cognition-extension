import { today, yesterday } from './helpers.js';

export const manifest = {
  name: "fitbit",
  keywords: ["health", "fitness", "wearable"],
  context: ["service-worker"],
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["getData", "refreshData"],
  dependencies: ["oauth"],
  oauth: {
    provider: 'fitbit',
    clientId: '23QNT9',
    clientSecret: 'd046fb1a90585a96647164f1b2bd4282',
    authUrl: 'https://www.fitbit.com/oauth2/authorize',
    tokenUrl: 'https://api.fitbit.com/oauth2/token',
    scopes: ['activity', 'heartrate', 'sleep'],
    redirectUri: 'https://chromiumapp.org/'
  }
};

let data = {};
let _runtime;

export const initialize = async (runtime) => {
  _runtime = runtime;
  
  // Don't refresh data during initialization to avoid circular dependency
  // Set up polling instead
  setupDataPolling();
  
  // Do initial refresh after a short delay to ensure OAuth is ready
  setTimeout(() => refreshData(), 2000);
};

const setupDataPolling = () => setInterval(() => refreshData(), 15 * 60 * 1000);

// Use runtime.call() instead of chrome.runtime.sendMessage
const request = async (endpoint) => await _runtime.call('oauth.request', { 
  provider: 'fitbit', 
  url: `https://api.fitbit.com${endpoint}` 
});

export const refreshData = async () => {
  try {
    updateLastSync();
    await Promise.all([
      updateSleepData(),
      updateActivityData(),
      updateHeartRate()
    ]);
    return { success: true, data };
  } catch (error) {
    console.error('[Fitbit] Refresh failed:', error);
    return { success: false, error: error.message };
  }
};

const updateLastSync = () => {
  data['fitbit.lastSync'] = new Date().toISOString();
};

// Sleep data
const updateSleepData = async () => {
  try {
    const sleepResponse = await request(`/1.2/user/-/sleep/date/${yesterday()}.json`);
    data['sleep.lastNight'] = formatSleepData(sleepResponse.sleep);
  } catch (error) {
    console.error('[Fitbit] Failed to update sleep data:', error);
    data['sleep.lastNight'] = { hours: 0, quality: 0 };
  }
};

const formatSleepData = (sleepData) => {
  if (!sleepData || sleepData.length === 0) return { hours: 0, quality: 0 };
  const sleep = sleepData.find(s => s.isMainSleep) || sleepData[0];
  return { 
    hours: Math.round(sleep.duration / (1000 * 60 * 60) * 10) / 10, 
    quality: sleep.efficiency || 0 
  };
};

// Activity data
const updateActivityData = async () => {
  try {
    const activityResponse = await request(`/1/user/-/activities/date/${today()}.json`);
    data['calories'] = activityResponse.summary?.caloriesOut || 0;
  } catch (error) {
    console.error('[Fitbit] Failed to update activity data:', error);
    data['calories'] = 0;
  }
};

// Heart rate data
const updateHeartRate = async () => {
  try {
    const heartResponse = await request(`/1/user/-/activities/heart/date/${today()}/1d.json`);
    data['heart.current'] = formatHeartRateData(heartResponse['activities-heart']);
  } catch (error) {
    console.error('[Fitbit] Failed to update heart rate:', error);
    data['heart.current'] = { bpm: 0 };
  }
};

const formatHeartRateData = (heartData) => {
  if (!heartData || !heartData[0]) return { bpm: 0 };
  const dayData = heartData[0].value;
  return getBPMFromHeartData(dayData) || getBPMFromFatBurnZone(dayData) || { bpm: 0 };
};

const getBPMFromHeartData = (heartData) => {
  if (heartData?.restingHeartRate) {
    return { bpm: heartData.restingHeartRate };
  }
  return null;
};

const getBPMFromFatBurnZone = (heartData) => {
  const zone = heartData?.heartRateZones?.find(z => z.name === 'Fat Burn');
  if (zone) {
    return { bpm: Math.round((zone.min + zone.max) / 2) };
  }
  return null;
};

export const getData = () => ({ ...data });