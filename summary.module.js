export const manifest = {
  name: "summary",
  context: ["service-worker"],
  version: "1.0.0", 
  description: "Multi-level text summarization using inference providers",
  dependencies: ["inference"],
  actions: ["createMultiLevelSummary", "testLlamaSummarization"]
};

let runtime;
export const initialize = async (rt) => runtime = rt;

export const createMultiLevelSummary = async (text, options = {}) => {
  const prompt = buildSummaryPrompt(text);
const response = await runtime.call('inference.prompt', { query: prompt, ...options });
const parsed = parseSummaryResponse(response);
return { success: true, text, ...parsed, model: options.model || 'default', timestamp: new Date().toISOString() };
};

const buildSummaryPrompt = (text) => `Analyze this text and provide: ONE SENTENCE: [single sentence main point] FIVE WORDS: [exactly 5 words essence] KEY TOPIC: [1-2 words what this is about]\n\nTEXT: ${text}`;

const parseSummaryResponse = (response) => {
  try {
    const lines = response.split('\n').filter(line => line.trim());
    return {
      oneSentence: (extractAfterColon(lines.find(l => l.includes('ONE SENTENCE:'))) || 'Failed to extract').trim(),
      fiveWords: (extractAfterColon(lines.find(l => l.includes('FIVE WORDS:'))) || 'Failed to extract').trim(),
      keyTopic: (extractAfterColon(lines.find(l => l.includes('KEY TOPIC:'))) || 'Failed to extract').trim()
    };
  } catch (error) {
    runtime.logError('[Summary] Failed to parse response:', error);
    return { oneSentence: 'Parse error', fiveWords: 'Parse error', keyTopic: 'Parse error', rawResponse: response };
  }
};

const extractAfterColon = (line) => line ? line.split(':').slice(1).join(':').trim() : null;


// Test data from user's conversations
const TEST_CHUNKS = [{
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
  }
];
export const testLlamaSummarization = async (options = {}) => {  
  const results = await Promise.all(
    TEST_CHUNKS.map(async (chunk) => {
      const result = await createMultiLevelSummary(chunk.text, options);
      return { ...result, chunkId: chunk.id, category: chunk.category };
    })
  );
  const summary = {
    model: options.model || 'default',
    provider: options.provider || 'default',
    totalChunks: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    timestamp: new Date().toISOString()
  };
  
  runtime.log(`[Summary] Test complete:`, summary);
  return { results, summary };
};

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