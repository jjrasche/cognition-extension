export const manifest = {
  name: "chrome-sync",
  context: ["service-worker", "extension-page", "offscreen"],
  version: "1.0.0",
  description: "Centralized Chrome sync storage operations",
  permissions: ["storage"],
  actions: ["set", "get", "getAll","remove", "clear", "getBytesInUse"]
};
let runtime;
export const initialize = async (rt) => runtime = rt;
export const set = async (params) => await chrome.storage.sync.set(params.items);
export const get = async (params) => await chrome.storage.sync.get(params.key);
export const getAll = async () => await chrome.storage.sync.get();
export const remove = async (params) => await chrome.storage.sync.remove(params.key);
export const clear = async () => await chrome.storage.sync.clear();
export const getBytesInUse = async (params) => await chrome.storage.sync.getBytesInUse(params.key);