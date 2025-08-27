export const manifest = {
	name: "graph-db",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Graph database for storing knowledge and relationships",
	permissions: ["storage"],
	dependencies: ["indexed-db"],
	actions: ["addInferenceNode", "addNode", "getNode", "removeNode", "getNodesByType", "getRecentNodes", "findSimilarNodes", "searchByText", "getConnectedNodes", "findInteractionByIds", "updateNode", "checkGraphStructure"],
	indexeddb: {
		name: 'CognitionGraph',
		version: 1,
		storeConfigs: [
			{ name: 'nodes', options: { autoIncrement: true }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] },
			{ name: 'edges', options: { keyPath: ['from', 'to', 'type'] }, indexes: [{ name: 'by-from', keyPath: 'from' }, { name: 'by-to', keyPath: 'to' }] },
		]
	},
};
const similiarityThreshold = 0.7;
let runtime, db;
export const initialize = async (rt) => (runtime = rt, db = await getDB());
// handle db
const getDB = async () => await indexedDB('openDb', manifest.indexeddb);
const indexedDB = async (method, params) => {
	try {
		return await runtime.call(`indexed-db.${method}`, { db, ...params });
	} catch (error) {
		console.error(`Error calling indexed-db.${method}:`, error);
	}
};
// Main node operations
export const addInferenceNode = async (params) => {
	const { query, prompt, response, model, context } = params;
	const node = { query, prompt, response, model, context, timestamp: new Date().toISOString() };
	return await indexedDB('addRecord', { storeName: 'nodes', data: node });
};
export const addNode = async (params) => {
	const { type = 'generic', ...nodeData } = params;

	const node = { type, timestamp: new Date().toISOString(), ...nodeData };
	await indexedDB('addRecord', { storeName: 'nodes', data: node });
};
export const getNode = async (params) => await indexedDB('getRecord', { storeName: 'nodes', key: params.nodeId });
export const removeNode = async (params) => await indexedDB('removeRecord', { storeName: 'nodes', key: params.nodeId });
export const getNodesByType = async (params) => (await indexedDB('getAllRecords', { storeName: 'nodes' })).filter(node => node.type === params.type);
export const getRecentNodes = async (params) => await indexedDB('getByIndex', { storeName: 'nodes', indexName: 'by-timestamp', limit: params?.limit || 20, direction: 'prev' });
// Search operations
export const findSimilarNodes = async (params) => {
	const { nodeId, threshold = similiarityThreshold } = params;
	const sourceNode = await getNode({ nodeId });
	if (!sourceNode?.embedding) return { success: false, error: 'Node not found or no embedding' };
	return (await getAllNodesWithEmbeddings())
		.filter(node => node.id !== nodeId)
		.map(node => ({ ...node, similarity: cosineSimilarity(sourceNode.embedding, node.embedding) }))
		.filter(node => node.similarity >= threshold)
		.sort((a, b) => b.similarity - a.similarity);
};
export const searchByText = async (params) => {
	const { text, threshold = 0.5 } = params;
	const embedding = await runtime.call('embedding.embedText', text);
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
		(await indexedDB('getByIndex', { storeName: 'edges', indexName: 'by-from', value: nodeId }))
			.forEach(edge => (edges.push(edge), nodeIds.add(edge.to)));
	}
	if (direction === 'incoming' || direction === 'both') {
		(await indexedDB('getByIndex', { storeName: 'edges', indexName: 'by-to', value: nodeId }))
			.forEach(edge => (edges.push(edge), nodeIds.add(edge.from)));
	}
	const nodes = await Promise.all([...nodeIds].map(id => getNode({ nodeId: id })));
	return nodes.filter(Boolean);
};
// Edge operations
const createEdge = async (from, to, type, weights) => await indexedDB('addRecord', { storeName: 'edges', data: { from, to, type, weights } });
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
const getAllNodesWithEmbeddings = async () => (await indexedDB('getAllRecords', { storeName: 'nodes' })).filter(node => node.embedding);
const cosineSimilarity = (a, b) => {
	const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
	const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
	const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
	return dotProduct / (magnitudeA * magnitudeB);
};

export const findInteractionByIds = async (params) => {
	const { humanMessageId, assistantMessageId } = params;
	const allNodes = await indexedDB('getAllRecords', { storeName: 'nodes' });

	return allNodes.find(node =>
		node.context?.messageIds?.human === humanMessageId &&
		node.context?.messageIds?.assistant === assistantMessageId
	);
};
export const updateNode = async (params) => {
	const { nodeId, updateData } = params;
	const existingNode = await getNode({ nodeId });
	if (!existingNode) throw new Error(`Node ${nodeId} not found`);

	const updatedNode = { ...existingNode, ...updateData };
	await indexedDB('updateRecord', { storeName: 'nodes', data: updatedNode });
	return updatedNode;
};


