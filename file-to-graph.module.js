export const manifest = {
	name: "file-to-graph",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Ingests markdown files from directory, chunks them, and stores in graph database",
	dependencies: ["file", "chunk", "graph-db"],
	requiredDirectories: ["SelectedNotes"],
	actions: ["ingestFolder", "ingestFile", "renderEvaluationDashboard", "handleThresholdChange"],
	searchActions: [
		{ name: "chunking evaluation", condition: input => input === "eval", method: "renderEvaluationDashboard" }
	]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const ingestFolder = async () => {
	const files = [];
	const results = await Promise.all(files.map(filename => ingestFile(filename)));
	// const totalChunks = results.reduce((sum, result) => sum + result.chunks.length, 0);
	// return { filesProcessed: files.length, totalChunks };
};
export const ingestFile = async (filename) => {
	const { fileChunkTest } = await import(chrome.runtime.getURL(`data/file-chunking-tests/${filename}.js`));
	runtime.log(`${fileChunkTest.fileName}  ${fileChunkTest.content.length}`);
	fileChunkTest.queries = await Promise.all(
		fileChunkTest.queries.map(async query => ({
			text: query,
			embedding: await runtime.call('embedding.embedText', query)
		}))
	);
	debugger;
	// const { chunks } = await runtime.call('chunk.chunk', content);
	// await Promise.all(chunks.map(async (chunkText, index) => await runtime.call('graph-db.addNode', {
	// 	type: 'file-chunk',
	// 	content: chunkText,
	// 	metadata: { sourceFile: filename, chunkIndex: index, ingestedAt: new Date().toISOString() }
	// })));
	// return { filename, chunks };
};


const runChunkingEvaluation = async (threshold) => {
	const testCases = await loadTestCases();
	const results = await Promise.all(testCases.map(async testCase => {
		const chunkResult = await runtime.call('chunk.chunk', testCase.content, { threshold, testQueries: testCase.queries });
		const ret = {
			fileName: testCase.fileName,
			chunkCount: chunkResult.chunks.length,
			retrievalConfidence: chunkResult.retrievalPrediction.confidence,
			boundaryQuality: chunkResult.quality.boundary.avgBoundaryQuality,
			avgSentencesPerChunk: chunkResult.quality.avgSentencesPerChunk,
			percentSingleSentenceChunks: chunkResult.quality.percentSingleSentenceChunks
		};
		runtime.log(`runChunkingEvaluation ${testCase.fileName}`, ret);
		return ret;
	}));
	const ret = {
		threshold,
		results,
		avgConfidence: results.reduce((sum, r) => sum + r.retrievalConfidence, 0) / results.length,
		avgChunks: results.reduce((sum, r) => sum + r.chunkCount, 0) / results.length,
		avgSentencesPerChunk: results.reduce((sum, r) => sum + r.avgSentencesPerChunk, 0) / results.length,
		percentSingleSentenceChunks: results.reduce((sum, r) => sum + r.percentSingleSentenceChunks, 0) / results.length
	};
	runtime.log('runChunkingEvaluation total', ret);
	return ret;
};

const loadTestCases = async () => {
	const { fileChunkTests } = await (await import(chrome.runtime.getURL('data/file-chunking-tests/test-cases.js')));
	return await Promise.all(fileChunkTests.map(async filename => {
		try {
			const { fileChunkTest } = await import(chrome.runtime.getURL(`data/file-chunking-tests/${filename}.js`));
			if (fileChunkTest.queries.some(q => !q.embedding)) {
				fileChunkTest.queries = await Promise.all(
					fileChunkTest.queries.map(async query => ({ text: query, embedding: await runtime.call('embedding.embedText', query) }))
				);
				runtime.log(fileChunkTest);
			}
			return fileChunkTest;
		} catch (error) {
			runtime.log(`Error loading ${filename}:`, error);
		}
	}));
};

export const renderEvaluationDashboard = async (threshold = .3) => {
	await runtime.call('ui.showPageSpinner', 'Re-evaluating chunks...');
	const results = await runChunkingEvaluation(threshold);
	const ret = {
		"eval-dashboard": {
			tag: "div", class: "evaluation-container",
			"back-button": {
				tag: "button", text: "← Back",
				class: "cognition-button-secondary",
				events: { click: "ui.initializeLayout" }
			},
			"threshold-control": {
				tag: "div", style: "margin: 20px 0;",
				"threshold-label": { tag: "label", text: `Threshold: ${threshold}` },
				"threshold-slider": {
					tag: "input", type: "range", min: "0", max: ".9", step: "0.01",
					value: threshold,
					events: { input: "file-to-graph.handleThresholdChange" }
				}
			},
			"metrics-grid": {
				tag: "div", class: "metrics-grid",
				"confidence": { tag: "div", text: `Avg Confidence: ${results.avgConfidence.toFixed(3)}` },
				"chunk-count": { tag: "div", text: `Avg Chunks: ${results.avgChunks}` },
				"sentences-per-chunk": { tag: "div", text: `Avg Sentences/Chunk: ${results.avgSentencesPerChunk.toFixed(3)}` },
				"single-sentence-chunks": { tag: "div", text: `Percent Single-Sentence Chunks: ${(results.percentSingleSentenceChunks * 100).toFixed(2)}%` }
			},
			"results-table": buildResultsTable(results.results)
		}
	};
	runtime.log('renderEvaluationDashboard', ret);
	await runtime.call('ui.hidePageSpinner');
	return ret;
};

const buildResultsTable = (results) => {
	const tableTree = {
		tag: "table", class: "results-table", style: "width: 100%; border-collapse: collapse; margin-top: 20px;",
		"table-header": {
			tag: "thead",
			"header-row": {
				tag: "tr",
				"file-header": { tag: "th", text: "File", style: "border: 1px solid #ddd; padding: 8px;" },
				"chunks-header": { tag: "th", text: "Chunks", style: "border: 1px solid #ddd; padding: 8px;" },
				"confidence-header": { tag: "th", text: "Confidence", style: "border: 1px solid #ddd; padding: 8px;" },
				"boundary-header": { tag: "th", text: "Boundary", style: "border: 1px solid #ddd; padding: 8px;" },
				"avg-sentences-per-chunk-header": { tag: "th", text: "Avg Sentences/Chunk", style: "border: 1px solid #ddd; padding: 8px;" },
				"single-sentence-chunks-header": { tag: "th", text: "Percent Single-Sentence Chunks", style: "border: 1px solid #ddd; padding: 8px;" }
			}
		},
		"table-body": {
			tag: "tbody",
			...buildTableRows(results)
		}
	};

	return tableTree;
};
const buildTableRows = (results) => {
	const rows = {};
	results.forEach((result, index) => {
		const rowId = `row-${index}`;
		rows[rowId] = {
			tag: "tr",
			style: index % 2 === 0 ? "background-color: #000000ff;" : "",
			[`${rowId}-file`]: {
				tag: "td",
				text: result.fileName,
				style: "border: 1px solid #ddd; padding: 8px;"
			},
			[`${rowId}-chunks`]: {
				tag: "td",
				text: result.chunkCount.toString(),
				style: "border: 1px solid #ddd; padding: 8px; text-align: center;"
			},
			[`${rowId}-confidence`]: {
				tag: "td",
				text: result.retrievalConfidence.toFixed(3),
				style: "border: 1px solid #ddd; padding: 8px; text-align: center;"
			},
			[`${rowId}-boundary`]: {
				tag: "td",
				text: result.boundaryQuality.toFixed(3),
				style: "border: 1px solid #ddd; padding: 8px; text-align: center;"
			},
			[`${rowId}-avg-sentences-per-chunk`]: {
				tag: "td",
				text: (result.avgSentencesPerChunk ?? 0).toFixed(3),
				style: "border: 1px solid #ddd; padding: 8px; text-align: center;"
			},
			[`${rowId}-single-sentence-chunks`]: {
				tag: "td",
				text: ((result.percentSingleSentenceChunks ?? 0) * 100).toFixed(2) + "%",
				style: "border: 1px solid #ddd; padding: 8px; text-align: center;"
			}
		};
	});

	return rows;
};
export const handleThresholdChange = async (event) => {
	const threshold = parseFloat(event.target.value);
	const tree = await renderEvaluationDashboard(threshold);
	await runtime.call('ui.renderTree', tree);
};