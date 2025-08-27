import { getId, calculateCosineSimilarity } from "./helpers.js";

export const manifest = {
	name: "live-chunker",
	context: ["extension-page"],
	version: "2.0.0",
	description: "Real-time hierarchical thought clustering with dynamic re-clustering",
	dependencies: ["web-speech-stt", "ui", "embedding", "summary"],
	actions: ["startDemo", "stopDemo", "processThought", "getClusters", "setThreshold", "setMode", "handleClusterClick", "handleSynthesize"],
};

let runtime, clusters = [], isActive = false, threshold = 0.4, mode = 'view';
let processingDuration = 0;
let selectedForMerge = null;

const thoughts = [
	{ text: "I'm thinking about building a new application", pause: 2000 }, // 2 sec pause
	{ text: "it would be really cool to use AI for clustering thoughts", pause: 3000 }, // 3 sec pause - related to first
	{ text: "maybe I should grab some coffee first", pause: 5000 }, // 5 sec pause - topic change
	{ text: "actually tea sounds better today", pause: 1000 }, // 1 sec pause - related to coffee
	{ text: "the weather is really nice outside", pause: 4000 }, // 4 sec pause - new topic
	{ text: "perfect for a walk in the park", pause: 1500 }, // 1.5 sec pause - related to weather
	{ text: "I wonder how the clustering algorithm handles similar concepts", pause: 6000 }, // 6 sec pause - back to tech
	{ text: "semantic similarity is fascinating", pause: 2000 } // 2 sec pause - related to clustering
];
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
	clusters = [];
	selectedForMerge = null;
	await runtime.call('web-speech-stt.startListening');
	await renderClusterUI();
	return { success: true, message: 'Live clustering demo started' };
};

export const stopDemo = async () => {
	isActive = false;
	mode = 'view';
	selectedForMerge = null;
	await runtime.call('web-speech-stt.stopListening');
	return { success: true, message: 'Live clustering demo stopped' };
};

export const processThought = async (thought) => {
	if (!isActive) return;

	const startTime = performance.now();

	// Embed the thought once and cache it
	const embedding = await runtime.call('embedding.embedText', thought.text);
	const enrichedThought = { ...thought, embedding, id: thought.id || getId('thought-') };

	// Add to thoughts collection
	thoughts.push(enrichedThought);

	// Re-cluster all thoughts with current threshold
	clusters = await hierarchicalCluster(thoughts, threshold);

	// Add synthesis to clusters with multiple thoughts
	for (const cluster of clusters.filter(c => c.thoughts.length > 1)) {
		if (!cluster.synthesis || cluster.thoughts.length !== cluster.lastSynthesisCount) {
			await addSynthesis(cluster);
		}
	}

	// Update graph connections for each cluster
	for (const cluster of clusters) {
		cluster.orbitingNodes = await getOrbitingNodes(cluster);
	}

	processingDuration = performance.now() - startTime;
	await renderClusterUI();
};

