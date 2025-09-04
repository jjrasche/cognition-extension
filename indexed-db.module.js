export const manifest = {
	name: "indexed-db",
	context: ["service-worker", "extension-page", "offscreen"],
	version: "1.0.0",
	description: "Generic IndexedDB operations extracted from graph-db",
	permissions: [],
	actions: ["createDB", "addRecord", "getRecord", "getAllRecords", "removeRecord", "updateRecord", "getByIndex", "getByIndexCursor", "countRecords", "getNextId", "deleteDB", "getAllDatabases"],
};

let runtime, DBs = new Map();
export const initialize = async (rt) => (runtime = rt, await registerModules());

// Database management
const registerModules = async () => await Promise.all(runtime.getModulesWithProperty('indexeddb')
	.map(async m => {
		await createDB(m.manifest.indexeddb);
		runtime.log(`✅ ${m.manifest.name} database created successfully`);
	}));
export const createDB = async ({ name, version, storeConfigs }) => DBs.set(name, await new Promise((resolve, reject) => {
	const request = indexedDB.open(name, version);
	request.onerror = () => reject(request.error);
	request.onsuccess = () => resolve(request.result);
	request.onupgradeneeded = (event) => initializeDatabase(event, storeConfigs);
}));
const initializeDatabase = (event, storeConfigs) => storeConfigs.forEach(config => createStoreWithIndexes(event.target.result, config));
const createStoreWithIndexes = (db, config) => {
	if (db.objectStoreNames.contains(config.name)) return;
	const store = db.createObjectStore(config.name, config.options);
	config.indexes?.forEach(idx => store.createIndex(idx.name, idx.keyPath, idx.options));
};
// Record operations
export const addRecord = async (dbName, storeName, data) => await promisify(getStore(dbName, storeName, 'readwrite').add(data));
export const addRecordWithId = async (dbName, storeName, data) => {
	const key = await addRecord(dbName, storeName, data);
	return await updateRecord(dbName, storeName, { ...data, id: key });
};
export const updateRecord = async (dbName, storeName, data) => await promisify(getStore(dbName, storeName, 'readwrite').put(data));
export const getRecord = async (dbName, storeName, key) => await promisify(getStore(dbName, storeName, 'readonly').get(key));
export const getAllRecords = async (dbName, storeName) => await promisify(getStore(dbName, storeName, 'readonly').getAll());
export const removeRecord = async (dbName, storeName, key) => await promisify(getStore(dbName, storeName, 'readwrite').delete(key));
export const countRecords = async (dbName, storeName) => await promisify(getStore(dbName, storeName, 'readonly').count());

export const getByIndexCursor = async (dbName, storeName, indexName, direction = 'next', limit = Infinity) => {
	const index = getStore(dbName, storeName).index(indexName);
	return await iterateCursor(index.openCursor(null, direction), () => true, limit);
};
export const getByIndex = async (dbName, storeName, indexName, value) => {
	const index = getStore(dbName, storeName).index(indexName);
	return await promisify(index.getAll(value ? IDBKeyRange.only(value) : null));
};

// export const getByIndex = async (dbName, storeName, indexName, value, limit) => {
// 	const index = getStore(dbName, storeName).index(indexName);
// 	if (limit) return await iterateCursor(index.openCursor(value ? IDBKeyRange.only(value) : null), () => true, limit);
// 	return await promisify(index.getAll(value ? IDBKeyRange.only(value) : null));
// };
// Utilities
const getStore = (dbName, storeName, mode = 'readonly') => DBs.get(dbName).transaction([storeName], mode).objectStore(storeName);
const promisify = (req) => new Promise((resolve, reject) => (req.onsuccess = () => resolve(req.result), req.onerror = () => reject(req.error)));
const iterateCursor = async (cursorRequest, callback, limit = Infinity) => {
	const results = [];
	return new Promise((resolve, reject) => {
		cursorRequest.onsuccess = (event) => {
			const cursor = event.target.result;
			if (cursor && results.length < limit) {
				const shouldContinue = callback(cursor.value, cursor);
				if (shouldContinue !== false) { results.push(cursor.value); cursor.continue(); }
				else { resolve(results); }
			} else { resolve(results); }
		};
		cursorRequest.onerror = () => reject(cursorRequest.error);
	});
};
export const deleteDB = (name) => {
	return new Promise((resolve, reject) => {
		const deleteReq = indexedDB.deleteDatabase(name);
		deleteReq.onsuccess = () => (runtime.log(`✅ ${name} database deleted successfully`, deleteReq), resolve(true));
		deleteReq.onerror = () => (runtime.logError(`❌ Failed to delete ${name} database:`, deleteReq.error), reject(deleteReq.error));
		deleteReq.onblocked = () => runtime.logError(`⚠️ ${name} database deletion blocked - close all tabs using this database`);
	});
};
export const getAllDatabases = async () => 'databases' in indexedDB ? (await indexedDB.databases()).map(db => ({ name: db.name, version: db.version })) : [];