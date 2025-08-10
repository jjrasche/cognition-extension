export const manifest = {
    name: "indexed-db",
    context: ["service-worker", "offscreen"],
    version: "1.0.0",
    description: "Generic IndexedDB operations extracted from graph-db",
    permissions: [],
    actions: ["openDb", "addRecord", "getRecord", "getAllRecords", "removeRecord", "updateRecord", "getByIndex", "countRecords", "getNextId", "deleteDB"],
};

let runtime;
export const initialize = async (rt) => (runtime = rt);
// Database management
export const openDb = async (params) => {
    const { name, version, storeConfigs } = params;
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => initializeDatabase(event.target.result, storeConfigs);
    });
    return db;
};
const initializeDatabase = (db, storeConfigs) => storeConfigs.forEach(config => createStoreWithIndexes(db, config));
const createStoreWithIndexes = (db, config) => {
    if (db.objectStoreNames.contains(config.name)) return;
    const store = db.createObjectStore(config.name, config.options);
    config.indexes?.forEach(idx => store.createIndex(idx.name, idx.keyPath, idx.options));
};
// Record operations
export const addRecord = async (params) => await promisify(getStore(params, 'readwrite').add(params.data));
export const updateRecord = async (params) => await promisify(getStore(params, 'readwrite').put(params.data));
export const getRecord = async (params) => await promisify(getStore(params, 'readonly').get(params.key));
export const getAllRecords = async (params) => await promisify(getStore(params, 'readonly').getAll());
export const removeRecord = async (params) => await promisify(getStore(params, 'readwrite').delete(params.key));
export const countRecords = async (params) => await promisify(getStore(params, 'readonly').count());
export const getByIndex = async (params) => {
    const { indexName, value, limit } = params;
    const index = getStore(params).index(indexName);
    if (limit) return await iterateCursor(index.openCursor(value ? IDBKeyRange.only(value) : null), () => true, limit);
    return await promisify(index.getAll(value ? IDBKeyRange.only(value) : null));
};
// Utilities (extracted from your graph-db)
const getStore = (params, mode = 'readonly') => params.db.transaction([params.storeName], mode).objectStore(params.storeName);
const promisify = (req) => new Promise((resolve, reject) => (req.onsuccess = () => resolve(req.result), req.onerror = () => reject(req.error)));
const iterateCursor = async (cursorRequest, callback, limit = Infinity) => {
    const results = [];
    return new Promise((resolve, reject) => {
        cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && results.length < limit) {
                const shouldContinue = callback(cursor.value, cursor);
                if (shouldContinue !== false) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            } else {
                resolve(results);
            }
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
    });
};



export const deleteDB = () => {
  return new Promise((resolve, reject) => {
    const deleteReq = indexedDB.deleteDatabase('CognitionGraph');
    deleteReq.onsuccess = () => {
      console.log('✅ CognitionGraph database deleted successfully');
      resolve();
    };
    deleteReq.onerror = () => {
      console.error('❌ Failed to delete database:', deleteReq.error);
      reject(deleteReq.error);
    };
    deleteReq.onblocked = () => {
      console.warn('⚠️ Database deletion blocked - close all tabs using this database');
    };
  });
};