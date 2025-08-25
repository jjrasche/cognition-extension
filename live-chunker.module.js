import { getId } from "./helpers.js";

export const manifest = {
	name: "live-chunker",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Real-time speech chunking with bubble visualization",
	dependencies: ["web-speech-stt", "ui", "chunk"],
	actions: ["startDemo", "stopDemo", "processThought", "getChunks", "setThreshold", "setMode", "handleChunkClick", "handleSynthesize"],
};

let runtime, chunks = [], isActive = false, threshold = 0.4, mode = 'view';
let similarityDuration = 0;
let selectedForMerge = null;

export const initialize = async (rt) => {
	runtime = rt;
	setupKeyboardListeners();
};

const setupKeyboardListeners = () => {
	document.addEventListener('keydown', async (event) => {
		if (!isActive) return;

		if (event.key.toLowerCase() === 'm') {
			await setMode(mode === 'merge' ? 'view' : 'merge');
		} else if (event.key.toLowerCase() === 'd') {
			await setMode(mode === 'delete' ? 'view' : 'delete');
		}
	});
};

export const startDemo = async () => {
	isActive = true;
	chunks = [];
	selectedForMerge = null;
	await runtime.call('web-speech-stt.startListening');
	await renderChunkerUI();
	return { success: true, message: 'Live chunking demo started' };
};

export const stopDemo = async () => {
	isActive = false;
	mode = 'view';
	selectedForMerge = null;
	await runtime.call('web-speech-stt.stopListening');
	return { success: true, message: 'Live chunking demo stopped' };
};

export const processThought = async (thought) => {
	if (!isActive) return;

	runtime.log('[Live-Chunker] Processing thought:', thought);

	const startTime = performance.now();

	if (chunks.length === 0) {
		// First chunk - just create it
		chunks.push({
			thoughts: [thought],
			id: getId('chunk-')
		});
	} else {
		// Test similarity with all existing chunks
		const similarities = await Promise.all(
			chunks.map(async chunk => {
				const chunkText = chunk.thoughts.map(t => t.text).join(' ');
				return await runtime.call('chunk.calculateChunkSimilarity', chunkText, thought.text);
			})
		);

		const maxSimilarity = Math.max(...similarities);
		const bestChunkIndex = similarities.indexOf(maxSimilarity);

		const now = Date.now();
		const lastThoughtTime = chunks[bestChunkIndex].thoughts[chunks[bestChunkIndex].thoughts.length - 1]?.timestamp || now;
		const timeDelta = now - lastThoughtTime;

		if (shouldMergeWithChunk(maxSimilarity, timeDelta)) {
			// Add to existing chunk
			chunks[bestChunkIndex].thoughts.push(thought);
			runtime.log(`[Live-Chunker] Added to chunk ${bestChunkIndex} (${maxSimilarity.toFixed(3)} similarity)`);
		} else {
			// Create new chunk
			chunks.push({
				thoughts: [thought],
				id: getId('chunk-')
			});
			runtime.log('[Live-Chunker] Created new chunk');
		}
	}

	for (const chunk of chunks) {
		const orbitingChunks = await getOrbitingChunks(chunk);
		chunk.orbitingChunks = orbitingChunks;
	}

	similarityDuration = performance.now() - startTime;
	await renderChunkerUI();
};

const getOrbitingChunks = async (cluster) => {
	const combinedText = cluster.thoughts.map(t => t.text).join(' ');
	const embedding = await runtime.call('embedding.embedText', combinedText);

	// Find semantically similar graph nodes
	const relatedNodes = await runtime.call('graph-db.searchByEmbedding', embedding, 0.6);

	return relatedNodes.map(node => ({
		id: node.id,
		text: node.content.substring(0, 100) + '...',
		similarity: node.similarity,
		distance: 1 - node.similarity, // for visual positioning
		approved: null // pending user swipe
	}));
};

export const setMode = async (eventOrMode) => {
	// Handle both direct calls and UI events
	const newMode = typeof eventOrMode === 'string' ? eventOrMode : eventOrMode.target.dataset.mode;

	mode = mode === newMode ? 'view' : newMode; // Toggle if same mode
	selectedForMerge = null; // Reset merge selection

	await renderChunkerUI();
	runtime.log(`[Live-Chunker] Mode: ${mode}`);
};

export const setThreshold = async (event) => {
	threshold = parseFloat(event.target.value);
	await renderChunkerUI();
	runtime.log(`[Live-Chunker] Threshold: ${threshold}`);
};

export const handleChunkClick = async (event) => {
	const chunkId = event.target.closest('[data-chunk-id]').dataset.chunkId;

	if (mode === 'delete') {
		await deleteChunk(chunkId);
	} else if (mode === 'merge') {
		await handleMergeClick(chunkId);
	}
};

