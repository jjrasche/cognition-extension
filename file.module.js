export const manifest = {
  name: "file",
  context: "extension-page",
  version: "1.0.0",
  description: "User-controlled file operations with directory handles and persistent permissions",
  permissions: ["storage"],
  dependencies: ["indexed-db"],
  actions: ["write", "read", "listDirs", "selectDir", "hasDir", "removeDir", "getFileHistory"],
  indexeddb: {
    name: 'FileHandlers',
    version: 1,
    storeConfigs: [
      { name: 'handles', options: { keyPath: 'id' } },
      { name: 'operations', options: { autoIncrement: true }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] }
    ]
  }
};
let runtime;
const dbName = manifest.indexeddb.name;
export const initialize = async (rt) => (runtime = rt);
// handle db
const getStoredHandle = async (name) => (await runtime.call('indexed-db.getRecord', { dbName, storeName: 'handles', key: `handle-${name}` })).handle || null;
const storeHandle = async (name, handle) => updateStoredHandle({ id: `handle-${name}`, name, handle, timestamp: new Date().toISOString(), directoryName: handle.name });
const removeStoredHandle = async (name) => await runtime.call('indexed-db.removeRecord', { dbName, storeName: 'handles', key: `handle-${name}` });
const getAllStoredHandleNames = async () => (await runtime.call('indexed-db.getAllRecords', { dbName, storeName: 'handles' })).map(handle => handle.name);
const updateStoredHandle = async (handleData) => await runtime.call('indexed-db.updateRecord', { dbName, storeName: 'handles', data: handleData });
// operations db
const saveFileOperation = async (data) => await runtime.call('indexed-db.addRecord', { dbName, storeName: 'operations', data });
// permissions
const getHandle = async (name) => {
  const handle = await getStoredHandle(name);
  if (!handle) throw new Error(`Directory '${name}' not selected. Call selectDir({name: '${name}'}) first.`);
  const currentPermission = await handle.queryPermission({ mode: 'readwrite' });
  if (currentPermission !== 'granted') {
    const newPermission = await handle.requestPermission({ mode: 'readwrite' });
    if (newPermission !== 'granted') runtime.logError(`Permission denied for directory '${name}'. Permission: ${newPermission}`);
  }
  return handle;
};
// logging
const logFileOperation = async (operation, dir, filename, size) => await saveFileOperation({ operation, directory: dir, filename, size, timestamp: new Date().toISOString() });
export const getFileHistory = async ({ limit = 10 } = {}) => await runtime.call('indexed-db.getByIndex', { dbName, storeName: 'operations', indexName: 'by-timestamp', limit, direction: 'prev' });
// file operations
const writeFile = async (writer, data) => (await writer.write(data), await writer.close());
const appendFile = async (writer, data, dir, filename ) => (await writer.write(readFile({ dir, filename }) + data), await writer.close());
const getFileHandle = async (dir, filename) => await (await getHandle(dir)).getFileHandle(filename, { create: true });
const getWriter = async (dir, filename) => await (await getFileHandle(dir, filename)).createWritable();
const readFile = async ({ dir, filename }) => await (await (await getFileHandle(dir, filename)).getFile()).text();

export const read = async ({ dir, filename }) => await readFile({ dir, filename }).catch(() => '');
export const write = async ({ dir, filename, data, append = false }) => {
  const writer = await getWriter(dir, filename);
  await (append ? appendFile(writer, data, dir, filename) : writeFile(writer, data));
  await logFileOperation(append ? 'append' : 'write', dir, filename, data.length);
};
// directory operations
export const listDirs = async () => await getAllStoredHandleNames();
export const hasDir = async ({ name }) => !!(await getHandle(name));
export const selectDir = async ({ name }) => await storeHandle(name, await window.showDirectoryPicker());
