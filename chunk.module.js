import { calculateCosineSimilarity, calculateVariance } from "./helpers.js";
export const manifest = {
	name: "chunk",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Registry and assess chunking strategies",
	dependencies: ["chrome-sync", "embedding"],
	actions: ["chunk", "splitSentences"]
};

let runtime, model = "Xenova/all-MiniLM-L6-v2";
export const initialize = async (rt) => {
	runtime = rt;
};

export const chunk = async (text, options = {}) => {
	const { threshold = 0.3 } = options;
	const sentences = await splitSentences(text);
	const chunks = await semanticMerge(sentences, threshold);
	return {
		text,
		chunks: chunks.map((content, i) => ({ id: i, content })),
		quality: await assessQuality(chunks, text)
	};
};
const semanticMerge = async (sentences, threshold) => {
	const chunks = [];
	let currentChunk = sentences[0];
	for (let i = 1; i < sentences.length; i++) {
		const sim = await calculateChunkSimilarity(currentChunk, sentences[i]);
		if (sim > threshold) {
			currentChunk += ' ' + sentences[i];
		} else {
			chunks.push(currentChunk);
			currentChunk = sentences[i];
		}
	}
	chunks.push(currentChunk);
	return chunks;
};
export const splitSentences = async (text, options = {}) => {
	const { locale = 'en' } = options;
	const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
	return Array.from(segmenter.segment(text)).map(s => s.segment.trim());
};

// quality assessment
const assessQuality = async (chunks, text) => {
	return {
		coherence: await assessSemanticCoherence(chunks),
		boundary: await assessBoundaryQuality(chunks, text),
		size: assessSizeDistribution(chunks)
	};
};
const calculateChunkSimilarity = async (a, b) => {
	const embedding1 = await runtime.call('embedding.embedText', a, { model });
	const embedding2 = await runtime.call('embedding.embedText', b, { model });
	return calculateCosineSimilarity(embedding1, embedding2);
}
const assessSemanticCoherence = async (chunks) => {
	if (chunks.length < 2) return { avgCoherence: 1, minCoherence: 1, maxCoherence: 1, coherenceVariance: 0 };
	const scores = [];
	for (let i = 0; i < chunks.length - 1; i++) {
		scores.push(await calculateChunkSimilarity(chunks[i], chunks[i + 1]));
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
	const boundaryScores = chunks.map(text => {
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
	const sizes = chunks.map(c => c.length);
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
			const result = await chunk(text, { threshold: 0.3, model: "Xenova/all-MiniLM-L6-v2" });
			console.log(result)

			// Should have 2 chunks: AI+ML together, sports separate
			const actual = {
				chunkCount: result.chunks.length,
				firstChunkHasBoth: result.chunks[0].content.includes("AI") && result.chunks[0].content.includes("Machine learning"),
				lastChunkAboutSports: result.chunks[result.chunks.length - 1].content.includes("Sports")
			};
			const expected = { chunkCount: 2, firstChunkHasBoth: true, lastChunkAboutSports: true };
			return { actual, assert: deepEqual, expected };
		}),

		// runUnitTest("Low similarity threshold creates more chunks", async () => {
		//   const text = "The cat sat on the mat. The dog ran in the park. The bird flew in the sky.";
		//   const highThreshold = await chunk(text, { threshold: 0.9 });
		//   const lowThreshold = await chunk(text, { threshold: 0.3 });

		//   const actual = lowThreshold.chunks.length <= highThreshold.chunks.length;
		//   return { actual, assert: strictEqual, expected: true };
		// }),

		// runUnitTest("Single sentence creates single chunk", async () => {
		//   const text = "This is a single sentence.";
		//   const result = await chunk(text);

		//   const actual = { chunkCount: result.chunks.length, content: result.chunks[0].content };
		//   const expected = { chunkCount: 1, content: "This is a single sentence." };
		//   return { actual, assert: deepEqual, expected };
		// }),

		// runUnitTest("Quality assessment includes all metrics", async () => {
		//   const text = "AI helps doctors. Machine learning improves diagnosis. Sports is fun.";
		//   const result = await chunk(text);

		//   const actual = {
		//     hasCoherence: !!result.quality.coherence,
		//     hasBoundary: !!result.quality.boundary,
		//     hasSize: !!result.quality.size,
		//     coherenceHasAvg: typeof result.quality.coherence.avgCoherence === 'number'
		//   };
		//   const expected = { hasCoherence: true, hasBoundary: true, hasSize: true, coherenceHasAvg: true };
		//   return { actual, assert: deepEqual, expected };
		// }),

		// runUnitTest("Empty text handles gracefully", async () => {
		//   const text = "";
		//   try {
		//     const result = await chunk(text);
		//     return { actual: result.chunks.length, assert: strictEqual, expected: 0 };
		//   } catch (error) {
		//     return { actual: true, assert: strictEqual, expected: true }; // Either empty chunks or graceful error is fine
		//   }
		// })
	]);
};