// testing
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	const originalDB = await testSetup();
	const searchTests = await Promise.all([
		runUnitTest("searchByText finds semantically similar content", async () => {
			const testNodes = [
				{ type: 'test-search', content: 'JavaScript function optimization techniques', embedding: await runtime.call('embedding.embedText', 'JavaScript function optimization techniques') },
				{ type: 'test-search', content: 'Python code performance improvements', embedding: await runtime.call('embedding.embedText', 'Python code performance improvements') },
				{ type: 'test-search', content: 'Database query optimization strategies', embedding: await runtime.call('embedding.embedText', 'Database query optimization strategies') },
				{ type: 'test-search', content: 'Recipe for chocolate chip cookies', embedding: await runtime.call('embedding.embedText', 'Recipe for chocolate chip cookies') }
			];
			await Promise.all(testNodes.map(async node => await addNode(node)));
			const results = await searchByText({ text: 'code optimization', threshold: 0.3 });
			const actual = {
				foundResults: results.length > 0,
				hasJavaScript: results.some(r => r.content.includes('JavaScript')),
				hasPython: results.some(r => r.content.includes('Python')),
				hasDatabase: results.some(r => r.content.includes('Database')),
				excludesCookies: !results.some(r => r.content.includes('cookies'))
			};
			const expected = {
				foundResults: true,
				hasJavaScript: true,
				hasPython: true,
				hasDatabase: true,
				excludesCookies: true
			};
			return { actual, assert: deepEqual, expected };
		}, afterEach),
		runUnitTest("searchByText respects similarity threshold", async () => {
			const testNodes = [
				{ type: 'test-threshold', content: 'Machine learning neural networks', embedding: await runtime.call('embedding.embedText', 'Machine learning neural networks') },
				{ type: 'test-threshold', content: 'Deep learning algorithms', embedding: await runtime.call('embedding.embedText', 'Deep learning algorithms') },
				{ type: 'test-threshold', content: 'Cooking pasta recipes', embedding: await runtime.call('embedding.embedText', 'Cooking pasta recipes') }
			];
			await Promise.all(testNodes.map(async node => await addNode(node)));
			// High threshold should return fewer, more similar results
			const highThresholdResults = await searchByText({ text: 'artificial intelligence', threshold: 0.7 });
			const lowThresholdResults = await searchByText({ text: 'artificial intelligence', threshold: 0.2 });
			const actual = {
				highThresholdCount: highThresholdResults.length,
				lowThresholdCount: lowThresholdResults.length,
				thresholdFiltering: lowThresholdResults.length >= highThresholdResults.length
			};
			return { actual, assert: (a, e) => a.thresholdFiltering === e.thresholdFiltering, expected: { thresholdFiltering: true } };
		}, afterEach),
		runUnitTest("searchByText returns results sorted by similarity", async () => {
			const testNodes = [
				{ type: 'test-sorting', content: 'React component lifecycle methods', embedding: await runtime.call('embedding.embedText', 'React component lifecycle methods') },
				{ type: 'test-sorting', content: 'JavaScript frontend frameworks', embedding: await runtime.call('embedding.embedText', 'JavaScript frontend frameworks') },
				{ type: 'test-sorting', content: 'Baking bread techniques', embedding: await runtime.call('embedding.embedText', 'Baking bread techniques') }
			];
			await Promise.all(testNodes.map(async node => await addNode(node)));
			const results = await searchByText({ text: 'React JavaScript development', threshold: 0.1 });
			const actual = {
				hasResults: results.length > 0,
				sortedProperly: results.length <= 1 || (results[0].similarity >= results[1].similarity),
				reactFirst: results.length > 0 && results[0].content.includes('React')
			};
			return { actual, assert: deepEqual, expected: { hasResults: true, sortedProperly: true, reactFirst: true } };
		}, afterEach),
		runUnitTest("searchByText handles empty graph gracefully", async () => {
			const results = await searchByText({ text: 'nonexistent content', threshold: 0.5 });
			const actual = {
				resultsArray: Array.isArray(results),
				emptyResults: results.length === 0
			};
			return { actual, assert: deepEqual, expected: { resultsArray: true, emptyResults: true } };
		}, afterEach),
		runUnitTest("searchByText with very high threshold returns no results", async () => {
			const testNode = { type: 'test-high-threshold', content: 'Test content for high threshold', embedding: await runtime.call('embedding.embedText', 'Test content for high threshold') };
			await addNode(testNode);
			const results = await searchByText({ text: 'completely different topic', threshold: 0.99 });
			const actual = results.length;
			return { actual, assert: strictEqual, expected: 0 };
		}, afterEach)
	]);
	await testTearDown(originalDB);
	return [...searchTests];
};
const afterEach = async () => await runtime.call('indexedDB.deleteDatabase', { name: 'test-db' });
const testSetup = async () => {
	const originalDB = db;
	const indexeddb = JSON.parse(JSON.stringify(manifest.indexeddb))
	indexeddb.name = "test-db";
	db = await indexedDB('openDb', indexeddb);
	return originalDB;
}
const testTearDown = async (originalDB) => {
	db = originalDB;
};