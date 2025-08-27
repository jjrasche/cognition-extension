import { calculateCosineSimilarity, calculateVariance } from "./helpers.js";
export const manifest = {
	name: "chunk",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Registry and assess chunking strategies",
	dependencies: ["chrome-sync", "embedding"],
	actions: ["chunk", "splitSentences", "calculateChunkSimilarity"]
};

let runtime, model = "Xenova/all-MiniLM-L6-v2-fp16-webgpu";
export const initialize = async (rt) => {
	runtime = rt;
};

export const chunk = async (text, options = {}) => {
	const { threshold = 0.3 } = options;
	const startTime = performance.now();
	const sentences = await splitSentences(text);
	const chunks = await semanticMerge(sentences, threshold);
	const quality = await assessQuality(chunks, text);
	const endTime = performance.now();
	return { text, chunks, quality, duration: `${(endTime - startTime).toFixed(2)}ms` };
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
		const embedding = await runtime.call('embedding.embedText', text, { model });
		return { ...chunk, text, embedding };
	}));
};
const calculateCentroid = (embeddings) => embeddings[0].map((_, i) => embeddings.reduce((sum, embedding) => sum + embedding[i], 0) / embeddings.length);
export const splitSentences = async (text, options = {}) => {
	const { locale = 'en' } = options;
	const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
	const sentences = await Promise.all(Array.from(segmenter.segment(text))
		.map(sentence => sentence.segment.trim())
		.map(sentence => ({ sentence, embedding: getEmbedding(sentence) }))
	);
	return sentences;
};
const getEmbedding = async (text) => await runtime.call('embedding.embedText', text, { model });

// quality assessment
const assessQuality = async (chunks, text) => {
	return {
		coherence: await assessSemanticCoherence(chunks),
		boundary: await assessBoundaryQuality(chunks, text),
		size: assessSizeDistribution(chunks)
	};
};
const assessSemanticCoherence = async (chunks) => {
	if (chunks.length < 2) return { avgCoherence: 1, minCoherence: 1, maxCoherence: 1, coherenceVariance: 0 };
	const scores = [];
	for (let i = 0; i < chunks.length - 1; i++) {
		scores.push(calculateCosineSimilarity(chunks[i].embedding, chunks[i + 1].embedding));
	}
	return {
		avgCoherence: scores.reduce((sum, s) => sum + s, 0) / scores.length,
		minCoherence: Math.min(...scores),
		maxCoherence: Math.max(...scores),
		coherenceVariance: calculateVariance(scores)
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

// testing
export const test = async () => {
	const { runUnitTest, deepEqual, strictEqual } = runtime.testUtils;

	return await Promise.all([
		runUnitTest("High similarity sentences merge into single chunk", async () => {
			const text = `AI is transforming healthcare rapidly. Machine learning helps doctors diagnose diseases accurately. Quantum computing represents the future of computation. The solar system contains eight planets orbiting the sun. Mars has two small moons named Phobos and Deimos. Jupiter is the largest planet with over 70 moons. Saturn's rings are made of ice and rock particles. Neptune is the windiest planet in our solar system. Basketball requires teamwork and strategy. Professional athletes train for many hours daily.`
			const result = await chunk(text, { threshold: 0.3, model: "Xenova/all-MiniLM-L6-v2-fp16-webgpu" });
			console.log(result)

			// Should have 2 chunks: AI+ML together, sports separate
			const actual = {
				chunkCount: result.chunks.length,
				firstChunkHasBoth: result.chunks[0].includes("AI") && result.chunks[0].includes("Machine learning"),
			};
			const expected = { chunkCount: 5, firstChunkHasBoth: true };
			return { actual, assert: deepEqual, expected };
		}),
	]);
};