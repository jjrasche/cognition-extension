export const manifest = {
	name: "summary",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Multi-level text summarization using inference providers",
	dependencies: ["inference"],
	actions: ["summarize", "evaluate"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const summarize = async (text, options = {}) => {
	const prompt = buildSummaryPrompt(text);
	const response = await runtime.call('inference.prompt', { query: prompt, ...options });
	return parseSummaryResponse(response);
};

const buildSummaryPrompt = (text) => `You must respond with ONLY valid JSON in this exact format:

{
  "oneSentence": "[comprehensive sentence]",
  "keyWords": "[3-5 keywords separated by commas]", 
  "mainTopics": "[2-4 topics separated by commas]"
}

Use comma-separated strings, not arrays.

TEXT: ${text}`;

const parseSummaryResponse = (response) => {
	try {
		// Clean and extract JSON
		let jsonStr = response.trim();
		const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			jsonStr = jsonMatch[0];
		}

		// Repair incomplete JSON
		if (!jsonStr.endsWith('}')) {
			jsonStr += '}';
		}

		// Parse JSON
		const parsed = JSON.parse(jsonStr);

		// Handle both array and string formats
		const extractValue = (value) => {
			if (Array.isArray(value)) {
				return value.join(', ');  // Convert arrays to comma-separated strings
			}
			return value || 'Failed to extract';
		};

		return {
			oneSentence: parsed.oneSentence || 'Failed to extract',
			keyWords: extractValue(parsed.keyWords),
			mainTopics: extractValue(parsed.mainTopics)
		};

	} catch (error) {
		runtime.logError('[Summary] JSON parse failed:', error);
		return {
			oneSentence: 'Failed to extract',
			keyWords: 'Failed to extract',
			mainTopics: 'Failed to extract'
		};
	}
};
export const evaluate = async (options = {}) => await Promise.all([{
	id: "chunking_strategy",
	text: `You're right to question this - we actually didn't definitively settle on it. Let me recap where we left the discussion: Your Initial Question: Should we replace token-based entirely and focus purely on structural components? Your Concerns: 'I don't think there should be any overlap' (We agreed on this), 'I'm not sure if I should throw my entire strategy into assuming punctuation and structure' (This was still uncertain), You questioned whether very long sentences should matter in a pure structure approach. My Recommendation: Try pure structure first, add token guardrails only if needed. Your Response: 'I am working on the four level sentence paragraph section document concept' (but you didn't explicitly approve removing tokens entirely). We have two options: Option A: Pure Structure (No Token Limits) granularity: 'sentence' → Split on sentences, regardless of size, granularity: 'paragraph' → Split on paragraphs, regardless of size. Option B: Structure + Token Safety Net granularity: 'sentence', maxTokens: 100 → Prefer sentences, but split if too long, granularity: 'paragraph', maxTokens: 300 → Prefer paragraphs, but split if too long.`,
	category: "technical_strategy"
}, {
	id: "boundary_strength",
	text: `Boundary strength determines which boundary to choose when splitting - think of it as 'how natural is this break point?' The boundaryStrengths concept uses values like header: 6 (strongest - always a good place to split), paragraph: 4 (very natural break), sentence: 2 (okay break point), comma: 1 (weak - only if desperate). For example, if you have 950 tokens and maxTokens=1000, and you can split at Token 920: Sentence boundary (strength 2) or Token 980: Paragraph boundary (strength 4), you should choose the paragraph boundary even though it's closer to the limit, because it's a more natural break. This approach handles cases where you need to find the most semantically coherent split point within token constraints, balancing the technical requirement for size limits with the human need for meaningful content boundaries.`,
	category: "algorithmic_concept"
}, {
	id: "test_architecture",
	text: `Kitchen Sink Tests using actual Claude exports should include Simple Q&A: Short question + paragraph response → Should create 1 prompt chunk + 1-2 response chunks, Multi-section response: Question + response with headers/lists → Should chunk by structure, Technical discussion: Question about code + response with code blocks → Should remove code from response chunks, Long philosophical discussion: Complex prompt + multi-paragraph response → Should respect thought boundaries, and Edge conversation: Very short prompt + very long response → Should handle asymmetry. The kitchen sink tests will use real downloaded Claude conversations to test the full pipeline with authentic data structure and complexity. Very long single sentence: 2000-token sentence with no internal boundaries → Should force-split gracefully. Real Conversation Format function chunkInferenceInteraction({userPrompt, aiResponse}) tests boundaries using actual conversation data to ensure the chunking algorithm handles real-world complexity and edge cases properly.`,
	category: "testing_methodology"
}].map(async (chunk) => ({ ...await summarize(chunk.text, options), chunkId: chunk.id, category: chunk.category })));

// testing
export const test = async () => {
	const { runUnitTest, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Parse summary response correctly", async () => {
			const mockResponse = `ONE SENTENCE: This discusses chunking strategies for text processing.\nFIVE WORDS: chunking strategies text processing discussion\nKEY TOPIC: text processing`;
			const actual = parseSummaryResponse(mockResponse);
			const expected = { oneSentence: "This discusses chunking strategies for text processing.", fiveWords: "chunking strategies text processing discussion", keyTopic: "text processing" };
			return { actual, assert: deepEqual, expected };
		})
	];
};