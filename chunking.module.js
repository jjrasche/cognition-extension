export const manifest = {
  name: "chunking",
  version: "1.0.0",
  description: "Semantic chunking for documents and text with flexible size boundaries",
  permissions: ["storage"],
  actions: ["chunkText", "chunkInferenceInteraction", "chunkDocument", "runAllTests"],
  dependencies: ["embedding"],
  state: {
    reads: [],
    writes: ["chunking.stats", "chunking.config"]
  }
};

let runtime;
export const initialize = async (rt) => { runtime = rt; };

// === PUBLIC ACTIONS ===

export const chunkText = async (params) => {
  // TODO: Implement - currently returns empty for failing tests
  const { text, minTokens = 50, maxTokens = 1000, preserveStructure = true } = params;
  return [];
};

export const chunkInferenceInteraction = async (params) => {
  // TODO: Implement - currently returns empty for failing tests
  const { userPrompt, aiResponse, metadata = {} } = params;
  return { 
    promptChunks: [], 
    responseChunks: [], 
    metadata 
  };
};

export const chunkDocument = async (params) => {
  // TODO: Implement - currently returns empty for failing tests
  const { content, documentType = 'unknown', metadata = {} } = params;
  return [];
};

// === PRIVATE HELPER FUNCTIONS ===

const createChunks = async (text, options = {}) => {
  // TODO: Core chunking orchestration
  return [];
};

const preprocessText = (text, options = {}) => {
  // TODO: Clean text - currently returns unchanged
  return text;
};

export const detectSemanticBoundaries = (text, options = {}) => {
  // TODO: Find natural break points - currently returns empty
  return [];
};

const boundaryStrengths = {
  header: 6,      
  paragraph: 4,   
  sentence: 2,    
  comma: 1        
};

const createBoundaryBasedChunks = (text, boundaries, options = {}) => {
  // TODO: Split text at boundaries while respecting token limits
  return [];
};

const estimateTokenCount = (text) => {
  // TODO: More sophisticated token estimation - currently rough estimate
  return Math.ceil(text.split(/\s+/).length * 0.75);
};

const enhanceChunks = async (rawChunks, options = {}) => {
  // TODO: Add metadata and embeddings
  return rawChunks;
};

// === UTILITY FUNCTIONS ===

const removeCodeBlocks = (text) => {
  // TODO: Remove code blocks completely
  return text;
};

const isHeaderLine = (line) => {
  // TODO: Detect markdown headers
  return false;
};

// === TEST DATA AND RUNNERS ===

const boundaryDetectionTests = [
  {
    name: "header_detection",
    input: "# Main Title\n\nContent here",
    expected: [
      { position: 0, type: 'header', strength: 6 },
      { position: 14, type: 'paragraph', strength: 4 }
    ],
    notes: "Should detect header with high strength"
  },
  {
    name: "paragraph_breaks", 
    input: "Para one.\n\nPara two.",
    expected: [
      { position: 11, type: 'paragraph', strength: 4 }
    ],
    notes: "Double newline creates paragraph boundary"
  },
  {
    name: "sentence_boundaries",
    input: "First sentence. Second sentence.",
    expected: [
      { position: 16, type: 'sentence', strength: 2 }
    ],
    notes: "Period + space + capital = sentence boundary"
  },
  {
    name: "mixed_boundaries",
    input: "# Header\n\nFirst para. Second sentence.\n\nSecond para.",
    expected: [
      { position: 0, type: 'header', strength: 6 },
      { position: 10, type: 'paragraph', strength: 4 },
      { position: 23, type: 'sentence', strength: 2 },
      { position: 42, type: 'paragraph', strength: 4 }
    ],
    notes: "Should find all boundaries, sorted by position"
  },
  {
    name: "no_boundaries",
    input: "Single sentence without breaks",
    expected: [],
    notes: "No clear break points"
  },
  {
    name: "abbreviation_false_positive",
    input: "Mr. Smith went home.",
    expected: [],
    notes: "Should NOT break on abbreviations"
  }
];

const tokenRangeTests = [
  {
    name: "under_minimum",
    input: "Short text here",  // ~3 tokens
    options: { minTokens: 10, maxTokens: 50 },
    expectedChunks: 1,
    notes: "Don't split tiny content below minimum"
  },
  {
    name: "over_maximum", 
    input: "A ".repeat(200) + "sentence. " + "B ".repeat(200) + "paragraph.",  // ~400 tokens
    options: { minTokens: 10, maxTokens: 100 },
    expectedChunks: 4,
    notes: "Should split at sentence boundary before token limit"
  },
  {
    name: "perfect_fit",
    input: "A ".repeat(80) + "content.",  // ~80 tokens
    options: { minTokens: 10, maxTokens: 100 },
    expectedChunks: 1,
    notes: "Should create single chunk when under limit"
  },
  {
    name: "boundary_respect",
    input: "A ".repeat(90) + "sentence. " + "B ".repeat(20) + "paragraph.\n\n" + "C ".repeat(10),
    options: { minTokens: 10, maxTokens: 100 },
    boundaries: [
      { position: 182, type: 'sentence', strength: 2 },  // ~90 tokens
      { position: 225, type: 'paragraph', strength: 4 }  // ~110 tokens  
    ],
    expectedSplit: 182,  // Should choose sentence at 90 tokens vs paragraph at 110
    notes: "Should respect token limit over boundary strength"
  }
];

