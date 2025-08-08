export const manifest = {
  name: "chunking",
  version: "1.0.0",
  description: "Semantic chunking for documents and text with flexible size boundaries",
  permissions: ["storage"],
  actions: ["chunkText", "chunkInferenceInteraction", "chunkDocument", "testWithClaudeData"],
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
  // params: { text, minTokens=50, maxTokens=1000, preserveStructure=true }
  // returns: array of chunks with metadata
};

// export const chunkInferenceInteraction = async (params) => {
//   // params: { userPrompt, aiResponse, metadata={} }
//   // returns: { promptChunks[], responseChunks[], metadata }
//   // Special handling: skip code blocks in AI responses
// };

export const chunkDocument = async (params) => {
  // params: { content, documentType='unknown', metadata={} }
  // returns: array of chunks optimized for document type
};

// === PRIVATE HELPER FUNCTIONS ===

const createChunks = async (text, options = {}) => {
  // Core chunking orchestration
  // 1. Preprocess text (remove code blocks, normalize)
  // 2. Detect semantic boundaries (headers, paragraphs, sentences)
  // 3. Create chunks within token range (50-1000)
  // 4. Enhance with metadata
};

const preprocessText = (text, options = {}) => {
  // Clean text: remove code blocks, normalize whitespace, clean markdown
};

const detectSemanticBoundaries = (text, options = {}) => {
  // Find natural break points:
  // - Headers (# ## ###)
  // - Paragraph breaks (double newlines)
  // - Strong sentence boundaries (.!? followed by capital)
  // Returns: [{ position, type, strength }]
};

const boundaryStrengths = {
  header: 6,      // # ## ### (strongest - always a good place to split)
  paragraph: 4,   // Double newline (very natural break)
  sentence: 2,    // Period + capital letter (okay break point)
  comma: 1        // Comma (weak - only if desperate)
};

const createBoundaryBasedChunks = (text, boundaries, options = {}) => {
  // Split text at boundaries while respecting min/max token limits
  // Strategy: grow chunks until maxTokens, split at strongest boundary
};

const estimateTokenCount = (text) => {
  // Rough token estimation: ~0.75 tokens per word
};

const enhanceChunks = async (rawChunks, options = {}) => {
  // Add metadata: token count, position, type, embeddings
};

// === UTILITY FUNCTIONS ===

const removeCodeBlocks = (text) => {
  // Remove: ```code```, `inline`, indented blocks
};

const isHeaderLine = (line) => {
  // Detect markdown headers or title-case lines
};

const getDocumentTypeConfig = (documentType) => {
  // Return chunking config based on document type
  // 'conversation', 'technical', 'narrative', etc.
};

