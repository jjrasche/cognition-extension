import { calculateCosineSimilarity, calculateVariance } from "./helpers.js";
export const manifest = {
	name: "chunk",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Registry and assess chunking strategies with sentence caching",
	dependencies: ["chrome-sync", "embedding", "chrome-local"],
	actions: ["chunk", "splitSentences", "calculateChunkSimilarity", "clearSentenceCache", "getSentenceCacheStats"]
};

let runtime, model = "Xenova/all-MiniLM-L6-v2-fp16-webgpu", sentenceCache = {};
const CACHE_KEY = 'chunk_sentence_cache';

export const initialize = async (rt) => {
	runtime = rt;
	await loadSentenceCache();
};

const loadSentenceCache = async () => {
	const cached = await runtime.call('chrome-local.get', CACHE_KEY);
	sentenceCache = cached || {};
	runtime.log(`[Chunk] Loaded ${Object.keys(sentenceCache).length} cached sentence embeddings`);
};

const saveSentenceCache = async () => {
	await runtime.call('chrome-local.set', { [CACHE_KEY]: sentenceCache });
};

const getContentHash = (text) => {
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return hash.toString();
};

export const chunk = async (text, options = {}) => {
	const { threshold = 0.3, testQueries = [] } = options;
	let startTime = performance.now(), chunks, quality, retrievalPrediction;
	try {
		const sentences = await splitSentences(text);
		chunks = await semanticMerge(sentences, threshold);
		quality = await assessQuality(chunks, text);
		retrievalPrediction = await predictRetrievalSuccess(chunks, testQueries);
	} catch (e) {
		debugger;
	}
	const endTime = performance.now();
	return { text, chunks, quality, retrievalPrediction, threshold, duration: `${(endTime - startTime).toFixed(2)}ms` };
};

const semanticMerge = async (sentences, threshold) => {
	const chunks = [];
	let currentChunk = { sentences: [sentences[0]], centroid: sentences[0].embedding };
	for (let i = 1; i < sentences.length; i++) {
		const shouldMerge = calculateCosineSimilarity(currentChunk.centroid, sentences[i].embedding) > threshold;
		if (shouldMerge) {
			currentChunk.sentences.push(sentences[i]);
			currentChunk.centroid = calculateCentroid(currentChunk.sentences.map(s => s.embedding));
		} else {
			chunks.push(currentChunk);
			currentChunk = { sentences: [sentences[i]], centroid: sentences[i].embedding };
		}
	}
	chunks.push(currentChunk);
	return await Promise.all(chunks.map(async chunk => {
		const text = chunk.sentences.map(s => s.sentence).join(' ');
		const embedding = await getEmbedding(text);
		return { ...chunk, text, embedding, sentenceCount: chunk.sentences.length };
	}));
};

const calculateCentroid = (embeddings) => embeddings[0].map((_, i) => embeddings.reduce((sum, embedding) => sum + embedding[i], 0) / embeddings.length);

export const splitSentences = async (text, options = {}) => {
	const { locale = 'en' } = options;
	const contentHash = getContentHash(text);

	// Check cache first
	if (sentenceCache[contentHash]) {
		runtime.log(`[Chunk] Cache hit for content hash: ${contentHash}`);
		return sentenceCache[contentHash];
	}

	runtime.log(`[Chunk] Cache miss for content hash: ${contentHash} - computing sentences`);
	const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
	const sentences = await Promise.all(Array.from(segmenter.segment(text))
		.map(sentence => sentence.segment.trim())
		.filter(sentence => sentence.length > 0)
		.map(async sentence => ({ sentence, embedding: await getEmbedding(sentence) }))
	);

	// Cache the result
	sentenceCache[contentHash] = sentences;
	await saveSentenceCache();
	runtime.log(`[Chunk] Cached ${sentences.length} sentences for hash: ${contentHash}`);

	return sentences;
};

const getEmbedding = async (text) => await runtime.call('embedding.embedText', text, { model });

