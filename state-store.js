
// state-store.js - Unified state management using chrome.storage
// Provides reactive state with granular watching capabilities
const COGNITION_STATE = 'cognitionState';
export class StateStore {
  constructor() {
    this.watchers = new Map();
    
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[COGNITION_STATE]) {
        const oldState = changes[COGNITION_STATE].oldValue || {};
        const newState = changes[COGNITION_STATE].newValue || {};
        for (const [key, value] of Object.entries(newState)) {
          if (oldState[key] !== value) {
            this.notifyWatchers(key, value);
          }
        }
      }
    });
  }
  
  notifyWatchers(key, value) {
    this.watchers.get(key)?.forEach(cb => cb(value)); // call watcher callbacks with updated value
    // Pattern matching (e.g., "ui.*")
    for (const [pattern, callbacks] of this.watchers) {
      if (pattern.includes('*') && key.startsWith(pattern.replace('*', ''))) {
        callbacks.forEach(cb => cb(value));
      }
    }
  }
  
  async read(key) {
    const stored = await chrome.storage.local.get(COGNITION_STATE);
    return stored[COGNITION_STATE]?.[key];
  }
  
  async write(key, value) {
    const stored = await chrome.storage.local.get(COGNITION_STATE);
    const state = stored[COGNITION_STATE] || {};
    state[key] = value;
    await chrome.storage.local.set({ [COGNITION_STATE]: state });
  }
  async writeMany(updates) {
    const stored = await chrome.storage.local.get(COGNITION_STATE);
    const state = stored[COGNITION_STATE] || {};
    Object.assign(state, updates);
    await chrome.storage.local.set({ [COGNITION_STATE]: state });
  }
  
  async remove(key) {
    const stored = await chrome.storage.local.get(COGNITION_STATE);
    const state = stored[COGNITION_STATE] || {};
    delete state[key];
    await chrome.storage.local.set({ [COGNITION_STATE]: state });
  }
  
  watch(pattern, callback) {
    if (!this.watchers.has(pattern)) {
      this.watchers.set(pattern, new Set());
    }
    this.watchers.get(pattern).add(callback);
    return () => this.watchers.get(pattern)?.delete(callback);
  }
  
  matchesPattern = (key, pattern) => new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$').test(key);
  
  async getAll() {
    const stored = await chrome.storage.local.get(COGNITION_STATE);
    return stored[COGNITION_STATE] || {};
  }
  
  async clear() {
    await chrome.storage.local.remove(COGNITION_STATE);
  }
}

globalThis.ContentStore = StateStore;