const shouldMergeWithChunk = (semanticSim, timeDelta) => {
	const semanticWeight = 0.7;
	const temporalWeight = 0.3;
	const maxTimeDelta = 30000; // 30 seconds

	const temporalSim = Math.max(0, 1 - (timeDelta / maxTimeDelta));
	const combinedScore = (semanticSim * semanticWeight) + (temporalSim * temporalWeight);

	return combinedScore > 0.4;
};

const synthesizeChunk = async (chunk) => {
	const prompt = `Synthesize the core idea from these related thoughts:\n${chunk.sentences.join('\n')}`;
	return await runtime.call('inference.prompt', { query: prompt, systemPrompt: "Create a 1-2 sentence synthesis of the main idea." });
};

const handleMergeClick = async (chunkId) => {
	if (!selectedForMerge) {
		// First selection
		selectedForMerge = chunkId;
		await renderChunkerUI(); // Re-render to show selection
		runtime.log(`[Live-Chunker] Selected chunk for merge: ${chunkId}`);
	} else if (selectedForMerge === chunkId) {
		// Clicked same chunk - deselect
		selectedForMerge = null;
		await renderChunkerUI();
		runtime.log(`[Live-Chunker] Deselected chunk`);
	} else {
		// Second selection - merge them
		await mergeChunks(selectedForMerge, chunkId);
	}
};

const mergeChunks = async (chunk1Id, chunk2Id) => {
	const chunk1Index = chunks.findIndex(c => c.id === chunk1Id);
	const chunk2Index = chunks.findIndex(c => c.id === chunk2Id);

	if (chunk1Index === -1 || chunk2Index === -1) return;

	// Merge chunk2 into chunk1 (chronologically)
	chunks[chunk1Index].thoughts = [...chunks[chunk1Index].thoughts, ...chunks[chunk2Index].thoughts]
		.sort((a, b) => a.timestamp - b.timestamp);
	chunks.splice(chunk2Index, 1);

	selectedForMerge = null;
	mode = 'view';
	await renderChunkerUI();
	runtime.log(`[Live-Chunker] Merged chunks`);
};

const deleteChunk = async (chunkId) => {
	const index = chunks.findIndex(c => c.id === chunkId);
	if (index === -1) return;

	chunks.splice(index, 1);
	mode = 'view';
	await renderChunkerUI();
	runtime.log(`[Live-Chunker] Deleted chunk`);
};

const renderChunkerUI = async () => {
	const tree = {
		"chunker-container": {
			tag: "div", class: "chunker-container", style: "padding: 20px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
			"controls": {
				tag: "div", style: "margin-bottom: 20px; display: flex; gap: 15px; align-items: center; flex-wrap: wrap;",
				"threshold-control": {
					tag: "label", text: `Similarity Threshold: ${threshold} `, style: "display: flex; align-items: center; gap: 8px; font-size: 14px;",
					"threshold-slider": { tag: "input", type: "range", min: "0.1", max: "0.9", step: "0.05", value: threshold.toString(), events: { input: "live-chunker.setThreshold" }, style: "width: 120px;" }
				},
				"performance": { tag: "span", text: `Calc: ${similarityDuration.toFixed(1)}ms`, style: "font-size: 12px; color: #666; opacity: 0.7; background: #f0f0f0; padding: 4px 8px; border-radius: 4px;" },
				"mode-buttons": {
					tag: "div", style: "display: flex; gap: 8px;",
					"merge-btn": { tag: "button", text: mode === 'merge' ? "✓ Merge (M)" : "Merge (M)", class: mode === 'merge' ? "cognition-button-primary" : "cognition-button-secondary", events: { click: "live-chunker.setMode" }, "data-mode": "merge", style: "font-size: 12px; padding: 6px 12px;" },
					"delete-btn": { tag: "button", text: mode === 'delete' ? "✓ Delete (D)" : "Delete (D)", class: mode === 'delete' ? "cognition-button-primary" : "cognition-button-secondary", events: { click: "live-chunker.setMode" }, "data-mode": "delete", style: "font-size: 12px; padding: 6px 12px;" }
				}
			},
			"chunks": { tag: "div", style: "display: flex; flex-wrap: wrap; gap: 15px;", ...await createChunkBubbles() }
		}
	};

	await runtime.call('ui.renderTree', tree);
};

