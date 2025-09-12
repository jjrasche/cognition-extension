export const manifest = {
	name: "chrome-local",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Centralized Chrome local storage operations",
	permissions: ["storage"],
	actions: ["set", "get", "getAll", "remove", "clear", "getBytesInUse"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const set = async (items) => await chrome.storage.local.set(items);
export const get = async (keys) => {
	const result = await chrome.storage.local.get(keys);
	return typeof keys === 'string' ? result[keys] : result;
};
export const getAll = async () => await chrome.storage.local.get();
export const remove = async (keys) => await chrome.storage.local.remove(keys);
export const clear = async () => await chrome.storage.local.clear();
export const getBytesInUse = async (keys) => await chrome.storage.local.getBytesInUse(keys);


export const append = async (key, value, maxEntries) => {
	const current = (await get(key)) || [];
	const updated = [...current, value];
	const final = maxEntries ? updated.slice(-maxEntries) : updated;
	await set({ [key]: final });
	return final.length;
};

export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual, containsKeyValuePairs } = runtime.testUtils;
	const results = (await Promise.all([
		runUnitTest("Set/Get string with clean API", async () => {
			await set({ testLocalStr: "hello" });
			const actual = await get("testLocalStr");
			return { actual, assert: strictEqual, expected: "hello" };
		}),
		runUnitTest("Set/Get number with clean API", async () => {
			await set({ testLocalNum: 42 });
			const actual = await get("testLocalNum");
			return { actual, assert: strictEqual, expected: 42 };
		}),
		runUnitTest("Set/Get boolean with clean API", async () => {
			await set({ testLocalBool: true });
			const actual = await get("testLocalBool");
			return { actual, assert: strictEqual, expected: true };
		}),
		runUnitTest("Set/Get complex object with clean API", async () => {
			const complex = { arr: [1, 2, 3], obj: { x: "y", n: 42 }, nullVal: null };
			await set({ testLocalComplex: complex });
			const actual = await get("testLocalComplex");
			return { actual, assert: deepEqual, expected: complex };
		}),
		runUnitTest("Set multiple keys, get single key", async () => {
			await set({ testLocalM1: "v1", testLocalM2: "v2", testLocalM3: "v3" });
			const actual = await get("testLocalM1");
			return { actual, assert: strictEqual, expected: "v1" };
		}),
		runUnitTest("Set multiple keys, get multiple keys", async () => {
			await set({ testLocalM1: "v1", testLocalM2: "v2", testLocalM3: "v3" });
			const actual = await get(["testLocalM1", "testLocalM3"]);
			const expected = { testLocalM1: "v1", testLocalM3: "v3" };
			return { actual, assert: deepEqual, expected };
		}),
		runUnitTest("GetAll includes test data", async () => {
			await set({ testLocalGA1: "val1", testLocalGA2: "val2" });
			const actual = await getAll();
			const expected = { testLocalGA1: "val1", testLocalGA2: "val2" };
			return { actual, assert: containsKeyValuePairs, expected };
		}),
		runUnitTest("Remove single key", async () => {
			await set({ testLocalR1: "delete", testLocalR2: "keep" });
			await remove("testLocalR1");
			const actual = await get(["testLocalR1", "testLocalR2"]);
			const expected = { testLocalR2: "keep" };
			return { actual, assert: deepEqual, expected };
		}),
		runUnitTest("Remove multiple keys", async () => {
			await set({ testLocalRM1: "delete1", testLocalRM2: "delete2", testLocalRM3: "keep" });
			await remove(["testLocalRM1", "testLocalRM2"]);
			const actual = await get(["testLocalRM1", "testLocalRM2", "testLocalRM3"]);
			const expected = { testLocalRM3: "keep" };
			return { actual, assert: deepEqual, expected };
		}),
		runUnitTest("Non-existent key returns undefined", async () => {
			const actual = await get("testLocalMissing");
			return { actual, assert: strictEqual, expected: undefined };
		}),
		runUnitTest("Bytes in use with single key", async () => {
			await set({ testLocalLarge: "x".repeat(1000) });
			const actual = await getBytesInUse("testLocalLarge");
			return { actual, assert: (actual) => actual > 1000 };
		}),
		runUnitTest("Large data storage test", async () => {
			const largeData = { data: "x".repeat(100000) }; // 100KB
			await set({ testLocalHuge: largeData });
			const actual = await get("testLocalHuge");
			return { actual, assert: deepEqual, expected: largeData };
		}),
		runUnitTest("Append to new key creates array", async () => {
			await append("testAppendNew", "first");
			const actual = await get("testAppendNew");
			return { actual, assert: deepEqual, expected: ["first"] };
		}),
		runUnitTest("Append to existing array", async () => {
			await set({ testAppendExist: ["existing"] });
			await append("testAppendExist", "new");
			const actual = await get("testAppendExist");
			return { actual, assert: deepEqual, expected: ["existing", "new"] };
		}),
		runUnitTest("Append respects maxEntries limit", async () => {
			await set({ testAppendLimit: ["1", "2", "3"] });
			await append("testAppendLimit", "4", 3);
			const actual = await get("testAppendLimit");
			return { actual, assert: deepEqual, expected: ["2", "3", "4"] };
		})
	])).flat();
	await cleanupTestData();
	return results;
};

const cleanupTestData = async () => await remove(Object.keys(await getAll()).filter(key => key.startsWith('testLocal') || key.startsWith('testAppend')) ?? []);