const hierarchicalCluster = async (allThoughts, baseThreshold) => {
	if (allThoughts.length === 0) return [];

	// More lenient for thought-thought merging, stricter for cluster-cluster
	const thoughtThreshold = baseThreshold * 1.2; // More lenient
	const clusterThreshold = baseThreshold * 0.8; // More strict

	// Initialize: each thought is its own cluster
	let currentClusters = allThoughts.map(thought => ({
		thoughts: [thought],
		centroid: thought.embedding,
		id: getId('cluster-'),
		isOriginalThought: true
	}));

	while (true) {
		const bestMerge = findBestMergeCandidate(currentClusters);
		runtime.log(`${(bestMerge.similarity * 100).toFixed(1)}% \n\t C1: "${bestMerge.cluster1.thoughts[0]?.text || 'Empty'}" (${bestMerge.cluster1.thoughts.length}) \n\t C2: "${bestMerge.cluster2.thoughts[0]?.text || 'Empty'}" (${bestMerge.cluster2.thoughts.length}) \n\t ${bestMerge.bothAreClusters ? 'Cluster-Cluster' : 'Thought-Thought'} merge`)
		if (!bestMerge) break;

		// Use appropriate threshold based on what we're merging
		const activeThreshold = (bestMerge.bothAreClusters) ? clusterThreshold : thoughtThreshold;

		if (bestMerge.similarity < activeThreshold) break;

		// Merge the two best candidates
		const merged = mergeClusters(bestMerge.cluster1, bestMerge.cluster2);
		currentClusters = currentClusters.filter(c => c !== bestMerge.cluster1 && c !== bestMerge.cluster2);
		currentClusters.push(merged);
	}

	// Cleanup pass: remove thoughts too distant from cluster centroids
	let displacedThoughts = [];
	currentClusters = currentClusters.map(cluster => {
		if (cluster.thoughts.length === 1) return cluster; // Single thoughts can't be displaced

		const displaced = cluster.thoughts.filter(thought =>
			calculateCosineSimilarity(thought.embedding, cluster.centroid) < baseThreshold
		);

		if (displaced.length > 0) {
			displacedThoughts.push(...displaced);
			const remaining = cluster.thoughts.filter(t => !displaced.includes(t));

			if (remaining.length === 0) return null; // Cluster dissolved

			return {
				...cluster,
				thoughts: remaining,
				centroid: calculateCentroid(remaining.map(t => t.embedding))
			};
		}

		return cluster;
	}).filter(Boolean);

	// Recursively re-cluster displaced thoughts
	if (displacedThoughts.length > 0) {
		const newClusters = await hierarchicalCluster(displacedThoughts, baseThreshold);
		currentClusters.push(...newClusters);
	}

	return currentClusters;
};

const findBestMergeCandidate = (currentClusters) => {
	let bestSimilarity = -1;
	let bestPair = null;

	for (let i = 0; i < currentClusters.length; i++) {
		for (let j = i + 1; j < currentClusters.length; j++) {
			const similarity = calculateCosineSimilarity(
				currentClusters[i].centroid,
				currentClusters[j].centroid
			);

			if (similarity > bestSimilarity) {
				bestSimilarity = similarity;
				bestPair = {
					cluster1: currentClusters[i],
					cluster2: currentClusters[j],
					similarity,
					bothAreClusters: !currentClusters[i].isOriginalThought && !currentClusters[j].isOriginalThought
				};
			}
		}
	}

	return bestPair;
};

const mergeClusters = (cluster1, cluster2) => ({
	thoughts: [...cluster1.thoughts, ...cluster2.thoughts].sort((a, b) => a.timestamp - b.timestamp),
	centroid: calculateCentroid([...cluster1.thoughts, ...cluster2.thoughts].map(t => t.embedding)),
	id: getId('cluster-'),
	isOriginalThought: false,
	mergedFrom: [cluster1.id, cluster2.id]
});

const calculateCentroid = (embeddings) => {
	const dims = embeddings[0].length;
	const centroid = new Array(dims).fill(0);

	for (const embedding of embeddings) {
		for (let i = 0; i < dims; i++) {
			centroid[i] += embedding[i];
		}
	}

	return centroid.map(val => val / embeddings.length);
};

const addSynthesis = async (cluster) => {
	try {
		const allText = cluster.thoughts.map(t => t.text).join(' ');
		cluster.synthesis = await runtime.call('summary.summarize', allText);
		cluster.lastSynthesisCount = cluster.thoughts.length;
		cluster.synthesisAt = new Date().toISOString();
	} catch (error) {
		runtime.logError('[Live-Chunker] Synthesis failed:', error);
		cluster.synthesis = { oneSentence: 'Synthesis failed', keyWords: '', mainTopics: '' };
	}
};

const getOrbitingNodes = async (cluster) => {
	const allText = cluster.thoughts.map(t => t.text).join(' ');
	const relatedNodes = await runtime.call('graph-db.searchByText', { text: allText, threshold: 0.4 });

	return relatedNodes.slice(0, 5).map(node => ({
		id: node.id,
		text: (node.content || 'No content').substring(0, 80) + '...',
		similarity: node.similarity || 0,
		distance: 1 - (node.similarity || 0)
	}));
};

