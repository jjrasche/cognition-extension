export const manifest = {
  name: "api-keys",
  context: ["service-worker"],
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
  const { service } = params;
  const key = getKeyId(service);
  return (await chromeSyncGet(key))[key].key || null;
};
export const hasKey = async (params) => {
  const key = getKeyId(params.service);
  const syncResult = await chromeSyncGet(key);
  return !!(syncResult.success && syncResult.result[key]);
};
export const listKeys = async () => Object.keys((await chromeSyncGet(null)).result).filter(key => key.startsWith(KEY_PREFIX));
export const clearKeys = async () => await chromeSyncRemove(await listKeys());

const getKeyId = (service) => `${KEY_PREFIX}${service}`;
const chromeSyncGet = async (key) => await runtime.call('chrome-sync.get', { keys: [key] });
const chromeSyncSet = async (items) => await runtime.call('chrome-sync.set', { items });
const chromeSyncRemove = async (key) => await runtime.call('chrome-sync.remove', { keys: [key] });



export const test = async () => {
  const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
  const results = await Promise.all([
    runUnitTest("Set and get API key", async () => {
      const service = testService("basic"), key = "test-api-key-12345";
      await setKey({ service, key });// arrange
      const actual = await getKey({ service }); // act
      await cleanupTestKey(service);
      return { actual, assert: strictEqual, expected: key };
    }),
    runUnitTest("Set key with metadata", async () => {
      const service = testService("metadata"), key = "test-key-with-meta", metadata = { source: "test", created: "2025-01-01" };
      await setKey({ service, key, metadata });
      const actual = (await chromeSyncGet(getKeyId(service)))[getKeyId(service)];
      await cleanupTestKey(service);
      return { actual, assert: deepEqual, expected: { key, ...metadata , timestamp: actual.timestamp }};
    }),

    // Check key existence
    runUnitTest("hasKey returns true for existing key", async () => {
      const service = testService("exists");
      await setKey({ service, key: "exists-test" });
      const actual = await hasKey({ service });
      await cleanupTestKey(service);
      return { actual, assert: strictEqual, expected: true };
    }),

    // Check key existence
    runUnitTest("hasKey returns true for existing key", async () => {
      const service = testService("exists");
      await setKey({ service, key: "exists-test" });
      const actual = await hasKey({ service });
      await cleanupTestKey(service);
      return { actual, assert: strictEqual, expected: true };
    }),

    runUnitTest("hasKey returns false for non-existent key", async () => {
      const service = testService("missing");
      const actual = await hasKey({ service });
      return { actual, assert: strictEqual, expected: false };
    }),

    // List functionality
    runUnitTest("listKeys includes test keys", async () => {
      const services = [testService("list1"), testService("list2"), testService("list3")];
      
      // Set multiple test keys
      await Promise.all(services.map(service => 
        setKey({ service, key: `key-for-${service}` })
      ));
      
      const allKeys = await listKeys();
      const testKeys = services.map(service => getKeyId(service));
      const actual = testKeys.every(key => allKeys.includes(key));
      
      // Cleanup
      await Promise.all(services.map(cleanupTestKey));
      
      return { actual, assert: strictEqual, expected: true };
    }),

    // Get non-existent key
    runUnitTest("getKey returns null for missing key", async () => {
      const service = testService("nonexistent");
      const actual = await getKey({ service });
      return { actual, assert: strictEqual, expected: null };
    }),

    // Clear functionality
    runUnitTest("clearKeys removes all API keys", async () => {
      const services = [testService("clear1"), testService("clear2")];
      
      // Set test keys
      await Promise.all(services.map(service => 
        setKey({ service, key: `clear-test-${service}` })
      ));
      
      // Clear all keys
      await clearKeys();
      
      // Check they're gone
      const remaining = await Promise.all(services.map(service => hasKey({ service })));
      const actual = remaining.every(exists => !exists);
      
      return { actual, assert: strictEqual, expected: true };
    }),

    // Edge cases
    runUnitTest("Empty key string handled", async () => {
      const service = testService("empty");
      await setKey({ service, key: "" });
      const actual = await getKey({ service });
      await cleanupTestKey(service);
      return { actual, assert: strictEqual, expected: "" };
    }),

    runUnitTest("Special characters in service name", async () => {
      const service = "test-api-keys-special_chars.123";
      await setKey({ service, key: "special-key" });
      const actual = await getKey({ service });
      await cleanupTestKey(service);
      return { actual, assert: strictEqual, expected: "special-key" };
    })
  ]);

  // Cleanup any remaining test data
  await cleanupAllTestData();
  
  return results.flat();
};

// Test utilities
const TEST_PREFIX = 'test_api_keys_';
const testService = (suffix) => `${TEST_PREFIX}${suffix}`;

const cleanupTestKey = async (service) => {
  try {
    await chromeSyncRemove([getKeyId(service)]);
  } catch (error) {
    // Ignore cleanup errors
  }
};

const cleanupAllTestData = async () => {
  try {
    const allKeys = await listKeys();
    const testKeys = allKeys.filter(key => key.includes(TEST_PREFIX));
    if (testKeys.length > 0) {
      await chromeSyncRemove(testKeys);
    }
  } catch (error) {
    // Ignore cleanup errors
  }
};