const structurePreservationTests = [
  {
    name: "header_hierarchy",
    input: "# Main\n## Sub\nContent under sub header",
    options: { preserveStructure: true },
    expected: [
      { type: 'header', strength: 6, includesContent: true },
      { type: 'header', strength: 5, includesContent: true }
    ],
    notes: "Headers should include their content sections"
  },
  {
    name: "list_preservation",
    input: "Steps:\n1. First step\n2. Second step\n3. Third step",
    options: { preserveStructure: true },
    expectedChunks: 1,
    notes: "Should keep list items with their header"
  },
  {
    name: "quote_blocks",
    input: "> This is a quote\n> continuing here\n> end quote",
    options: { preserveStructure: true },
    expectedChunks: 1,
    notes: "Should treat quote block as single unit"
  },
  {
    name: "table_preservation",
    input: "| Col1 | Col2 |\n|------|------|\n| A    | B    |\n| C    | D    |",
    options: { preserveStructure: true },
    expectedChunks: 1,
    notes: "Should not split within table structure"
  }
];

const codeRemovalTests = [
  {
    name: "fenced_blocks",
    input: "Explanation\n```javascript\nfunction test() {}\n```\nMore text",
    expected: "Explanation\nMore text",
    notes: "Should remove fenced code blocks completely"
  },
  {
    name: "inline_code", 
    input: "Use the `forEach` method here",
    expected: "Use the  method here",
    notes: "Should remove inline backtick code completely"
  },
  {
    name: "indented_code",
    input: "Example:\n    function test() {\n        return true;\n    }\nEnd example",
    expected: "Example:\nEnd example",
    notes: "Should remove indented code lines completely"
  },
  {
    name: "mixed_code_types",
    input: "Text `inline` more.\n```\nblock code\n```\n    indented\nEnd.",
    expected: "Text  more.\nEnd.",
    notes: "Should remove all code types, preserve text flow"
  },
  {
    name: "no_false_positives",
    input: "The price is $50 and that's expensive",
    expected: "The price is $50 and that's expensive", 
    notes: "Should not remove non-code backticks/dollar signs"
  }
];

const edgeCaseTests = [
  {
    name: "empty_input",
    input: "",
    expectedChunks: 0,
    notes: "Should handle empty input gracefully"
  },
  {
    name: "single_word",
    input: "Hello",
    expectedChunks: 1,
    notes: "Should return single chunk for single word"
  },
  {
    name: "whitespace_only",
    input: "\n\n\n\t  \n",
    expectedChunks: 0,
    notes: "Should return empty for whitespace-only input"
  },
  {
    name: "all_code_blocks",
    input: "```\nfunction a() {}\n```\n```\nfunction b() {}\n```",
    expectedChunks: 0,
    expectedContent: "",
    notes: "Should return no chunks after code removal"
  },
  {
    name: "unicode_handling",
    input: "Hello 🌍 café naïve résumé",
    expectedChunks: 1,
    notes: "Should handle unicode characters without breaking"
  },
  {
    name: "very_long_sentence",
    input: "This is a ".repeat(200) + "very long sentence without any boundaries.",
    options: { minTokens: 10, maxTokens: 100 },
    expectedChunks: 2,  // Should force split
    notes: "Should gracefully force-split overlong content"
  }
];

const conversationTests = [
  {
    name: "simple_qa",
    userPrompt: "What are the benefits of communal living?",
    aiResponse: "Communal living offers economic benefits through shared resources and social benefits through community support.",
    expectedPromptChunks: 1,
    expectedResponseChunks: 1,
    notes: "Simple Q&A should create minimal chunks"
  },
  {
    name: "structured_response",
    userPrompt: "How would you organize a village community?",
    aiResponse: "# Community Organization\n\n## Housing\nShared housing reduces costs.\n\n## Governance\nParticipatory democracy works best.\n\n## Economy\nLocal currency based on labor hours.",
    expectedPromptChunks: 1,
    expectedResponseChunks: 4,  // Intro + 3 sections
    notes: "Should chunk by headers in structured response"
  },
  {
    name: "technical_with_code",
    userPrompt: "How to implement task allocation?",
    aiResponse: "Here's an approach:\n\n```javascript\nfunction allocate(tasks) {\n  return tasks;\n}\n```\n\nThis creates a fair system.",
    expectedPromptChunks: 1,
    expectedResponseChunks: 2,  // Before code + after code
    skipCodeBlocks: true,
    notes: "Should remove code blocks from response chunks"
  },
  {
    name: "asymmetric_content",
    userPrompt: "Why?",
    aiResponse: "A ".repeat(500) + "very long response with multiple paragraphs.\n\n" + "B ".repeat(300) + "second paragraph continues.",
    expectedPromptChunks: 1,
    expectedResponseChunks: 2,  // Split long response
    notes: "Should handle very short prompt + very long response"
  }
];

