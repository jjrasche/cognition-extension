export const manifest = {
	name: "chrome-sync",
	context: ["service-worker", "extension-page", "offscreen"],
	version: "1.0.0",
	description: "Centralized Chrome sync storage operations",
	permissions: ["storage"],
	actions: ["set", "get", "getAll", "remove", "clear", "getBytesInUse"]
};
let runtime, log;
export const initialize = async (rt, l) => { runtime = rt; log = l; }
export const set = async (items) => await chrome.storage.sync.set(items);
export const get = async (keys) => {
	const result = await chrome.storage.sync.get(keys);
	return typeof keys === 'string' ? result[keys] : result;
};
export const getAll = async () => await chrome.storage.sync.get();
export const remove = async (keys) => await chrome.storage.sync.remove(keys);
export const clear = async () => await chrome.storage.sync.clear();
export const getBytesInUse = async (keys) => await chrome.storage.sync.getBytesInUse(keys);
// Testing: Note, clear() test omitted - chrome.storage.sync.clear() would wipe ALL extension data
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual, containsKeyValuePairs } = runtime.testUtils;
	const results = (await Promise.all([
		runUnitTest("Set/Get string with clean API", async () => {
			await set({ testStr: "hello" });
			const actual = await get("testStr");
			return { actual, assert: strictEqual, expected: "hello" };
		}),
		runUnitTest("Set/Get number with clean API", async () => {
			await set({ testNum: 42 });
			const actual = await get("testNum");
			return { actual, assert: strictEqual, expected: 42 };
		}),
		runUnitTest("Set/Get boolean with clean API", async () => {
			await set({ testBool: true });
			const actual = await get("testBool");
			return { actual, assert: strictEqual, expected: true };
		}),
		runUnitTest("Set/Get complex object with clean API", async () => {
			const complex = { arr: [1, 2, 3], obj: { x: "y", n: 42 }, nullVal: null };
			await set({ testComplex: complex });
			const actual = await get("testComplex");
			return { actual, assert: deepEqual, expected: complex };
		}),
		runUnitTest("Set multiple keys, get single key", async () => {
			await set({ testM1: "v1", testM2: "v2", testM3: "v3" });
			const actual = await get("testM1");
			return { actual, assert: strictEqual, expected: "v1" };
		}),
		runUnitTest("Set multiple keys, get multiple keys", async () => {
			await set({ testM1: "v1", testM2: "v2", testM3: "v3" });
			const actual = await get(["testM1", "testM3"]);
			const expected = { testM1: "v1", testM3: "v3" };
			return { actual, assert: deepEqual, expected };
		}),
		runUnitTest("GetAll includes test data", async () => {
			await set({ testGA1: "val1", testGA2: "val2" });
			const actual = await getAll();
			const expected = { testGA1: "val1", testGA2: "val2" };
			return { actual, assert: containsKeyValuePairs, expected };
		}),
		runUnitTest("Remove single key", async () => {
			await set({ testR1: "delete", testR2: "keep" });
			await remove("testR1");
			const actual = await get(["testR1", "testR2"]);
			const expected = { testR2: "keep" };
			return { actual, assert: deepEqual, expected };
		}),
		runUnitTest("Remove multiple keys", async () => {
			await set({ testRM1: "delete1", testRM2: "delete2", testRM3: "keep" });
			await remove(["testRM1", "testRM2"]);
			const actual = await get(["testRM1", "testRM2", "testRM3"]);
			const expected = { testRM3: "keep" };
			return { actual, assert: deepEqual, expected };
		}),
		runUnitTest("Non-existent key returns undefined", async () => {
			const actual = await get("testMissing");
			return { actual, assert: strictEqual, expected: undefined };
		}),
		runUnitTest("Bytes in use with single key", async () => {
			await set({ testLarge: "x".repeat(1000) });
			const actual = await getBytesInUse("testLarge");
			return { actual, assert: (actual) => actual > 1000 };
		})
	])).flat();
	await cleanupTestData();
	return results;
};
const cleanupTestData = async () => await remove(Object.keys(await getAll()).filter(key => key.startsWith('test')) ?? []);