// Test data for chunking module - following existing module code style

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
    expected: "Explanation\n[CODE_BLOCK_REMOVED]\nMore text",
    notes: "Should remove fenced code blocks"
  },
  {
    name: "inline_code", 
    input: "Use the `forEach` method here",
    expected: "Use the [CODE_REMOVED] method here",
    notes: "Should remove inline backtick code"
  },
  {
    name: "indented_code",
    input: "Example:\n    function test() {\n        return true;\n    }\nEnd example",
    expected: "Example:\n[CODE_LINE_REMOVED]\n[CODE_LINE_REMOVED]\n[CODE_LINE_REMOVED]\nEnd example",
    notes: "Should remove indented code lines"
  },
  {
    name: "mixed_code_types",
    input: "Text `inline` more.\n```\nblock code\n```\n    indented\nEnd.",
    expected: "Text [CODE_REMOVED] more.\n[CODE_BLOCK_REMOVED]\n[CODE_LINE_REMOVED]\nEnd.",
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
    expectedChunks: 1,
    expectedContent: "[CODE_BLOCK_REMOVED]\n[CODE_BLOCK_REMOVED]",
    notes: "Should return minimal chunk after code removal"
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

// Test runner functions matching existing module style
const runBoundaryDetectionTests = async (chunkingModule) => {
  const results = [];
  for (const test of boundaryDetectionTests) {
    try {
      const boundaries = await chunkingModule.detectSemanticBoundaries(test.input);
      const passed = validateBoundaries(boundaries, test.expected);
      results.push({ ...test, boundaries, passed });
    } catch (error) {
      results.push({ ...test, error: error.message, passed: false });
    }
  }
  return results;
};

const runTokenRangeTests = async (chunkingModule) => {
  const results = [];
  for (const test of tokenRangeTests) {
    try {
      const chunks = await chunkingModule.chunkText({ text: test.input, ...test.options });
      const passed = test.expectedChunks ? chunks.length === test.expectedChunks : validateTokenRanges(chunks, test.options);
      results.push({ ...test, actualChunks: chunks.length, passed });
    } catch (error) { results.push({ ...test, error: error.message, passed: false }); }
  }
  return results;
};

const runConversationTests = async (chunkingModule) => {
  const results = [];
  for (const test of conversationTests) {
    try {
      const result = await chunkingModule.chunkInferenceInteraction({ userPrompt: test.userPrompt, aiResponse: test.aiResponse });
      const passed = ( result.promptChunks.length === test.expectedPromptChunks && result.responseChunks.length === test.expectedResponseChunks);
      results.push({ ...test, actualPrompt: result.promptChunks.length, actualResponse: result.responseChunks.length, passed });
    } catch (error) { results.push({ ...test, error: error.message, passed: false }); }
  }
  return results;
};

// Utility validation functions
const validateBoundaries = (actual, expected) => {
  if (actual.length !== expected.length) return false;
  return expected.every((exp, i) => actual[i] && actual[i].type === exp.type && actual[i].strength === exp.strength && Math.abs(actual[i].position - exp.position) <= 2);
};

const validateTokenRanges = (chunks, options) => chunks.every(chunk => chunk.tokenCount >= options.minTokens && chunk.tokenCount <= options.maxTokens);

















// Convert Claude conversation export to inference interactions
export const processClaudeConversations = async (params) => {
  const { conversations } = params;
  if (!Array.isArray(conversations)) {
    throw new Error('Conversations must be an array');
  }
  
  // Flatten all chat_messages from all conversations
  const allMessages = conversations.flatMap(conv => 
    (conv.chat_messages || []).map(msg => ({
      ...msg,
      conversationName: conv.name,
      conversationUuid: conv.uuid
    }))
  );
  
  const interactions = [];
  let currentHuman = null;
  let pairCount = 0;
  let unpairedHuman = 0;
  let unpairedAssistant = 0;
  
  for (const message of allMessages) {
    if (message.sender === 'human') {
      // If we had an unpaired human message, count it
      if (currentHuman) {
        unpairedHuman++;
      }
      
      currentHuman = {
        userPrompt: message.text,
        uuid: message.uuid,
        timestamp: message.created_at,
        conversationName: message.conversationName,
        conversationUuid: message.conversationUuid
      };
    } else if (message.sender === 'assistant') {
      if (currentHuman) {
        // Valid pair found
        const interaction = {
          userPrompt: currentHuman.userPrompt,
          aiResponse: message.text,
          metadata: {
            conversationId: `${currentHuman.uuid}-${message.uuid}`,
            conversationName: currentHuman.conversationName,
            conversationUuid: currentHuman.conversationUuid,
            humanTimestamp: currentHuman.timestamp,
            assistantTimestamp: message.created_at
          }
        };
        
        interactions.push(interaction);
        pairCount++;
        currentHuman = null; // Reset for next pair
      } else {
        // Unpaired assistant message
        unpairedAssistant++;
      }
    }
  }
  
  // Count final unpaired human if exists
  if (currentHuman) {
    unpairedHuman++;
  }
  
  runtime.log(`[Chunking] Processed ${allMessages.length} total messages from ${conversations.length} conversations`);
  runtime.log(`[Chunking] Created ${pairCount} valid human-assistant pairs`);
  runtime.log(`[Chunking] Found ${unpairedHuman} unpaired human messages, ${unpairedAssistant} unpaired assistant messages`);
  
  return interactions;
};

export const chunkInferenceInteraction = async (params) => {
  const { userPrompt, aiResponse, metadata = {} } = params;
  
  // For now, create simple single chunks until we implement proper chunking
  const promptChunks = [{
    text: userPrompt,
    tokenCount: estimateTokenCount(userPrompt),
    chunkIndex: 0,
    metadata: { type: 'user_prompt', ...metadata }
  }];
  
  const responseChunks = [{
    text: aiResponse,
    tokenCount: estimateTokenCount(aiResponse),
    chunkIndex: 0,
    metadata: { type: 'assistant_response', ...metadata }
  }];
  
  return { 
    promptChunks, 
    responseChunks, 
    metadata 
  };
};


export async function testWithClaudeData() {
  try {
    const response = await fetch(chrome.runtime.getURL('data/conversations.json'));
    const conversations = await response.json();
    console.log(`Loaded ${conversations.length} conversations`);
    
    const interactions = await processClaudeConversations({ conversations });
    
    // Test chunking on first few interactions
    const testResults = [];
    const samplesToTest = Math.min(5, interactions.length);
    
    for (let i = 0; i < samplesToTest; i++) {
      const interaction = interactions[i];
      const chunks = await chunkInferenceInteraction(interaction);
      
      testResults.push({
        interaction: i + 1,
        promptLength: interaction.userPrompt.length,
        responseLength: interaction.aiResponse.length,
        promptChunks: chunks.promptChunks.length,
        responseChunks: chunks.responseChunks.length,
        conversationName: interaction.metadata.conversationName
      });
    }
    
    console.table(testResults);
    
    return {
      totalInteractions: interactions.length,
      testResults,
      sampleInteractions: interactions.slice(0, 3)
    };
  } catch (error) {
    console.error('Test failed:', error);
    return { error: error.message };
  }
}