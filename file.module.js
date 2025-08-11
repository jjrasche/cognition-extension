export const manifest = {
  name: "file",
  context: "extension-page",
  version: "1.0.0",
  description: "User-controlled file operations with directory handles and persistent permissions",
  permissions: ["storage"],
  dependencies: ["indexed-db"],
  actions: ["write", "read", "append", "remove", "listDirs", "hasDir", "getFileHistory", "getAllHandles", "deleteAllHandles", "deleteHandle",],
  tests: ["testFileWrite", "testFileRead", "testFileAppend"],//, "testDirectoryHandling"]
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
export const initialize = async (rt) => (runtime = rt, db = await getDB());
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
const logFileOperation = async (operation, dir, filename, size) => await saveFileOperation({ operation, directory: dir, filename, size, timestamp: new Date().toISOString() });
export const getFileHistory = async ({ limit = 10 } = {}) => await runtime.call('indexed-db.getByIndex', { db, storeName: 'operations', indexName: 'by-timestamp', limit, direction: 'prev' });
// hanldes
const getFileHandle = async (dir, filename) => await (await getHandle(dir)).getFileHandle(filename, { create: true });
export const deleteAllHandles = async () => (await getAllHandles()).forEach(async handle => deleteHandle(handle.id));
export const deleteHandle = async (key) => await runtime.call('indexed-db.removeRecord', { db, storeName: 'handles', key });
// file operations
const getFile = async (dir, filename) => await (await getFileHandle(dir, filename)).getFile();
const getWriter = async (dir, filename) => await (await getFileHandle(dir, filename)).createWritable();
export const read = async ({ dir, filename }) => (await getFile({ dir, filename })).text()
export const write = async ({ dir, filename, data }) => {
  const writer = await getWriter(dir, filename);
  await writer.write(data);
  await writer.close();
  await logFileOperation('write', dir, filename, data.length);
};
export const append = async ({ dir, filename, data }) => {
  const writer = await getWriter(dir, filename);
  const content = await read({ dir, filename })
  await writer.write(content + data);
  await writer.close();
  await logFileOperation('append', dir, filename, data.length);
};
export const remove = async (dir, filename) => await (await getFileHandle(dir, filename)).remove();
// directory operations
const selectDir = async () =>  await window.showDirectoryPicker();
export const listDirs = async () => (await getAllHandles()).map(handle => handle.name);
export const hasDir = async ({ name }) => !!(await getHandle(name));







// tests
export const promptForTestHandle = async () => await runtime.call('ui.renderForm', {
  title: "File Module Tests",
  tree: { "test-btn": { tag: "button", text: "Run File Tests (will prompt for directory if needed)" } },
  onSubmit: "file.runFileTests"
});

// // Updated runFileTests to handle directory setup
// export const runFileTests = async () => {
//   await ensureTestDirectory();
//   const tests = [testFileWrite, testFileRead, testFileAppend];//, testDirectoryHandling];
//   return (await Promise.all(tests.map(test => test()))).flat();
// };

// // New helper function to ensure directory access
// const ensureTestDirectory = async () => {
//     const handle = await getHandle('Documents');
// };

import { wait } from './helpers.js';
export const testFileWrite = async () => {
  const params = { dir: '', filename: 'test-write.txt', data: 'Test Write' };
  const expect = async () => (await read({ dir: params.dir, filename: params.filename })) === params.data;
  return [await runTest(write, { ...params, expect })];
};
export const testFileRead = async () => {
  const params = { dir: '', filename: 'test-read.txt' };
  await write({ ...params, data: 'Test Read' });
  const expect = async (result) => result === 'Test Read';
  return [await runTest(read, { ...params, expect })];
};
export const testFileAppend = async () => {
  const params = { dir: '', filename: 'test-append.txt' };
  await write({ ...params, data: 'Initial' });
  await wait(100);
  const expect = async () => {
    await wait(100);
    const actual = await read(params)
    return actual === 'Initial Appended';
  }
  return [await runTest(append, { ...params, data: ' Appended', expect })];
};
const runTest = async (fn, params) => {
  const name = `${params.name} file`;
  try {
    const result = await fn(params);
    return { name, passed: await params.expect(result), result };
  } catch (error) { return { name, passed: false, error }; }
  finally { await cleanupTestFile(params.dir, params.filename); }
};
const cleanupTestFile = async (dir, filename) => await remove(dir, filename)
export const testDirectoryHandling = async () => {
  // Manual intervention required
  const results = [{ passed: true, message: "Manual test - requires user directory selection", error: null }];
  // ... rest of directory testing
  return results;
};