export const setThreshold = async (event) => {
	threshold = parseFloat(event.target.value);

	// Re-cluster all thoughts with new threshold
	if (thoughts.length > 0) {
		const startTime = performance.now();
		clusters = await hierarchicalCluster(thoughts, threshold);

		// Re-synthesize clusters that changed
		for (const cluster of clusters.filter(c => c.thoughts.length > 1)) {
			await addSynthesis(cluster);
			cluster.orbitingNodes = await getOrbitingNodes(cluster);
		}

		processingDuration = performance.now() - startTime;
	}

	await renderClusterUI();
	runtime.log(`[Live-Chunker] Re-clustered with threshold: ${threshold}`);
};

export const setMode = async (eventOrMode) => {
	const newMode = typeof eventOrMode === 'string' ? eventOrMode : eventOrMode.target.dataset.mode;
	mode = mode === newMode ? 'view' : newMode;
	selectedForMerge = null;
	await renderClusterUI();
	runtime.log(`[Live-Chunker] Mode: ${mode}`);
};

export const handleClusterClick = async (event) => {
	const clusterId = event.target.closest('[data-cluster-id]').dataset.clusterId;

	if (mode === 'delete') {
		await deleteCluster(clusterId);
	} else if (mode === 'merge') {
		await handleMergeClick(clusterId);
	}
};

const handleMergeClick = async (clusterId) => {
	if (!selectedForMerge) {
		selectedForMerge = clusterId;
		await renderClusterUI();
		runtime.log(`[Live-Chunker] Selected cluster for merge: ${clusterId}`);
	} else if (selectedForMerge === clusterId) {
		selectedForMerge = null;
		await renderClusterUI();
		runtime.log(`[Live-Chunker] Deselected cluster`);
	} else {
		await manualMergeClusters(selectedForMerge, clusterId);
	}
};

const manualMergeClusters = async (cluster1Id, cluster2Id) => {
	const cluster1Index = clusters.findIndex(c => c.id === cluster1Id);
	const cluster2Index = clusters.findIndex(c => c.id === cluster2Id);

	if (cluster1Index === -1 || cluster2Index === -1) return;

	const merged = mergeClusters(clusters[cluster1Index], clusters[cluster2Index]);
	clusters = clusters.filter((_, i) => i !== cluster1Index && i !== cluster2Index);
	clusters.push(merged);

	await addSynthesis(merged);
	merged.orbitingNodes = await getOrbitingNodes(merged);

	selectedForMerge = null;
	mode = 'view';
	await renderClusterUI();
	runtime.log(`[Live-Chunker] Manually merged clusters`);
};

const deleteCluster = async (clusterId) => {
	const index = clusters.findIndex(c => c.id === clusterId);
	if (index === -1) return;

	// Remove cluster's thoughts from thoughts array
	const clusterThoughts = clusters[index].thoughts;
	thoughts = thoughts.filter(t => !clusterThoughts.includes(t));
	clusters.splice(index, 1);

	mode = 'view';
	await renderClusterUI();
	runtime.log(`[Live-Chunker] Deleted cluster and its thoughts`);
};

export const handleSynthesize = async (event) => {
	const clusterId = event.target.dataset.clusterId;
	const cluster = clusters.find(c => c.id === clusterId);
	if (!cluster) return;

	await runtime.call('ui.showModal', {
		title: "Cluster Synthesis",
		content: `
			<div style="margin-bottom: 16px;">
				<strong>Summary:</strong> ${cluster.synthesis?.oneSentence || 'No synthesis available'}
			</div>
			<div style="margin-bottom: 16px;">
				<strong>Key Words:</strong> ${cluster.synthesis?.keyWords || 'None'}
			</div>
			<div style="margin-bottom: 16px;">
				<strong>Main Topics:</strong> ${cluster.synthesis?.mainTopics || 'None'}
			</div>
			<div style="font-size: 12px; color: #666;">
				${cluster.thoughts.length} thoughts • Generated ${cluster.synthesisAt ? new Date(cluster.synthesisAt).toLocaleTimeString() : 'never'}
			</div>
		`,
		actions: { "close-btn": { tag: "button", text: "Close", class: "cognition-button-primary", events: { click: "ui.closeModal" } } }
	});
};

