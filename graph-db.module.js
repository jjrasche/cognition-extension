export const manifest = {
    name: "graph-db",
    version: "1.0.0",
    description: "Graph database for storing knowledge and relationships",
    permissions: ["storage"],
    actions: ["addInferenceNode", "getNode", "getRecentNodes", "findSimilarNodes", "searchByText", "getConnectedNodes"],
    state: { reads: [], writes: ["graph.stats"] }
};

let _state, _db;
const similiarityThreshold = 0.7;
const [DB_NAME, DB_VERSION, NODES_STORE, EDGES_STORE, COUNTERS_STORE] = ['CognitionGraph', 1, 'nodes', 'edges', 'counters'];
export const initialize = async (state) => ([_state, _db] = [state, await openDatabase()], updateStats());

export const addInferenceNode = async (params) => {
    const { userPrompt, assembledPrompt, response, model, context } = params;
    const node = { id: getNextId('inference'), timestamp: new Date().toISOString(), userPrompt, assembledPrompt, response, model, context, embedding: null };
    await getStore(NODES_STORE).add(node);
    generateEmbedding(assembledPrompt).then(embedding => updateNodeEmbedding(node.id, embedding));
    updateStats();
    return node.id;
};

export const findSimilarNodes = async (params) => {
    const { nodeId, threshold = similiarityThreshold } = params;
    const sourceNode = await getNodeById(nodeId);
    if (!sourceNode?.embedding) return { success: false, error: 'Node not found or no embedding' };;
    return (await getAllNodesWithEmbeddings())
        .filter(node => node.id !== nodeId)
        .map(node => ({ ...node, similarity: cosineSimilarity(sourceNode.embedding, node.embedding)}))
        .filter(node => node.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity);
};

export const searchByText = async (params) => {
    const { text, threshold = 0.5 } = params;
    const embedding = await generateEmbedding(text);
    const ret = (await getAllNodesWithEmbeddings()).map(node => ({ node, similarity: cosineSimilarity(embedding, node.embedding) }))
        .filter(({ similarity }) => similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .map(({ node }) => node);
    return ret;
};

export const getConnectedNodes = async (params) => {
    const { nodeId, direction = 'both' } = params;
    const edges = [];
    const nodeIds = new Set();
    if (direction === 'outgoing' || direction === 'both') await iterateCursor(getIndex(EDGES_STORE, 'by-from').openCursor(IDBKeyRange.only(nodeId)),
        (edge) => (edges.push(edge), nodeIds.add(edge.to)));
    if (direction === 'incoming' || direction === 'both') await iterateCursor(getIndex(EDGES_STORE, 'by-to').openCursor(IDBKeyRange.only(nodeId)),
        (edge) => (edges.push(edge), nodeIds.add(edge.from)));
    
    const nodes = await Promise.all([...nodeIds].map(id => getNodeById(id)));
    return nodes.filter(Boolean);
};

// stats
const getStats = async () => {
    const tx = _db.transaction([NODES_STORE, EDGES_STORE], 'readonly');
    const nodeCount = await promisify(tx.objectStore(NODES_STORE).count());
    const edgeCount = await promisify(tx.objectStore(EDGES_STORE).count());
    return { nodeCount, edgeCount, lastUpdated: new Date().toISOString() };
};
const updateStats = async () => await _state.write('graph.stats', await getStats());
// Node methods
export const getNode = async (params) => getNodeById(params.nodeId);
const getNodeById = async (nodeId) => await promisify(getStore(NODES_STORE).get(nodeId));
export const getRecentNodes = async (params) => await getRecentNodesInternal(params?.limit || 20);
const getRecentNodesInternal = async (limit) => await iterateCursor(getIndex(NODES_STORE, 'by-timestamp').openCursor(null, 'prev'), () => true, limit);
const getAllNodesWithEmbeddings = async () => (await promisify(getStore(NODES_STORE).getAll())).filter(node => node.embedding);
// edge methods
const createEdge = async (from, to, type, weights) => await promisify(getStore(EDGES_STORE).put({ from, to, type, weights }));
const findAndCreateSimilarEdges = async (nodeId) => {
    const node = await getNodeById(nodeId);
    if (!node.embedding) return;
    for (const other of await getRecentNodesInternal(50)) {
        if (other.id === nodeId || !other.embedding) continue;
        const similarity = cosineSimilarity(node.embedding, other.embedding);
        // todo: want to push this value into a node
        if (similarity > similiarityThreshold) await createEdge(nodeId, other.id, 'SEMANTICALLY_SIMILAR', { semantic: similarity });
    }
};
const cosineSimilarity = (a, b) => {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
};
// Utility functions
const promisify = (req) => new Promise((resolve, reject) => (req.onsuccess = () => resolve(req.result), req.onerror = () => reject(req.error)));

// indexdb interactions
const openDatabase = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => initializeDatabase(event.target.result);
});
const initializeDatabase = (db) => (createCountersStore(db), createEdgesStore(db), createNodesStore(db));
const createNodesStore = (db) => {
    const store = db.createObjectStore(NODES_STORE, { keyPath: 'id' });
    store.createIndex('by-timestamp', 'timestamp');
};
const createEdgesStore = (db) => {
    const store = db.createObjectStore(EDGES_STORE, { keyPath: ['from', 'to', 'type'] });
    store.createIndex('by-from', 'from');
    store.createIndex('by-to', 'to');
};
const createCountersStore = (db) => db.createObjectStore(COUNTERS_STORE);
const getStore = (storeName, mode = 'readwrite') => _db.transaction([storeName], mode).objectStore(storeName);
const getIndex = (storeName, indexName) => getStore(storeName).index(indexName);
const getNextId = async (type) => {
    const store = getStore(COUNTERS_STORE);
    const current = (await promisify(store.get(type))) || 0;
    const next = current + 1;
    await promisify(store.put(next, type));
    return `${type}-${next}`;
};
const iterateCursor = async (cursorRequest, callback, limit = Infinity) => {
    const results = [];
    let cursor = await promisify(cursorRequest);
    while (cursor && results.length < limit) {
        const shouldContinue = await callback(cursor.value, cursor);
        if (shouldContinue === false) break;
        results.push(cursor.value);
        cursor = await promisify(cursor.continue());
    }
    return results;
};
// embedding
// TODO: update mock embeddingCall embeddings API or create local embedding module
const generateEmbedding = async (text) => Array(1536).fill(0).map(() => Math.random() - 0.5)

const updateNodeEmbedding = async (nodeId, embedding) => {
    const store = getStore(NODES_STORE);
    const node = await promisify(store.get(nodeId));
    node.embedding = embedding;
    await promisify(store.put(node));
    await findAndCreateSimilarEdges(nodeId);
};
