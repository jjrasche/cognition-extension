import { calculateCosineSimilarity, getId } from "./helpers.js";
export const manifest = {
	name: "graph-db",
	context: ["service-worker", "extension-page", "offscreen"],
	version: "1.0.0",
	description: "Graph database for storing knowledge and relationships",
	permissions: ["storage"],
	dependencies: ["indexed-db"],
	actions: ["addNode", "getNode", "addEdge", "removeNode", "getNodesByType", "getRecentNodes", "findSimilarNodes", "searchByText", "getConnectedNodes", "findInteractionByIds", "updateNode", "checkGraphStructure", "getCount"],
	indexeddb: {
		name: 'CognitionGraph',
		version: 1,
		storeConfigs: [
			{ name: 'nodes', options: { keyPath: 'id' }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] },
			{ name: 'edges', options: { keyPath: 'id' }, indexes: [{ name: 'by-from', keyPath: 'from' }, { name: 'by-to', keyPath: 'to' }, { name: 'by-type', keyPath: 'type' }] }
		]
	},
};
const similiarityThreshold = 0.7;
let runtime, log;
export const initialize = async (rt, l) => (runtime = rt);
// handle db
let nodesDB = async (method, ...args) => await runtime.call(`indexed-db.${method}`, manifest.indexeddb.name, 'nodes', ...args);
let edgesDB = async (method, ...args) => await runtime.call(`indexed-db.${method}`, manifest.indexeddb.name, 'edges', ...args);
// Main node operations
export const addNode = async ({ type = 'generic', id, ...nodeData }) => {
	const node = { id: id || getId(`${type}-`), type, timestamp: new Date().toISOString(), ...nodeData };
	return await nodesDB('addRecord', node);
};
export const getNode = async (nodeId) => await nodesDB('getRecord', nodeId);
export const removeNode = async (nodeId) => await nodesDB('removeRecord', nodeId);
export const getNodesByType = async (type) => (await nodesDB('getAllRecords')).filter(node => node.type === type);
export const getRecentNodes = async (limit) => await nodesDB('getByIndexCursor', 'by-timestamp', 'prev', limit);
// Search operations
export const findSimilarNodes = async (nodeId, threshold = similiarityThreshold) => {
	const sourceNode = await getNode(nodeId);
	if (!sourceNode?.embedding) return { success: false, error: 'Node not found or no embedding' };
	return (await getAllNodesWithEmbeddings())
		.filter(node => node.id !== nodeId)
		.map(node => ({ ...node, similarity: calculateCosineSimilarity(sourceNode.embedding, node.embedding) }))
		.filter(node => node.similarity >= threshold)
		.sort((a, b) => b.similarity - a.similarity);
};
export const searchByText = async (text, threshold = 0.3) => {
	const embedding = await runtime.call('embedding.embedText', text);
	return (await getAllNodesWithEmbeddings())
		.map(node => ({ node, similarity: calculateCosineSimilarity(embedding, node.embedding) }))
		.filter(({ similarity }) => similarity >= threshold)
		.sort((a, b) => b.similarity - a.similarity)
		.map(({ node }) => node);
};
export const getConnectedNodes = async (params) => {
	const { nodeId, direction = 'both' } = params;
	const edges = [];
	const nodeIds = new Set();
	if (direction === 'outgoing' || direction === 'both') {
		(await edgesDB('getByIndex', 'by-from', nodeId)).forEach(edge => (edges.push(edge), nodeIds.add(edge.to)));
	}
	if (direction === 'incoming' || direction === 'both') {
		(await edgesDB('getByIndex', 'by-to', nodeId)).forEach(edge => (edges.push(edge), nodeIds.add(edge.from)));
	}
	const nodes = await Promise.all([...nodeIds].map(id => getNode(id)));
	return nodes.filter(Boolean);
};
// Edge operations
export const createEdge = async (from, to, type, weights) => await edgesDB('addRecord', { from, to, type, weights });
export const addEdge = async ({ from, to, type = 'relates_to', weight = 1.0, metadata = {} }) => {
	if (!from || !to || !type) throw new Error(`Edge requires from (${from}), to (${to}), and type (${type}) properties`);
	return edgesDB('addRecord', { id: getId('edge-'), from, to, type, weight, metadata, timestamp: new Date().toISOString() });
};
// Utility functions
const getAllNodesWithEmbeddings = async () => (await nodesDB('getAllRecords')).filter(node => node.embedding);
export const updateNode = async (nodeId, updateData) => {
	const existingNode = await getNode(nodeId);
	if (!existingNode) throw new Error(`Node ${nodeId} not found`);
	const updatedNode = { ...existingNode, ...updateData };
	await nodesDB('updateRecord', updatedNode);
	return updatedNode;
};
export const getCount = async () => ({
	nodes: await nodesDB('countRecords'),
	edges: await edgesDB('countRecords')
});