const renderClusterUI = async () => {
	const tree = {
		"cluster-container": {
			tag: "div", class: "cluster-container", style: "padding: 20px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;",
			"controls": {
				tag: "div", style: "margin-bottom: 20px; display: flex; gap: 15px; align-items: center; flex-wrap: wrap;",
				"threshold-control": {
					tag: "label", text: `Similarity Threshold: ${threshold} `, style: "display: flex; align-items: center; gap: 8px; font-size: 14px;",
					"threshold-slider": { tag: "input", type: "range", min: "0.1", max: "0.9", step: "0.05", value: threshold.toString(), events: { input: "live-chunker.setThreshold" }, style: "width: 120px;" }
				},
				"stats": {
					tag: "div", style: "font-size: 12px; color: #666; display: flex; gap: 12px;",
					"thought-count": { tag: "span", text: `${thoughts.length} thoughts`, style: "background: #e8f4f8; padding: 4px 8px; border-radius: 4px;" },
					"cluster-count": { tag: "span", text: `${clusters.length} clusters`, style: "background: #f0f8e8; padding: 4px 8px; border-radius: 4px;" },
					"performance": { tag: "span", text: `${processingDuration.toFixed(1)}ms`, style: "background: #f8f0e8; padding: 4px 8px; border-radius: 4px;" }
				},
				"mode-buttons": {
					tag: "div", style: "display: flex; gap: 8px;",
					"merge-btn": { tag: "button", text: mode === 'merge' ? "✓ Merge (M)" : "Merge (M)", class: mode === 'merge' ? "cognition-button-primary" : "cognition-button-secondary", events: { click: "live-chunker.setMode" }, "data-mode": "merge", style: "font-size: 12px; padding: 6px 12px;" },
					"delete-btn": { tag: "button", text: mode === 'delete' ? "✓ Delete (D)" : "Delete (D)", class: mode === 'delete' ? "cognition-button-primary" : "cognition-button-secondary", events: { click: "live-chunker.setMode" }, "data-mode": "delete", style: "font-size: 12px; padding: 6px 12px;" }
				}
			},
			"clusters": { tag: "div", style: "display: flex; flex-wrap: wrap; gap: 15px;", ...createClusterBubbles() }
		}
	};

	await runtime.call('ui.renderTree', tree);
};

