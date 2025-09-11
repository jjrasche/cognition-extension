// todo: move to config
export const manifest = {
	name: "api-keys",
	context: ["service-worker", "extension-page", "offscreen"],
	version: "1.0.0",
	description: "Centralized API key management using Chrome's secure sync storage",
	dependencies: ["chrome-sync"],//, "ui"],
	actions: ["setKey", "getKey", "listKeys", "clearKeys"]
};
let runtime;
export const initialize = async (rt) => (runtime = rt, verifyModuleKeys());

export const verifyModuleKeys = async () => {
	// runtime.getModulesWithProperty('apiKeys').forEach(module => {
	//   module.manifest.apiKeys.forEach(async service => !(await hasKey(service)) && await promptForKey(service));
	// });
};
const promptForKey = async (service) => await runtime.call('ui.renderForm', {
	title: `${service.toUpperCase()} API Key`,
	tree: {
		"api-key-form": {
			tag: "form",
			events: { submit: "api-keys.setKey" },
			"service-label": { tag: "label", text: `Enter API key for ${service}:`, class: "form-label" },
			"key-input": { tag: "input", name: "key", type: "password", placeholder: "Enter your API key...", required: true },
			"submit-btn": { tag: "button", type: "submit", text: "Save API Key" }
		}
	}
});
export const setKey = async (service, key, metadata = {}) => await chromeSyncSet({ [getKeyId(service)]: { key, timestamp: new Date().toISOString(), ...metadata } });
export const getKey = async (service, justKey = true) => {
	const result = await chromeSyncGet(getKeyId(service));
	return justKey ? result?.key : result;
};
export const listKeys = async () => Object.keys((await chromeSyncGet(null))).filter(key => key.startsWith(KEY_PREFIX));
export const clearKeys = async () => await chromeSyncRemove(await listKeys());
const hasKey = async (service) => !!(await getKey(service));
const KEY_PREFIX = 'apikey_';
const getKeyId = (service) => `${KEY_PREFIX}${service}`;
const chromeSyncGet = async (keys) => await runtime.call('chrome-sync.get', keys);
const chromeSyncSet = async (items) => await runtime.call('chrome-sync.set', items);
const chromeSyncRemove = async (keys) => await runtime.call('chrome-sync.remove', keys);
// testing
export const test = async () => {
	const { runUnitTest, strictEqual, looseEqual, deepEqual, containsAll } = runtime.testUtils;
	const results = await Promise.all([
		runUnitTest("Set and get API key", async () => {
			const service = testService("basic"), key = "test-api-key-12345";
			await setKey(service, key); // arrange
			const actual = await getKey(service); // act
			await cleanup();
			return { actual, assert: strictEqual, expected: key };
		}),
		runUnitTest("Set key with metadata", async () => {
			const service = testService("metadata"), key = "test-key-with-meta", metadata = { source: "test", created: "2025-01-01" };
			await setKey(service, key, metadata);
			const actual = (await chromeSyncGet(getKeyId(service)))
			await cleanup();
			return { actual, assert: deepEqual, expected: { key, ...metadata, timestamp: actual.timestamp } };
		}),
		runUnitTest("hasKey returns true for existing key", async () => {
			const service = testService("exists");
			await setKey(service, "exists-test");
			const actual = await hasKey(service);
			await cleanup();
			return { actual, assert: strictEqual, expected: true };
		}),
		runUnitTest("hasKey returns false for non-existent key", async () => {
			const service = testService("missing");
			const actual = await hasKey(service);
			return { actual, assert: strictEqual, expected: false };
		}),
		runUnitTest("listKeys includes test keys", async () => {
			const services = [testService("list1"), testService("list2"), testService("list3")];
			await Promise.all(services.map(service => setKey(service, `key-for-${service}`)));
			const actual = await listKeys();
			const testKeys = services.map(service => getKeyId(service));
			cleanup();
			return { actual, assert: containsAll, expected: testKeys };
		}),
		runUnitTest("getKey returns null for missing key", async () => {
			const service = testService("nonexistent");
			const actual = await getKey(service);
			return { actual, assert: looseEqual, expected: null };
		}),
		runUnitTest("Empty key string handled", async () => {
			const service = testService("empty");
			await setKey(service, "");
			const actual = await getKey(service);
			await cleanup();
			return { actual, assert: strictEqual, expected: "" };
		}),
		runUnitTest("Special characters in service name", async () => {
			const service = "test-api-keys-special_chars.123";
			await setKey(service, "special-key");
			const actual = await getKey(service);
			await cleanup();
			return { actual, assert: strictEqual, expected: "special-key" };
		})
	]);
	return results.flat();
};
const TEST_PREFIX = 'test_api_keys_';
const testService = (suffix) => `${TEST_PREFIX}${suffix}`;
const cleanup = async () => await chromeSyncRemove((await listKeys()).filter(key => key.includes(TEST_PREFIX)));