// testing
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	const originalHelpers = await testSetup();
	const searchTests = await Promise.all([
		// runUnitTest("searchByText finds semantically similar content", async () => {
		// 	const testNodes = [
		// 		{ type: 'test-search', content: 'JavaScript function optimization techniques', embedding: await runtime.call('embedding.embedText', 'JavaScript function optimization techniques') },
		// 		{ type: 'test-search', content: 'Python code performance improvements', embedding: await runtime.call('embedding.embedText', 'Python code performance improvements') },
		// 		{ type: 'test-search', content: 'Database query optimization strategies', embedding: await runtime.call('embedding.embedText', 'Database query optimization strategies') },
		// 		{ type: 'test-search', content: 'Recipe for chocolate chip cookies', embedding: await runtime.call('embedding.embedText', 'Recipe for chocolate chip cookies') }
		// 	];
		// 	await Promise.all(testNodes.map(async node => await addNode(node)));
		// 	const results = await searchByText('code optimization', 0.3);
		// 	const actual = {
		// 		foundResults: results.length > 0,
		// 		hasJavaScript: results.some(r => r.content.includes('JavaScript')),
		// 		hasPython: results.some(r => r.content.includes('Python')),
		// 		hasDatabase: results.some(r => r.content.includes('Database')),
		// 		excludesCookies: !results.some(r => r.content.includes('cookies'))
		// 	};
		// 	const expected = {
		// 		foundResults: true,
		// 		hasJavaScript: true,
		// 		hasPython: true,
		// 		hasDatabase: true,
		// 		excludesCookies: true
		// 	};
		// 	return { actual, assert: deepEqual, expected };
		// }),
		// runUnitTest("searchByText respects similarity threshold", async () => {
		// 	const testNodes = [
		// 		{ type: 'test-threshold', content: 'Machine learning neural networks', embedding: await runtime.call('embedding.embedText', 'Machine learning neural networks') },
		// 		{ type: 'test-threshold', content: 'Deep learning algorithms', embedding: await runtime.call('embedding.embedText', 'Deep learning algorithms') },
		// 		{ type: 'test-threshold', content: 'Cooking pasta recipes', embedding: await runtime.call('embedding.embedText', 'Cooking pasta recipes') }
		// 	];
		// 	await Promise.all(testNodes.map(async node => await addNode(node)));
		// 	// High threshold should return fewer, more similar results
		// 	const highThresholdResults = await searchByText('artificial intelligence', 0.7);
		// 	const lowThresholdResults = await searchByText('artificial intelligence', 0.2);
		// 	const actual = {
		// 		highThresholdCount: highThresholdResults.length,
		// 		lowThresholdCount: lowThresholdResults.length,
		// 		thresholdFiltering: lowThresholdResults.length >= highThresholdResults.length
		// 	};
		// 	return { actual, assert: (a, e) => a.thresholdFiltering === e.thresholdFiltering, expected: { thresholdFiltering: true } };
		// }),
		// runUnitTest("searchByText returns results sorted by similarity", async () => {
		// 	const testNodes = [
		// 		{ type: 'test-sorting', content: 'React component lifecycle methods', embedding: await runtime.call('embedding.embedText', 'React component lifecycle methods') },
		// 		{ type: 'test-sorting', content: 'JavaScript frontend frameworks', embedding: await runtime.call('embedding.embedText', 'JavaScript frontend frameworks') },
		// 		{ type: 'test-sorting', content: 'Baking bread techniques', embedding: await runtime.call('embedding.embedText', 'Baking bread techniques') }
		// 	];
		// 	await Promise.all(testNodes.map(async node => await addNode(node)));
		// 	const results = await searchByText('React JavaScript development', 0.1);
		// 	const actual = {
		// 		hasResults: results.length > 0,
		// 		sortedProperly: results.length <= 1 || (results[0].similarity >= results[1].similarity),
		// 		reactFirst: results.length > 0 && results[0].content.includes('React')
		// 	};
		// 	return { actual, assert: deepEqual, expected: { hasResults: true, sortedProperly: true, reactFirst: true } };
		// }),
		// runUnitTest("searchByText handles empty graph gracefully", async () => {
		// 	const results = await searchByText('nonexistent content', 0.5);
		// 	const actual = {
		// 		resultsArray: Array.isArray(results),
		// 		emptyResults: results.length === 0
		// 	};
		// 	return { actual, assert: deepEqual, expected: { resultsArray: true, emptyResults: true } };
		// }),
		runUnitTest("searchByText with very high threshold returns no results", async () => {
			const testNode = { type: 'test-high-threshold', content: 'Test content for high threshold', embedding: await runtime.call('embedding.embedText', 'Test content for high threshold') };
			await addNode(testNode);
			const results = await searchByText('completely different topic', 0.99);
			const actual = results.length;
			return { actual, assert: strictEqual, expected: 0 };
		})
	]);
	await testTearDown(originalHelpers);
	return [...searchTests];
};

const testSetup = async () => {
	const testDbName = 'CognitionGraph-Test';
	const ret = { originalNodesDB: nodesDB, originalEdgesDB: edgesDB, testDbName };
	await runtime.call('indexed-db.createDB', { ...manifest.indexeddb, name: testDbName });
	nodesDB = async (method, ...args) => await runtime.call(`indexed-db.${method}`, testDbName, 'nodes', ...args);
	edgesDB = async (method, ...args) => await runtime.call(`indexed-db.${method}`, testDbName, 'edges', ...args);
	return ret;
};

const testTearDown = async (originalHelpers) => {
	const { originalNodesDB, originalEdgesDB, testDbName } = originalHelpers;
	nodesDB = originalNodesDB, edgesDB = originalEdgesDB;
	await runtime.call('indexed-db.deleteDB', testDbName);
};