const createChunkBubbles = async () => {
	const bubbles = {};

	await Promise.all(chunks.map(async (chunk, index) => {
		const chunkDetails = await Promise.all(chunk.thoughts.map(async (thought, i) => {
			if (i === 0) return { thought, similarity: null };
			const prevThought = chunk.thoughts[i - 1];
			const similarity = await runtime.call('chunk.calculateChunkSimilarity', prevThought.text, thought.text);
			return { thought, similarity };
		}));
		const bubbleId = `chunk-${chunk.id}`;
		const thoughtCount = chunk.thoughts.length;
		const allText = chunk.thoughts.map(t => t.text).join(' ');
		const previewText = allText.length > 100 ? allText.substring(0, 97) + '...' : allText;

		const isSelected = selectedForMerge === chunk.id;
		const isInteractive = mode === 'merge' || mode === 'delete';

		// Color calculation
		const hue = (index * 60) % 360;
		const baseColor = `hsl(${hue}, 70%, 85%)`;
		const borderColor = `hsl(${hue}, 70%, 70%)`;

		let backgroundColor = baseColor;
		let borderWidth = '2px';

		if (mode === 'delete') {
			backgroundColor = `hsl(0, 60%, 90%)`; // Reddish tint for delete mode
		} else if (isSelected) {
			backgroundColor = `hsl(${hue}, 80%, 75%)`; // Brighter when selected
			borderWidth = '3px';
		}

		bubbles[bubbleId] = {
			tag: "div",
			class: `chunk-bubble ${isInteractive ? 'interactive' : ''}`,
			style: ` background: ${backgroundColor}; border-radius: 15px; padding: 12px 16px; border: ${borderWidth} solid ${borderColor}; max-width: 300px; min-width: 180px; cursor: ${isInteractive ? 'pointer' : 'default'}; opacity: ${mode === 'view' ? '1' : '0.85'}; transition: all 0.2s ease; box-shadow: ${isSelected ? '0 4px 12px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.1)'}; transform: ${isSelected ? 'translateY(-2px)' : 'none'};`,
			events: isInteractive ? { click: "live-chunker.handleChunkClick" } : {},
			"data-chunk-id": chunk.id,
			title: allText, // Full text on hover
			[`${bubbleId}-count`]: { tag: "div", text: `${thoughtCount} thought${thoughtCount > 1 ? 's' : ''}`, style: "font-size: 11px; color: #666; margin-bottom: 6px; font-weight: bold;" },
			[`${bubbleId}-text`]: { tag: "div", text: previewText, style: "font-size: 13px; line-height: 1.4; color: #333;" },
			[`${bubbleId}-similarities`]: { tag: "div", style: "margin-top: 8px; font-size: 10px; color: #666;", innerHTML: chunkDetails.slice(1).map((detail, i) => `${i + 1}→${i + 2}: ${(detail.similarity * 100).toFixed(0)}%`).join(' · ') },
			// Show selection indicator for merge mode
			...(isSelected && {
				[`${bubbleId}-selected`]: { tag: "div", text: "✓ Selected", style: "font-size: 10px; color: #0066cc; margin-top: 6px; font-weight: bold;" }
			}),
			...(thoughtCount > 1 && {
				[`${bubbleId}-synthesize`]: { tag: "button", text: "💡 Synthesize", class: "cognition-button-secondary", style: "font-size: 10px; padding: 4px 8px; margin-top: 6px;", events: { click: "live-chunker.handleSynthesize" }, "data-chunk-id": chunk.id }
			}),
			...(chunk.orbitingChunks && chunk.orbitingChunks.length > 0 && {
				[`${bubbleId}-orbiting-container`]: {
					tag: "div",
					style: "position: relative; margin-top: 8px;",
					...chunk.orbitingChunks.reduce((orbitBubbles, orbitChunk, i) => {
						orbitBubbles[`${bubbleId}-orbit-${i}`] = {
							tag: "div",
							class: "orbiting-chunk",
							style: `display: inline-block; margin: 2px; padding: 4px 8px; background: rgba(255,255,255,0.7); border-radius: 12px; font-size: 10px; cursor: pointer; border: 1px solid #ddd;`,
							text: orbitChunk.text,
							events: { click: "live-chunker.handleOrbitSwipe" },
							"data-chunk-id": chunk.id,
							"data-orbit-id": orbitChunk.id,
							title: `Similarity: ${(orbitChunk.similarity * 100).toFixed(1)}%`
						};
						return orbitBubbles;
					}, {})
				}
			})
		};
	}));
	return bubbles;
};

export const handleSynthesize = async (event) => {
	const chunkId = event.target.dataset.chunkId;
	const chunk = chunks.find(c => c.id === chunkId);
	if (!chunk) return;

	const synthesis = await synthesizeChunk(chunk);
	// Display synthesis in a modal or update the bubble
	await runtime.call('ui.showModal', {
		title: "Thought Synthesis",
		content: synthesis,
		actions: { "close-btn": { tag: "button", text: "Close", class: "cognition-button-primary", events: { click: "ui.closeModal" } } }
	});
};
export const getChunks = async () => ({
	chunks,
	totalThoughts: chunks.reduce((sum, c) => sum + c.thoughts.length, 0),
	threshold,
	mode
});