// Test runner functions
const runBoundaryDetectionTests = async () => {
  const results = [];
  for (const test of boundaryDetectionTests) {
    try {
      const boundaries = detectSemanticBoundaries(test.input);
      const passed = validateBoundaries(boundaries, test.expected);
      results.push({ ...test, boundaries, passed });
      runtime.log(`[Chunking Test] ${test.name}: ${passed ? 'PASS' : 'FAIL'}`);
    } catch (error) {
      results.push({ ...test, error: error.message, passed: false });
      runtime.logError(`[Chunking Test] ${test.name}: ERROR - ${error.message}`);
    }
  }
  return results;
};

const runTokenRangeTests = async () => {
  const results = [];
  for (const test of tokenRangeTests) {
    try {
      const chunks = await chunkText({ text: test.input, ...test.options });
      const passed = test.expectedChunks ? chunks.length === test.expectedChunks : validateTokenRanges(chunks, test.options);
      results.push({ ...test, actualChunks: chunks.length, passed });
      runtime.log(`[Chunking Test] ${test.name}: ${passed ? 'PASS' : 'FAIL'} (expected: ${test.expectedChunks}, got: ${chunks.length})`);
    } catch (error) { 
      results.push({ ...test, error: error.message, passed: false }); 
      runtime.logError(`[Chunking Test] ${test.name}: ERROR - ${error.message}`);
    }
  }
  return results;
};

const runConversationTests = async () => {
  const results = [];
  for (const test of conversationTests) {
    try {
      const result = await chunkInferenceInteraction({ userPrompt: test.userPrompt, aiResponse: test.aiResponse });
      const passed = ( result.promptChunks.length === test.expectedPromptChunks && result.responseChunks.length === test.expectedResponseChunks);
      results.push({ ...test, actualPrompt: result.promptChunks.length, actualResponse: result.responseChunks.length, passed });
      runtime.log(`[Chunking Test] ${test.name}: ${passed ? 'PASS' : 'FAIL'} (prompt: ${result.promptChunks.length}/${test.expectedPromptChunks}, response: ${result.responseChunks.length}/${test.expectedResponseChunks})`);
    } catch (error) { 
      results.push({ ...test, error: error.message, passed: false }); 
      runtime.logError(`[Chunking Test] ${test.name}: ERROR - ${error.message}`);
    }
  }
  return results;
};

const runCodeRemovalTests = async () => {
  const results = [];
  for (const test of codeRemovalTests) {
    try {
      const actual = removeCodeBlocks(test.input);
      const passed = actual === test.expected;
      results.push({ ...test, actual, passed });
      runtime.log(`[Chunking Test] ${test.name}: ${passed ? 'PASS' : 'FAIL'}`);
      if (!passed) {
        runtime.log(`  Expected: "${test.expected}"`);
        runtime.log(`  Actual: "${actual}"`);
      }
    } catch (error) {
      results.push({ ...test, error: error.message, passed: false });
      runtime.logError(`[Chunking Test] ${test.name}: ERROR - ${error.message}`);
    }
  }
  return results;
};

const runEdgeCaseTests = async () => {
  const results = [];
  for (const test of edgeCaseTests) {
    try {
      const chunks = await chunkText({ text: test.input, ...test.options });
      const passed = chunks.length === test.expectedChunks;
      results.push({ ...test, actualChunks: chunks.length, passed });
      runtime.log(`[Chunking Test] ${test.name}: ${passed ? 'PASS' : 'FAIL'} (expected: ${test.expectedChunks}, got: ${chunks.length})`);
    } catch (error) { 
      results.push({ ...test, error: error.message, passed: false }); 
      runtime.logError(`[Chunking Test] ${test.name}: ERROR - ${error.message}`);
    }
  }
  return results;
};

// Main test runner
export const runAllTests = async () => {
  runtime.log('[Chunking] Starting all tests...');
  
  const boundaryResults = await runBoundaryDetectionTests();
  const tokenResults = await runTokenRangeTests();
  const conversationResults = await runConversationTests();
  const codeResults = await runCodeRemovalTests();
  const edgeResults = await runEdgeCaseTests();
  
  const allResults = [...boundaryResults, ...tokenResults, ...conversationResults, ...codeResults, ...edgeResults];
  const passed = allResults.filter(r => r.passed).length;
  const total = allResults.length;
  
  runtime.log(`[Chunking] Tests complete: ${passed}/${total} passed`);
  
  return {
    summary: { passed, total, percentage: Math.round((passed/total) * 100) },
    results: {
      boundary: boundaryResults,
      tokenRange: tokenResults,
      conversation: conversationResults,
      codeRemoval: codeResults,
      edgeCase: edgeResults
    }
  };
};

// Utility validation functions
const validateBoundaries = (actual, expected) => {
  if (actual.length !== expected.length) return false;
  return expected.every((exp, i) => actual[i] && actual[i].type === exp.type && actual[i].strength === exp.strength && Math.abs(actual[i].position - exp.position) <= 2);
};

const validateTokenRanges = (chunks, options) => chunks.every(chunk => chunk.tokenCount >= options.minTokens && chunk.tokenCount <= options.maxTokens);