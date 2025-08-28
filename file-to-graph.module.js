export const manifest = {
	name: "file-to-graph",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Ingests markdown files from directory, chunks them, and stores in graph database",
	dependencies: ["file", "chunk", "graph-db"],
	requiredDirectories: ["SelectedNotes"],
	actions: ["ingestFolder", "ingestFile"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const ingestFolder = async () => {
	const files = await getMarkdownFiles();
	const results = await Promise.all(files.map(filename => ingestFile(filename)));
	// const totalChunks = results.reduce((sum, result) => sum + result.chunks.length, 0);
	// return { filesProcessed: files.length, totalChunks };
};
export const ingestFile = async (filename) => {
	const content = await runtime.call('file.read', { dir: 'SelectedNotes', filename });
	runtime.log(`${filename}  ${content.length}`);
	const { chunks } = await runtime.call('chunk.chunk', content);
	// await Promise.all(chunks.map(async (chunkText, index) => await runtime.call('graph-db.addNode', {
	// 	type: 'file-chunk',
	// 	content: chunkText,
	// 	metadata: { sourceFile: filename, chunkIndex: index, ingestedAt: new Date().toISOString() }
	// })));
	return { filename, chunks };
};
const getMarkdownFiles = async () => (await runtime.call("file.listFiles", { dir: 'SelectedNotes' })).filter(f => f.endsWith('.md'));
