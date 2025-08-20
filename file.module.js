export const manifest = {
  name: "file",
  context: ["extension-page"],
  version: "1.0.0",
  description: "User-controlled file operations with directory handles and persistent permissions",
  permissions: ["storage"],
  dependencies: ["indexed-db", "tab"],
  actions: ["write", "read", "append", "remove", "listDirs", "hasDir", "getFileHistory", "getAllHandles", "deleteAllHandles", "deleteHandle",],
  indexeddb: {
    name: 'FileHandlers',
    version: 1,
    storeConfigs: [
      { name: 'handles', options: { keyPath: 'id' }, indexes: [{ name: 'by-id', keyPath: 'id', options: { unique: true } }] },
      { name: 'operations', options: { autoIncrement: true }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] }
    ]
  }
};
let runtime, db;
export const initialize = async (rt) => {
  runtime = rt;
  db = await getDB();
  registerModuleDirectories();
};

const getModuleRequiredDirectories = () => [...new Set(runtime.getModulesWithProperty('requiredDirectories').flatMap(module => module.manifest.requiredDirectories || []))]
const registerModuleDirectories = async () => getModuleRequiredDirectories()
    .filter(async dirName => !(await hasDir({name: dirName})))
    .forEach(async dirName => await getHandle(dirName));

// handle db
const getDB = async () => await runtime.call('indexed-db.openDb', manifest.indexeddb);
const storeHandle = async (name, handle) => updateHandle({ id: `handle-${name}`, name, handle, timestamp: new Date().toISOString(), directoryName: handle.name });
export const getAllHandles = async () => await runtime.call('indexed-db.getAllRecords', { db, storeName: 'handles' });
const updateHandle = async (handleData) => await runtime.call('indexed-db.updateRecord', { db, storeName: 'handles', data: handleData });
// operations db
const saveFileOperation = async (data) => await runtime.call('indexed-db.addRecord', { db, storeName: 'operations', data });
// permissions
const getHandle = async (name) => {
  const storedHandle = (await runtime.call('indexed-db.getRecord', { db, storeName: 'handles', key: `handle-${name}` }))
  let handle = storedHandle?.handle ?? await selectDir();
  await verifyPermission(name, handle);
  await storeHandle(name, handle);
  return handle;
};
const verifyPermission = async (name, handle) => {
  const currentPermission = await handle.queryPermission({ mode: 'readwrite' });
  if (currentPermission !== 'granted') {
    const newPermission = await handle.requestPermission({ mode: 'readwrite' });
    if (newPermission !== 'granted') runtime.logError(`Permission denied for directory '${name}'. Permission: ${newPermission}`);
  }
}
// logging
const logFileOperation = async ({operation, dir, filename, size}) => await saveFileOperation({ operation, directory: dir, filename, size, timestamp: new Date().toISOString() });
export const getFileHistory = async ({ limit = 10 } = {}) => await runtime.call('indexed-db.getByIndex', { db, storeName: 'operations', indexName: 'by-timestamp', limit, direction: 'prev' });
// handles
const getFileHandle = async ({dir, filename}) => await (await getHandle(dir)).getFileHandle(filename, { create: true });
export const deleteAllHandles = async () => (await getAllHandles()).forEach(async handle => deleteHandle(handle.id));
export const deleteHandle = async (key) => await runtime.call('indexed-db.removeRecord', { db, storeName: 'handles', key });
// file operations
const getFile = async ({ dir, filename }) => await (await getFileHandle({ dir, filename })).getFile();
const getWriter = async ({ dir, filename }) => await (await getFileHandle({ dir, filename })).createWritable();
export const read = async (params) => {
  const file = await getFile(params);
  const content = await file.text();
  return content;
};
export const write = async ({ dir, filename, data }) => {
  const writer = await getWriter({ dir, filename });
  await writer.write(data);
  await writer.close();
  await logFileOperation({ operation: 'write', dir, filename, size: data.length });
};
export const append = async ({ dir, filename, data }) => {
  const writer = await getWriter({ dir, filename });
  const content = await read({ dir, filename });
  await writer.write(content + data);
  await writer.close();
  await logFileOperation({ operation: 'append', dir, filename, size: data.length });
};
export const remove = async ({ dir, filename }) => await (await getFileHandle({ dir, filename })).remove();
// directory operations
const selectDir = async () => {
  await window["showDirectoryPicker"]();
  await runtime.call('tab.focusExtensionPage');
};
export const listDirs = async () => (await getAllHandles()).map(handle => handle.name);
export const hasDir = async ({ name }) => !!(await getHandle(name));







// tests
import { wait } from './helpers.js';
const dir = 'Documents';


export const test = async () => {
  const { runUnitTest, strictEqual, deepEqual, containsKeyValuePairs } = runtime.testUtils;
  return (await Promise.all([
    runUnitTest("test file write", async () => {
      const params = { dir, filename: 'test-write.txt', data: 'Test Write' }; // arrange
      await write(params); // act
      const actual = await read(params);
      cleanupTestFile(params);
      return { actual , assert: strictEqual, expected: params.data }; // assert
    }),
    runUnitTest("test file read", async () => {
      const params = { dir, filename: 'test-read.txt', data: 'Test Read' };
      await write({ ...params }); // arrange
      const actual = await read(params);  // act
      cleanupTestFile(params);
      return { actual , assert: strictEqual, expected: params.data }; // assert
    }),
    runUnitTest("test file append", async () => {
      const params = { dir, filename: 'test-append.txt' };
      await write({ ...params, data: 'Initial' });
      await wait(100);  // arrange
      await append({ ...params, data: ' Appended' }); // act
      const actual = await read(params);
      cleanupTestFile(params);
      return { actual , assert: strictEqual, expected: 'Initial Appended' }; // assert
    })
  ])).flat();
};
const cleanupTestFile = async ({ dir, filename }) => await remove({ dir, filename });
