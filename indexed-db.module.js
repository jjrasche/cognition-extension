export const manifest = {
    name: "indexed-db",
    context: "service-worker",
    version: "1.0.0",
    description: "Generic IndexedDB operations extracted from graph-db",
    permissions: [],
    actions: ["openDb", "addRecord", "getRecord", "getAllRecords", "removeRecord", "updateRecord", "getByIndex", "countRecords", "getNextId"],
};

const databases = new Map();
export const initialize = async () => {};

// Database management
export const openDb = async (params) => {
    const { name, version, storeConfigs } = params;
    if (databases.has(name)) return databases.get(name);
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => initializeDatabase(event.target.result, storeConfigs);
    });
    databases.set(name, db);
};
const initializeDatabase = (db, storeConfigs) => storeConfigs.forEach(config => createStoreWithIndexes(db, config));
const createStoreWithIndexes = (db, config) => {
    if (db.objectStoreNames.contains(config.name)) return;
    const store = db.createObjectStore(config.name, config.options);
    config.indexes?.forEach(idx => store.createIndex(idx.name, idx.keyPath, idx.options));
};
// Record operations
export const addRecord = async (params) => {
    const { dbName, storeName, data } = params;
    const db = databases.get(dbName);
    return await promisify(getStore(db, storeName, 'readwrite').add(data));
};
export const updateRecord = async (params) => {
    const { dbName, storeName, data } = params;
    const db = databases.get(dbName);
    return await promisify(getStore(db, storeName, 'readwrite').put(data));
};
export const getRecord = async (params) => {
    const { dbName, storeName, key } = params;
    const db = databases.get(dbName);
    return await promisify(getStore(db, storeName).get(key));
};
export const getAllRecords = async (params) => {
    const { dbName, storeName } = params;
    const db = databases.get(dbName);
    return await promisify(getStore(db, storeName).getAll());
};
export const removeRecord = async (params) => {
    const { dbName, storeName, key } = params;
    const db = databases.get(dbName);
    await promisify(getStore(db, storeName, 'readwrite').delete(key));
    return { success: true };
};
export const getByIndex = async (params) => {
    const { dbName, storeName, indexName, value, limit } = params;
    const db = databases.get(dbName);
    const index = getStore(db, storeName).index(indexName);
    
    if (limit) return await iterateCursor(index.openCursor(value ? IDBKeyRange.only(value) : null), () => true, limit);
    return await promisify(index.getAll(value ? IDBKeyRange.only(value) : null));
};
export const countRecords = async (params) => {
    const { dbName, storeName } = params;
    const db = databases.get(dbName);
    return await promisify(getStore(db, storeName).count());
};
export const getNextId = async (params) => {
    const { dbName, type } = params;
    const db = databases.get(dbName);
    const store = getStore(db, 'counters', 'readwrite');
    const current = (await promisify(store.get(type))) || 0;
    const next = current + 1;
    await promisify(store.put(next, type));
    return `${type}-${next}`;
};
// Utilities (extracted from your graph-db)
const getStore = (db, storeName, mode = 'readonly') => db.transaction([storeName], mode).objectStore(storeName);
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