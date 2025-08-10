export const manifest = {
  name: "api-keys",
  context: "service-worker",
  version: "1.0.0",
  description: "Centralized API key management using Chrome's secure sync storage",
  permissions: ["storage"],
  actions: ["setKey", "getKey", "listKeys", "hasKey", "clearKeys"]
};
const KEY_PREFIX = 'apikey_';
let runtime;
export const initialize = async (rt) => (runtime = rt, verifyModuleKeys());

export const verifyModuleKeys = async () => {
  runtime.getModulesWithProperty('apiKeys').forEach(module => {
        module.manifest.apiKeys.forEach(async key => {
            const keyExists = await hasKey({ service: key });
            if (!keyExists) {
                await runtime.call("ui.showInput", {
                    title: `API Key Required For ${module.manifest.name}'s ${key} service`,
                    message: `Enter your API key for ${key}:`,
                    action: "api-keys.setKey",
                    valueName: "key",
                    actionParams: { service: key },
                });
            }
        });
  });
};

export const setKey = async (params) => {
    const { service, key, metadata = {} } = params;
    const keyData = { key, timestamp: new Date().toISOString(), ...metadata };
    await chrome.storage.sync.set({ [getKeyId(service)]: keyData });
};
export const getKey = async (params) => {
    const { service, keyOnly = true } = params;
    const keyID = getKeyId(service);
    const ret = await chrome.storage.sync.get(keyID);
    if (ret && ret[keyID]) {
        return keyOnly ? ret[keyID].key : ret[keyID];
    }
    return null;
};
export const hasKey = async (params) => {
    const keyID = getKeyId(params.service);
    const result = await chrome.storage.sync.get([keyID]);
    return !!result[keyID];
};
export const listKeys = async () => Object.keys(await chrome.storage.sync.get(null)).filter(key => key.startsWith(KEY_PREFIX));
export const clearKeys = async () => await chrome.storage.sync.remove(await listKeys());
const getKeyId = (service) => `${KEY_PREFIX}${service}`;