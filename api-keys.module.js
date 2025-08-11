export const manifest = {
  name: "api-keys",
  context: "service-worker",
  version: "1.0.0",
  description: "Centralized API key management using Chrome's secure sync storage",
  permissions: [],
  dependencies: ["chrome-sync", "ui"],
  actions: ["setKey", "getKey", "listKeys", "hasKey", "clearKeys"]
};
const KEY_PREFIX = 'apikey_';
let runtime;
export const initialize = async (rt) => (runtime = rt, verifyModuleKeys());

export const verifyModuleKeys = async () => {
  runtime.getModulesWithProperty('apiKeys').forEach(module => {
    module.manifest.apiKeys.forEach(async key => !(await hasKey({ service: key })) && await promptForKey(key));
  });
};
const promptForKey = async (service) => {
  const tree = {
    "api-key-form": {
      tag: "form",
      "service-label": { tag: "label", text: `Enter API key for ${service}:`, class: "form-label" },
      "key-input": { tag: "input", name: "key", type: "password", placeholder: "Enter your API key...", required: true },
      "submit-btn": { tag: "button", type: "submit", text: "Save API Key" }
    }
  };
  return await runtime.call('ui.renderForm', { title: `${service.toUpperCase()} API Key`, tree, onSubmit: "api-keys.setKey", formData: { service } });
};
export const setKey = async (params) => {
  const { service, key, metadata = {} } = params;
  const keyData = { key, timestamp: new Date().toISOString(), ...metadata };
  await chromeSyncSet({ [getKeyId(service)]: keyData });
  return { success: true };
};
export const getKey = async (params) => {
  const { service, keyOnly = true } = params;
  const keyID = getKeyId(service);
  const syncResult = await chromeSyncGet([keyID]);
  if (syncResult.success && syncResult.result[keyID]) {
    return keyOnly ? syncResult.result[keyID].key : syncResult.result[keyID];
  }
  return null;
};
export const hasKey = async (params) => {
  const keyID = getKeyId(params.service);
  const syncResult = await chromeSyncGet([keyID]);
  return !!(syncResult.success && syncResult.result[keyID]);
};
export const listKeys = async () => Object.keys((await chromeSyncGet(null))?.result ?? {});
export const clearKeys = async () => await chromeSyncRemove(await listKeys());

const getKeyId = (service) => `${KEY_PREFIX}${service}`;
const chromeSyncGet = async (keys) => await runtime.call('chrome-sync.get', { keys });
const chromeSyncSet = async (items) => await runtime.call('chrome-sync.set', { items });
const chromeSyncRemove = async (keys) => await runtime.call('chrome-sync.remove', { keys });