const createClusterBubbles = () => {
	const bubbles = {};

	clusters.forEach((cluster, index) => {
		const bubbleId = `cluster-${cluster.id}`;
		const thoughtCount = cluster.thoughts.length;
		const allText = cluster.thoughts.map(t => t.text).join(' ');
		const previewText = allText.length > 120 ? allText.substring(0, 117) + '...' : allText;

		const isSelected = selectedForMerge === cluster.id;
		const isInteractive = mode === 'merge' || mode === 'delete';

		// Color calculation
		const hue = (index * 60) % 360;
		const saturation = thoughtCount === 1 ? '50%' : '70%';
		const lightness = thoughtCount === 1 ? '90%' : '85%';
		const baseColor = `hsl(${hue}, ${saturation}, ${lightness})`;
		const borderColor = `hsl(${hue}, ${saturation}, 70%)`;

		let backgroundColor = baseColor;
		let borderWidth = '2px';

		if (mode === 'delete') {
			backgroundColor = `hsl(0, 60%, 90%)`;
		} else if (isSelected) {
			backgroundColor = `hsl(${hue}, 80%, 75%)`;
			borderWidth = '3px';
		}

		bubbles[bubbleId] = {
			tag: "div",
			class: `cluster-bubble ${isInteractive ? 'interactive' : ''}`,
			style: `background: ${backgroundColor}; border-radius: 15px; padding: 12px 16px; border: ${borderWidth} solid ${borderColor}; max-width: 320px; min-width: 200px; cursor: ${isInteractive ? 'pointer' : 'default'}; opacity: ${mode === 'view' ? '1' : '0.85'}; transition: all 0.2s ease; box-shadow: ${isSelected ? '0 4px 12px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.1)'}; transform: ${isSelected ? 'translateY(-2px)' : 'none'};`,
			events: isInteractive ? { click: "live-chunker.handleClusterClick" } : {},
			"data-cluster-id": cluster.id,
			title: allText,
			[`${bubbleId}-header`]: {
				tag: "div", style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;",
				[`${bubbleId}-count`]: { tag: "div", text: `${thoughtCount} thought${thoughtCount > 1 ? 's' : ''}`, style: "font-size: 11px; color: #666; font-weight: bold;" },
				...(thoughtCount > 1 && {
					[`${bubbleId}-type`]: { tag: "div", text: "CLUSTER", style: "font-size: 9px; background: rgba(0,0,0,0.1); padding: 2px 6px; border-radius: 8px; color: #333;" }
				})
			},
			[`${bubbleId}-text`]: { tag: "div", text: previewText, style: "font-size: 13px; line-height: 1.4; color: #333; margin-bottom: 8px;" },

			// Synthesis section for multi-thought clusters
			...(cluster.synthesis && {
				[`${bubbleId}-synthesis`]: {
					tag: "div", style: "background: rgba(255,255,255,0.6); padding: 8px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid rgba(0,0,0,0.2);",
					[`${bubbleId}-synthesis-text`]: { tag: "div", text: cluster.synthesis.oneSentence, style: "font-size: 12px; font-style: italic; color: #444; margin-bottom: 4px;" },
					[`${bubbleId}-synthesis-keywords`]: { tag: "div", text: `Keywords: ${cluster.synthesis.keyWords}`, style: "font-size: 10px; color: #666;" }
				}
			}),

			// Controls
			[`${bubbleId}-controls`]: {
				tag: "div", style: "display: flex; gap: 6px; margin-top: 8px;",
				...(thoughtCount > 1 && {
					[`${bubbleId}-synthesize`]: { tag: "button", text: "💡", class: "cognition-button-secondary", style: "font-size: 12px; padding: 4px 8px;", events: { click: "live-chunker.handleSynthesize" }, "data-cluster-id": cluster.id, title: "View synthesis" }
				})
			},

			// Selection indicator
			...(isSelected && {
				[`${bubbleId}-selected`]: { tag: "div", text: "✓ Selected for merge", style: "font-size: 10px; color: #0066cc; margin-top: 6px; font-weight: bold;" }
			}),

			// Orbiting nodes
			...(cluster.orbitingNodes && cluster.orbitingNodes.length > 0 && {
				[`${bubbleId}-orbiting`]: {
					tag: "div", style: "margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1);",
					[`${bubbleId}-orbit-label`]: { tag: "div", text: "Related:", style: "font-size: 9px; color: #666; margin-bottom: 4px;" },
					[`${bubbleId}-orbit-list`]: {
						tag: "div", style: "display: flex; flex-wrap: wrap; gap: 4px;",
						...cluster.orbitingNodes.reduce((orbitBubbles, node, i) => {
							orbitBubbles[`${bubbleId}-orbit-${i}`] = {
								tag: "div",
								style: "display: inline-block; padding: 2px 6px; background: rgba(255,255,255,0.8); border-radius: 8px; font-size: 9px; cursor: pointer; border: 1px solid #ddd;",
								text: node.text.substring(0, 30) + (node.text.length > 30 ? '...' : ''),
								title: `${node.text} (${(node.similarity * 100).toFixed(1)}% similar)`
							};
							return orbitBubbles;
						}, {})
					}
				}
			})
		};
	});

	return bubbles;
};

export const getClusters = async () => ({
	thoughts: thoughts.length,
	clusters: clusters.length,
	threshold,
	mode,
	details: clusters.map(c => ({
		id: c.id,
		thoughtCount: c.thoughts.length,
		hasSynthesis: !!c.synthesis,
		orbitingNodes: c.orbitingNodes?.length || 0
	}))
});