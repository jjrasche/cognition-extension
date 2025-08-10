export const manifest = {
    name: "graph-db",
    context: "service-worker",
    version: "1.0.0",
    description: "Graph database for storing knowledge and relationships",
    permissions: ["storage"],
    dependencies: ["indexed-db"],
    actions: ["addInferenceNode", "addNode", "getNode", "removeNode", "getNodesByType", "getRecentNodes", "findSimilarNodes", "searchByText", "getConnectedNodes", "printNodes"],
    indexeddb: {
        name: 'CognitionGraph',
        version: 1,
        storeConfigs: [
            { name: 'nodes', options: { keyPath: 'id' }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] },
            { name: 'edges',  options: { keyPath: ['from', 'to', 'type'] }, indexes: [ { name: 'by-from', keyPath: 'from' }, { name: 'by-to', keyPath: 'to' } ] },
        ]
    },
};
const similiarityThreshold = 0.7;
let runtime, db;
export const initialize = async (rt) => (runtime = rt, db = await getDB());
// handle db
const getDB = async () => await runtime.call('indexed-db.openDb', manifest.indexeddb);
// Main node operations
export const addInferenceNode = async (params) => {
    const { userPrompt, assembledPrompt, response, model, context } = params;
    const nodeId = await runtime.call('indexeddb.getNextId', { db, type: 'inference' });
    const node = { id: nodeId, timestamp: new Date().toISOString(), userPrompt, assembledPrompt, response, model, context, embedding: null };
    node.embedding = await runtime.call('embedding.embedText', { text: assembledPrompt });
    await runtime.call('indexeddb.addRecord', { db, storeName: 'nodes', data: node });
    await findAndCreateSimilarEdges(nodeId);
    return nodeId;
};
export const addNode = async (params) => {
    const { id, type = 'generic', ...nodeData } = params;
    const nodeId = id || await runtime.call('indexeddb.getNextId', { db, type });
    const node = { id: nodeId, type, timestamp: new Date().toISOString(), ...nodeData };  
    await runtime.call('indexeddb.addRecord', { db, storeName: 'nodes', data: node });
    return nodeId;
};
export const getNode = async (params) => await runtime.call('indexeddb.getRecord', { db, storeName: 'nodes', key: params.nodeId });
export const removeNode = async (params) => await runtime.call('indexeddb.removeRecord', { db, storeName: 'nodes', key: params.nodeId });
export const getNodesByType = async (params) => await runtime.call('indexeddb.getAllRecords', { db, storeName: 'nodes' }).filter(node => node.type === params.type);
export const getRecentNodes = async (params) => await runtime.call('indexeddb.getByIndex', { db, storeName: 'nodes', indexName: 'by-timestamp', limit: params?.limit || 20, direction: 'prev' });
// Search operations
export const findSimilarNodes = async (params) => {
    const { nodeId, threshold = similiarityThreshold } = params;
    const sourceNode = await getNode({ nodeId });
    if (!sourceNode?.embedding) return { success: false, error: 'Node not found or no embedding' };
    return (await getAllNodesWithEmbeddings())
        .filter(node => node.id !== nodeId)
        .map(node => ({ ...node, similarity: cosineSimilarity(sourceNode.embedding, node.embedding)}))
        .filter(node => node.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity);
};
export const searchByText = async (params) => {
    const { text, threshold = 0.5 } = params;
    const embedding = await runtime.call('embedding.embedText', { text });
    return (await getAllNodesWithEmbeddings())
        .map(node => ({ node, similarity: cosineSimilarity(embedding, node.embedding) }))
        .filter(({ similarity }) => similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .map(({ node }) => node);
};
export const getConnectedNodes = async (params) => {
    const { nodeId, direction = 'both' } = params;
    const edges = [];
    const nodeIds = new Set(); 
    if (direction === 'outgoing' || direction === 'both') {
        (await runtime.call('indexeddb.getByIndex', { db, storeName: 'edges', indexName: 'by-from', value: nodeId }))
            .forEach(edge => (edges.push(edge), nodeIds.add(edge.to)));
    }
    if (direction === 'incoming' || direction === 'both') {
        (await runtime.call('indexeddb.getByIndex', { db, storeName: 'edges', indexName: 'by-to', value: nodeId }))
            .forEach(edge => (edges.push(edge), nodeIds.add(edge.from)));
    }
    const nodes = await Promise.all([...nodeIds].map(id => getNode({ nodeId: id })));
    return nodes.filter(Boolean);
};
// Edge operations
const createEdge = async (from, to, type, weights) => await runtime.call('indexeddb.addRecord', { db, storeName: 'edges', data: { from, to, type, weights } });
const findAndCreateSimilarEdges = async (nodeId) => {
    const node = await getNode({ nodeId });
    if (!node.embedding) return;
    const recentNodes = await getRecentNodes({ limit: 50 });
    for (const other of recentNodes) {
        if (other.id === nodeId || !other.embedding) continue;
        const similarity = cosineSimilarity(node.embedding, other.embedding);
        if (similarity > similiarityThreshold) {
            await createEdge(nodeId, other.id, 'SEMANTICALLY_SIMILAR', { semantic: similarity });
        }
    }
};
// Utility functions
const getAllNodesWithEmbeddings = async () => await runtime.call('indexeddb.getAllRecords', { db, storeName: 'nodes' }).filter(node => node.embedding);
const cosineSimilarity = (a, b) => {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
};