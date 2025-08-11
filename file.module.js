export const manifest = {
  name: "file",
  context: "extension-page",
  version: "1.0.0",
  description: "User-controlled file operations with directory handles and persistent permissions",
  permissions: ["storage"],
  dependencies: ["indexed-db"],
  actions: ["write", "read", "listDirs", "deleteAllHandles", "deleteHandle", "hasDir", "getFileHistory", "deleteFile"],
  tests: ["testFileWrite", "testFileRead", "testFileAppend"],//, "testDirectoryHandling"]
  indexeddb: {
    name: 'FileHandlers',
    version: 1,
    storeConfigs: [
      { name: 'handles', options: { autoIncrement: true } },
      { name: 'operations', options: { autoIncrement: true }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] }
    ]
  }
};
let runtime, db;
export const initialize = async (rt) => (runtime = rt, db = await getDB());
// handle db
const getDB = async () => await runtime.call('indexed-db.openDb', manifest.indexeddb);
const getStoredHandle = async (name) => (await runtime.call('indexed-db.getRecord', { db, storeName: 'handles', key: `handle-${name}` }));
const storeHandle = async (name, handle) => updateStoredHandle({ id: `handle-${name}`, name, handle, timestamp: new Date().toISOString(), directoryName: handle.name });
const getAllStoredHandles = async () => await runtime.call('indexed-db.getAllRecords', { db, storeName: 'handles' });
const updateStoredHandle = async (handleData) => await runtime.call('indexed-db.updateRecord', { db, storeName: 'handles', data: handleData });
// operations db
const saveFileOperation = async (data) => await runtime.call('indexed-db.addRecord', { db, storeName: 'operations', data });
// permissions
const getHandle = async (name) => {
  let handle = await getStoredHandle(name);
  handle = (!handle ? (await selectDir({ name })) : handle).handle;
  await verifyPermisssion(name, handle);
  return handle;
};
const verifyPermisssion = async (name, handle) => {
  const currentPermission = await handle.queryPermission({ mode: 'readwrite' });
  if (currentPermission !== 'granted') {
    const newPermission = await handle.requestPermission({ mode: 'readwrite' });
    if (newPermission !== 'granted') runtime.logError(`Permission denied for directory '${name}'. Permission: ${newPermission}`);
  }
}
// logging
const logFileOperation = async (operation, dir, filename, size) => await saveFileOperation({ operation, directory: dir, filename, size, timestamp: new Date().toISOString() });
export const getFileHistory = async ({ limit = 10 } = {}) => await runtime.call('indexed-db.getByIndex', { db, storeName: 'operations', indexName: 'by-timestamp', limit, direction: 'prev' });
// file operations
const writeFile = async (writer, data) => (await writer.write(data), await writer.close());
const appendFile = async (writer, data, dir, filename ) => (await writer.write(readFile({ dir, filename }) + data), await writer.close());
const getFileHandle = async (dir, filename) => await (await getHandle(dir)).getFileHandle(filename, { create: true });
const getWriter = async (dir, filename) => await (await getFileHandle(dir, filename)).createWritable();
const readFile = async ({ dir, filename }) => await (await (await getFileHandle(dir, filename)).getFile()).text();
const deleteFile = async (dir, filename) => await (await getFileHandle(dir, filename)).remove();

export const read = async ({ dir, filename }) => await readFile({ dir, filename }).catch(() => { throw new Error(`File '${filename}' not found in directory '${dir}'`); });
export const write = async ({ dir, filename, data, append = false }) => {
  const writer = await getWriter(dir, filename);
  await (append ? appendFile(writer, data, dir, filename) : writeFile(writer, data));
  await logFileOperation(append ? 'append' : 'write', dir, filename, data.length);
};
// directory operations
export const listDirs = async () => (await getAllStoredHandles()).map(handle => handle.name);
export const hasDir = async ({ name }) => !!(await getHandle(name));
const selectDir = async ({ name }) => {
  const handle = await window.showDirectoryPicker();
  await storeHandle(name, handle);
  return handle;
};
export const deleteAllHandles = async () => (await getAllStoredHandles()).forEach(async handle => deleteHandle(handle.id));
export const deleteHandle = async (key) => await runtime.call('indexed-db.removeRecord', { db, storeName: 'handles', key });



// tests

export const testFileWrite = async () => {
  const params = { dir: 'Documents', filename: 'test-write.txt', data: 'Test Write' };
  const expect = async () => (await read({ dir: params.dir, filename: params.filename })) === params.data;
  return [await runTest(write, { ...params, expect })];
};

export const testFileRead = async () => {
  const params = { dir: 'Documents', filename: 'test-read.txt' };
  await write({ ...params, data: 'Test Read' });
  const expect = async (result) => result === 'Test Read';
  return [await runTest(read, { ...params, expect })];
};

export const testFileAppend = async () => {
  const params = { dir: 'Documents', filename: 'test-append.txt' };
  await write({ ...params, data: 'Initial' });
  const expect = async () => (await read(params)) === 'Initial Appended';
  return [await runTest(write, { ...params, data: ' Appended', append: true, expect })];
};

const runTest = async (fn, params) => {
  const name = `${fn.name} file`;
  try {
    const result = await fn(params);
    return { name, passed: await params.expect(result), result };
  } catch (error) { return { name, passed: false, error }; }
  finally { await cleanupTestFile(params.dir, params.filename); }
};

const cleanupTestFile = async (dir, filename) => await deleteFile(dir, filename)

export const testDirectoryHandling = async () => {
  // Manual intervention required
  const results = [{ passed: true, message: "Manual test - requires user directory selection", error: null }];
  // ... rest of directory testing
  return results;
};