// Cache management actions
export const clearSentenceCache = async () => {
	sentenceCache = {};
	await runtime.call('chrome-local.remove', CACHE_KEY);
	runtime.log('[Chunk] Sentence cache cleared');
	return { success: true, message: 'Cache cleared' };
};

export const getSentenceCacheStats = async () => {
	const stats = {
		entryCount: Object.keys(sentenceCache).length,
		totalSentences: Object.values(sentenceCache).reduce((sum, sentences) => sum + sentences.length, 0),
		avgSentencesPerEntry: Object.keys(sentenceCache).length > 0
			? Object.values(sentenceCache).reduce((sum, sentences) => sum + sentences.length, 0) / Object.keys(sentenceCache).length
			: 0
	};
	runtime.log('[Chunk] Cache stats:', stats);
	return stats;
};

// quality assessment
const assessQuality = async (chunks, text) => {
	return {
		boundary: await assessBoundaryQuality(chunks, text),
		size: assessSizeDistribution(chunks),
		avgSentencesPerChunk: chunks.reduce((sum, c) => sum + c.sentenceCount, 0) / chunks.length,
		percentSingleSentenceChunks: chunks.filter(c => c.sentenceCount === 1).length / chunks.length
	};
};

const assessBoundaryQuality = async (chunks, originalText) => {
	let currentIndex = 0;
	const boundaryScores = chunks.map(chunk => {
		const text = chunk.text;
		const startIndex = originalText.indexOf(text, currentIndex);
		const endIndex = startIndex + text.length;
		currentIndex = endIndex;
		const beforeChar = originalText[startIndex - 1] || '';
		const afterChar = originalText[endIndex] || '';
		const startsClean = /\s/.test(beforeChar) || startIndex === 0;
		const endsClean = /[.!?]$/.test(text.trim()) || /[.!?]\s/.test(text.slice(-2)) || /\s/.test(afterChar);
		return {
			startsClean: startsClean ? 1 : 0,
			endsClean: endsClean ? 1 : 0,
			overall: (startsClean && endsClean) ? 1 : 0
		};
	});
	return {
		avgBoundaryQuality: boundaryScores.reduce((sum, s) => sum + s.overall, 0) / boundaryScores.length,
		cleanStarts: boundaryScores.filter(s => s.startsClean).length / boundaryScores.length,
		cleanEnds: boundaryScores.filter(s => s.endsClean).length / boundaryScores.length
	};
};

const assessSizeDistribution = (chunks) => {
	const sizes = chunks.map(c => c.text.length);
	return {
		avgSize: sizes.reduce((sum, s) => sum + s, 0) / sizes.length,
		minSize: Math.min(...sizes),
		maxSize: Math.max(...sizes),
		sizeVariance: calculateVariance(sizes),
		sizeStdDev: Math.sqrt(calculateVariance(sizes))
	};
};

const predictRetrievalSuccess = async (chunks, testQueries) => {
	if (!testQueries?.length) return { confidence: 0.5, reason: 'No test queries provided' };

	const predictions = await Promise.all(testQueries.map(async query => {
		const similarities = chunks.map(chunk => calculateCosineSimilarity(query.embedding, chunk.embedding)).sort((a, b) => b - a);
		return {
			query,
			bestMatch: similarities[0],
			top10Avg: similarities.slice(0, 10).reduce((sum, s) => sum + s, 0) / Math.min(10, similarities.length),
			coverage: similarities.filter(s => s > 0.5).length / similarities.length
		};
	}));

	const avgBestMatch = predictions.reduce((sum, p) => sum + p.bestMatch, 0) / predictions.length;
	const avgCoverage = predictions.reduce((sum, p) => sum + p.coverage, 0) / predictions.length;

	return {
		confidence: (avgBestMatch * 0.6) + (avgCoverage * 0.4),
		predictions,
		avgBestMatch,
		avgCoverage
	};
};
