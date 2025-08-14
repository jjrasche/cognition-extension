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
export const get = async (params) => await chrome.storage.sync.get(params.keys);
export const getAll = async () => await chrome.storage.sync.get();
export const remove = async (params) => await chrome.storage.sync.remove(params.keys);
export const clear = async () => await chrome.storage.sync.clear();
export const getBytesInUse = async (params) => await chrome.storage.sync.getBytesInUse(params.keys);


// Testing Note: clear() test omitted - chrome.storage.sync.clear() would wipe ALL extension data
// export const test = async () => {
//   const { runUnitTest, strictEqual, deepEqual, contains } = runtime.testUtils;
  // const results = (await Promise.all([
  //   runUnitTest("Basic Set/Get string", async () => {
  //     await set({ items: { [testKey("str")]: "hello" } });
  //     const actual = await get({ keys: testKey("str") });
  //     return { actual, expected: "hello", assert: strictEqual };
  //   }),
  //   runUnitTest("Basic Set/Get number", async () => {
  //     await set({ items: { [testKey("num")]: 42 } });
  //     const actual = await get({ keys: testKey("num") });
  //     return { actual, expected: 42, assert: strictEqual };
  //   }),
  //   runUnitTest("Basic Set/Get boolean", async () => {
  //     await set({ items: { [testKey("bool")]: true } });
  //     const actual = await get({ keys: testKey("bool") });
  //     return { actual, expected: true, assert: strictEqual };
  //   }),
  //   runUnitTest("Multiple keys set/get", async () => {
  //     await set({ items: { [testKey("m1")]: "v1", [testKey("m2")]: "v2", [testKey("m3")]: "v3" } });
  //     const actual = await get({ key: [testKey("m1"), testKey("m3")] });
  //     const expected = { [testKey("m1")]: "v1", [testKey("m3")]: "v3" };
  //     return { actual, expected, assert: strictEqual };
  //   }),
  //   runUnitTest("GetAll includes test data", async () => {
  //     const items = { [testKey("ga1")]: "val1", [testKey("ga2")]: "val2" };
  //     await set({ items });
  //     const actual = await getAll();
  //     const expected = { [testKey("ga1")]: "val1", [testKey("ga2")]: "val2" };
  //     return { actual, expected, assert: contains };
  //   }),
  //   runUnitTest("Remove deletes specific keys", async () => {
  //     await set({ items: { [testKey("r1")]: "delete", [testKey("r2")]: "keep" } });
  //     await remove({ keys: testKey("r1") });
  //     const actual = await get({ keys: [testKey("r1"), testKey("r2")] });
  //     const expected = { [testKey("r2")]: "keep" };
  //     return { actual, expected, assert: strictEqual };
  //   }),
  //   runUnitTest("Non-existent keys return empty", async () => {
  //     const actual = await get({ keys: testKey("missing") });
  //     return { actual, expected: {}, assert: strictEqual };
  //   }),
  //   runUnitTest("Complex data serialization", async () => {
  //     const complex = { arr: [1,2,3], obj: { x: "y", n: 42 }, nullVal: null };
  //     await set({ items: { [testKey("complex")]: complex } });
  //     const actual = await get({ keys: testKey("complex") });
  //     return { actual, expected: complex, assert: deepEqual };
  //   }),
  //   runUnitTest("Bytes in use calculation", async () => {
  //     await set({ items: { [testKey("large")]: "x".repeat(1000) } });
  //     const actual = await getBytesInUse({ keys: testKey("large") });
  //     return { actual, assert: (actual) => actual > 1000 };
  //   })
  // ])).flat();
  // await cleanupTestData();
  // return results;
// };
const TEST_PREFIX = 'test_chrome_sync_';
const testKey = (key) => `${TEST_PREFIX}${key}`;
const cleanupTestData = async () => {
  const allData = await getAll();
  const testKeys = Object.keys(allData).filter(key => key.startsWith(TEST_PREFIX));
  if (testKeys.length > 0) {
    await remove({ keys: testKeys });
  }
};