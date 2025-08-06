import { today, yesterday } from './helpers.js';

export const manifest = {
  name: "fitbit",
  keywords: ["health", "fitness", "wearable"],
  context: "service-worker",
  version: "1.0.0",
  permissions: ["storage"],
  actions: ["getData", "refreshData"],
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
export const initialize = async () => (await refreshData(), setupDataPolling());
const setupDataPolling = () => setInterval(() => refreshData(), 15 * 60 * 1000);

// Refresh all data from Fitbit. example: Background data fetching is fire and forget
const request = async (endpoint) => await chrome.runtime.sendMessage({ action: 'oauth.request', params: { provider: 'fitbit', url: `https://api.fitbit.com${endpoint}` } });
export const refreshData = () => (updateLastSync(), updateSleepData(), updateActivityData(), updateHeartRate());
const updateLastSync = () => data['fitbit.lastSync'] = new Date().toISOString();
// sleep data
const updateSleepData = async () => data['sleep.lastNight'] = formatSleepData(await request(`/1.2/user/-/sleep/date/${yesterday()}.json`));
const formatSleepData = (sleepData) => {
  if (sleepData?.length === 0) return { hours: 0, quality: 0 };
  const sleep = sleepData.find(s => s.isMainSleep) || sleepData[0];
  return { hours: Math.round(sleep.duration / (1000 * 60 * 60) * 10) / 10, quality: sleep.efficiency || 0 };
}
// activity data
const updateActivityData = async () => data['calories'] = (await request(`/1/user/-/activities/date/${today()}.json`)).summary?.caloriesOut || 0;
// hear rate data
const updateHeartRate = async () => { const d = await request(`/1/user/-/activities/heart/date/${today()}/1d.json`); data['heart.current'] = formatHeartRateData(d); };
const formatHeartRateData = (heartData) => { const d = heartData?.[0]?.value; return d && (getBPMFromHeartData(d) || getBPMFromFatBurnZone(d)); };
const getBPMFromHeartData = (heartData) => { const d = heartData.restingHeartRate; return d && { bpm: heartData.restingHeartRate }; };
const getBPMFromFatBurnZone = (heartData) => { const d =  heartData?.heartRateZones?.find(z => z.name === 'Fat Burn'); return d && { bpm: Math.round((d.min + d.max) / 2) }; };

export const getData = () => ({ ...data });

// todo: work through example of how a module could update UI upon refresh
