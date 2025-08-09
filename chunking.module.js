export const manifest = {
  name: "chunking",
  version: "1.0.0",
  description: "Semantic chunking for documents and text with flexible size boundaries",
  context: "service-worker",
  permissions: ["storage"],
  actions: ["chunkText", "chunkInferenceInteraction", "chunkDocument", "testWithClaudeData", "runAllChunkingTests", "analyzeConversationChunking"],
  dependencies: ["embedding"],
  state: {
    reads: [],
    writes: ["chunking.stats", "chunking.config"]
  }
};

let runtime;
export const initialize = async (rt) => { runtime = rt; };


const estimateTokenCount = (text) => !text ? 0 : text.toLowerCase().split(/\s+/).filter(w => w.length > 0).reduce((count, word) => {
  const clean = word.replace(/[^\w'-]/g, '');
  if (!clean.length) return count;
  const base = clean.length > 8 ? Math.ceil(clean.length / 4) : clean.length > 4 ? 1.3 : 1;
  const subword = /^(un|re|pre|dis|over|under|out|up)|ing|ed|er|est|ly|tion|ness|ment|'(s|t|re|ve|ll|d)$/.test(clean) ? 0.2 : 0;
  return count + base + subword;
}, 0) + (text.match(/[.!?;:,()[\]{}]/g) || []).length * 0.1;

const removeCodeBlocks = (text) => text
  .replace(/```[\s\S]*?```/g, '') // Fenced blocks
  .replace(/`[^`\n]+`/g, '') // Inline code
  .replace(/^[ \t]{4,}.*/gm, '') // Indented code lines
  .replace(/\n\s*\n\s*\n/g, '\n\n') // Collapse multiple newlines
  .trim();

const preprocessText = (text, options = {}) => removeCodeBlocks(text)
  .replace(/\r\n/g, '\n') // Normalize line endings
  .replace(/[ \t]+/g, ' ') // Normalize spaces
  .replace(/\n[ \t]+/g, '\n') // Remove leading whitespace on lines
  .trim();

const boundaryStrengths = { header: 6, paragraph: 4, sentence: 2, comma: 1 };
const detectSemanticBoundaries = (text, options = {}) => {
  const boundaries = [];
  // Headers (# ## ###)
  [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].forEach(match =>  boundaries.push({ position: match.index, type: 'header', strength: 7 - match[1].length, content: match[2] }));
  // Paragraph breaks (double newlines)
  [...text.matchAll(/\n\s*\n/g)].forEach(match =>  boundaries.push({ position: match.index + match[0].length, type: 'paragraph', strength: 4 }));
  // Sentence boundaries (. ! ? followed by space + capital or newline)
  [...text.matchAll(/[.!?](?:\s+[A-Z]|\s*\n)/g)].forEach(match => {
    const pos = match.index + 1;
    if (!isAbbreviation(text, match.index)) boundaries.push({ position: pos, type: 'sentence', strength: 2 });
  });
  // Comma boundaries (last resort)
  [...text.matchAll(/,\s+/g)].forEach(match => boundaries.push({ position: match.index + 1, type: 'comma', strength: 1 }));
  return boundaries.sort((a, b) => a.position - b.position);
};

const isAbbreviation = (text, dotIndex) => /\b(Mr|Mrs|Dr|Prof|etc|vs|ie|eg)$/.test(text.slice(Math.max(0, dotIndex - 10), dotIndex));

const createBoundaryBasedChunks = (text, boundaries, options = {}) => {
  const { minTokens = 50, maxTokens = 1000 } = options;
  const chunks = [];
  let currentStart = 0;
  while (currentStart < text.length) {
    let chunkEnd = findOptimalChunkEnd(text, currentStart, boundaries, minTokens, maxTokens);
    const chunkText = text.slice(currentStart, chunkEnd).trim();
    if (chunkText.length > 0) chunks.push({ text: chunkText, tokenCount: estimateTokenCount(chunkText), startPos: currentStart, endPos: chunkEnd, chunkIndex: chunks.length });
    currentStart = chunkEnd;
  }
  return chunks;
};

const findOptimalChunkEnd = (text, start, boundaries, minTokens, maxTokens) => {
  const availableBoundaries = boundaries.filter(b => b.position > start);
  let bestEnd = text.length;
  let currentTokens = 0;
  let lastViableEnd = start;
  
  for (const boundary of availableBoundaries) {
    const segmentText = text.slice(start, boundary.position);
    currentTokens = estimateTokenCount(segmentText);
    
    if (currentTokens >= minTokens) lastViableEnd = boundary.position;
    if (currentTokens >= maxTokens) break;
    bestEnd = boundary.position;
  }
  
  return currentTokens > maxTokens ? lastViableEnd : bestEnd;
};

const enhanceChunks = async (rawChunks, options = {}) => rawChunks.map((chunk, index) => ({
  ...chunk,
  id: `chunk-${index}`,
  metadata: {
    type: options.documentType || 'unknown',
    position: `${index + 1}/${rawChunks.length}`,
    ...options.metadata
  }
}));

const createChunks = async (text, options = {}) => {
  const processed = preprocessText(text, options);
  if (!processed.trim()) return [];
  
  const boundaries = detectSemanticBoundaries(processed, options);
  const rawChunks = createBoundaryBasedChunks(processed, boundaries, options);
  return enhanceChunks(rawChunks, options);
};

const getDocumentTypeConfig = (documentType) => ({
  conversation: { minTokens: 30, maxTokens: 500, preserveStructure: false },
  technical: { minTokens: 100, maxTokens: 1500, preserveStructure: true },
  narrative: { minTokens: 200, maxTokens: 2000, preserveStructure: true },
  unknown: { minTokens: 50, maxTokens: 1000, preserveStructure: true }
}[documentType] || { minTokens: 50, maxTokens: 1000, preserveStructure: true });

export const chunkText = async (params) => {
  const { text, minTokens = 50, maxTokens = 1000, preserveStructure = true } = params;
  return { success: true, chunks: await createChunks(text, { minTokens, maxTokens, preserveStructure }) };
};

export const chunkDocument = async (params) => {
  const { content, documentType = 'unknown', metadata = {} } = params;
  const config = getDocumentTypeConfig(documentType);
  const chunks = await createChunks(content, { ...config, documentType, metadata });
  return { success: true, chunks, documentType, config };
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


















// Test data for chunking module - following existing module code style
// === TEST DATA DEFINITIONS ===
const boundaryDetectionTests = [
  {
    name: "header_detection",
    input: "# Main Title\n\nContent here",
    expected: [
      { position: 0, type: 'header', strength: 6 },
      { position: 15, type: 'paragraph', strength: 4 }
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
    input: "Short text here",
    options: { minTokens: 10, maxTokens: 50 },
    expectedChunks: 1,
    notes: "Don't split tiny content below minimum"
  },
  {
    name: "over_maximum", 
    input: "A ".repeat(200) + "sentence. " + "B ".repeat(200) + "paragraph.",
    options: { minTokens: 10, maxTokens: 100 },
    expectedChunks: 2,
    notes: "Should split at sentence boundary before token limit"
  },
  {
    name: "perfect_fit",
    input: "A ".repeat(80) + "content.",
    options: { minTokens: 10, maxTokens: 100 },
    expectedChunks: 1,
    notes: "Should create single chunk when under limit"
  }
];

const codeRemovalTests = [
  {
    name: "fenced_blocks",
    input: "Explanation\n```javascript\nfunction test() {}\n```\nMore text",
    expected: "Explanation\n\nMore text",
    notes: "Should remove fenced code blocks"
  },
  {
    name: "inline_code", 
    input: "Use the `forEach` method here",
    expected: "Use the  method here",
    notes: "Should remove inline backtick code"
  },
  {
    name: "indented_code",
    input: "Example:\n    function test() {\n        return true;\n    }\nEnd example",
    expected: "Example:\n\nEnd example",
    notes: "Should remove indented code lines"
  },
  {
    name: "no_false_positives",
    input: "The price is $50 and that's expensive",
    expected: "The price is $50 and that's expensive", 
    notes: "Should not remove non-code backticks/dollar signs"
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
    expectedResponseChunks: 1,
    notes: "Response with headers - may chunk by structure"
  },
  {
    name: "long_response",
    userPrompt: "Why?",
    aiResponse: "A ".repeat(500) + "very long response with multiple paragraphs.\n\n" + "B ".repeat(300) + "second paragraph continues.",
    expectedPromptChunks: 1,
    expectedResponseChunks: 2,
    notes: "Should split very long responses"
  }
];

// === TEST RUNNERS ===
const runBoundaryDetectionTests = async () => {
  const results = [];
  for (const test of boundaryDetectionTests) {
    try {
      const boundaries = detectSemanticBoundaries(test.input);
      const passed = validateBoundaries(boundaries, test.expected);
      results.push({ ...test, actual: boundaries, passed, details: passed ? 'PASS' : `Expected ${test.expected.length}, got ${boundaries.length}` });
    } catch (error) {
      results.push({ ...test, error: error.message, passed: false, details: 'ERROR' });
    }
  }
  return results;
};

const runTokenRangeTests = async () => {
  const results = [];
  for (const test of tokenRangeTests) {
    try {
      const result = await chunkText({ text: test.input, ...test.options });
      const chunks = result.chunks;
      const passed = test.expectedChunks ? chunks.length === test.expectedChunks : validateTokenRanges(chunks, test.options);
      results.push({ ...test, actualChunks: chunks.length, passed, details: passed ? 'PASS' : `Expected ${test.expectedChunks}, got ${chunks.length}` });
    } catch (error) {
      results.push({ ...test, error: error.message, passed: false, details: 'ERROR' });
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
      results.push({ ...test, actual, passed, details: passed ? 'PASS' : 'Output mismatch' });
    } catch (error) {
      results.push({ ...test, error: error.message, passed: false, details: 'ERROR' });
    }
  }
  return results;
};

const runConversationTests = async () => {
  const results = [];
  for (const test of conversationTests) {
    try {
      const result = await chunkInferenceInteraction({ userPrompt: test.userPrompt, aiResponse: test.aiResponse });
      const passed = result.promptChunks.length === test.expectedPromptChunks && result.responseChunks.length === test.expectedResponseChunks;
      results.push({ ...test, actualPrompt: result.promptChunks.length, actualResponse: result.responseChunks.length, passed, details: passed ? 'PASS' : 'Chunk count mismatch' });
    } catch (error) {
      results.push({ ...test, error: error.message, passed: false, details: 'ERROR' });
    }
  }
  return results;
};

const validateBoundaries = (actual, expected) => actual.length === expected.length && expected.every((exp, i) => actual[i] && actual[i].type === exp.type && actual[i].strength === exp.strength && Math.abs(actual[i].position - exp.position) <= 2);
const validateTokenRanges = (chunks, options) => chunks.every(chunk => chunk.tokenCount >= options.minTokens && chunk.tokenCount <= options.maxTokens);

export const runAllChunkingTests = async () => {
  runtime.log('[Chunking] Running all test suites...');
  const boundary = await runBoundaryDetectionTests();
  const tokenRange = await runTokenRangeTests();
  const codeRemoval = await runCodeRemovalTests();
  const conversation = await runConversationTests();
  
  const summary = {
    boundary: { passed: boundary.filter(t => t.passed).length, total: boundary.length },
    tokenRange: { passed: tokenRange.filter(t => t.passed).length, total: tokenRange.length },
    codeRemoval: { passed: codeRemoval.filter(t => t.passed).length, total: codeRemoval.length },
    conversation: { passed: conversation.filter(t => t.passed).length, total: conversation.length }
  };
  
  runtime.log('[Chunking] Test Results Summary:', summary);
  return { boundary, tokenRange, codeRemoval, conversation, summary };
};
















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







export const analyzeConversationChunking = async (params = {}) => {
  const { minResponseLength = 800, maxSamples = 10 } = params;
  
  try {
    // Load your conversation data
    const response = await fetch(chrome.runtime.getURL('data/conversations.json'));
    const conversations = await response.json();
    const interactions = await processClaudeConversations({ conversations });
    
    // Find interesting conversations for chunking analysis
    const longResponses = interactions
      .filter(interaction => interaction.aiResponse.length >= minResponseLength)
      .sort((a, b) => b.aiResponse.length - a.aiResponse.length)
      .slice(0, maxSamples);
    
    console.log(`\n🔍 ANALYZING ${longResponses.length} CONVERSATIONS FOR CHUNKING`);
    console.log(`Response lengths: ${longResponses.map(r => r.aiResponse.length).join(', ')} chars\n`);
    
    const results = [];
    
    for (let i = 0; i < longResponses.length; i++) {
      const interaction = longResponses[i];
      const conversationName = interaction.metadata.conversationName;
      
      console.log(`\n=== CONVERSATION ${i + 1}: ${conversationName} ===`);
      console.log(`Prompt (${interaction.userPrompt.length} chars): "${interaction.userPrompt.substring(0, 100)}..."`);
      console.log(`Response (${interaction.aiResponse.length} chars): "${interaction.aiResponse.substring(0, 100)}..."`);
      
      // Test different chunking strategies
      const strategies = [
        { name: 'Small Chunks', minTokens: 50, maxTokens: 300 },
        { name: 'Medium Chunks', minTokens: 100, maxTokens: 600 },
        { name: 'Large Chunks', minTokens: 200, maxTokens: 1000 },
      ];
      
      const chunkResults = {};
      
      for (const strategy of strategies) {
        try {
          const promptChunks = await chunkText({ 
            text: interaction.userPrompt, 
            ...strategy 
          });
          
          const responseChunks = await chunkText({ 
            text: interaction.aiResponse, 
            ...strategy 
          });
          
          chunkResults[strategy.name] = {
            promptChunks: promptChunks.chunks.length,
            responseChunks: responseChunks.chunks.length,
            totalChunks: promptChunks.chunks.length + responseChunks.chunks.length,
            responseChunkDetails: responseChunks.chunks.map(chunk => ({
              tokens: chunk.tokenCount,
              preview: chunk.text.substring(0, 80) + '...'
            }))
          };
          
          console.log(`  ${strategy.name}: ${promptChunks.chunks.length} prompt + ${responseChunks.chunks.length} response = ${promptChunks.chunks.length + responseChunks.chunks.length} total chunks`);
          
        } catch (error) {
          console.error(`  ${strategy.name}: ERROR - ${error.message}`);
          chunkResults[strategy.name] = { error: error.message };
        }
      }
      
      // Analyze semantic structure of the response
      const semanticAnalysis = analyzeSemanticStructure(interaction.aiResponse);
      console.log(`  Semantic Structure: ${semanticAnalysis.headers} headers, ${semanticAnalysis.paragraphs} paragraphs, ${semanticAnalysis.sentences} sentences`);
      
      results.push({
        conversation: conversationName,
        promptLength: interaction.userPrompt.length,
        responseLength: interaction.aiResponse.length,
        estimatedTokens: estimateTokenCount(interaction.aiResponse),
        semanticAnalysis,
        chunkResults
      });
      
      // Show detailed breakdown for first conversation
      if (i === 0) {
        console.log(`\n📝 DETAILED BREAKDOWN OF FIRST CONVERSATION:`);
        const detailedChunks = await chunkText({ 
          text: interaction.aiResponse, 
          minTokens: 100, 
          maxTokens: 600 
        });
        
        detailedChunks.chunks.forEach((chunk, idx) => {
          console.log(`\n  Chunk ${idx + 1} (${chunk.tokenCount} tokens):`);
          console.log(`  "${chunk.text.substring(0, 200)}${chunk.text.length > 200 ? '...' : ''}"`);
        });
      }
    }
    
    // Summary analysis
    console.log(`\n📊 CHUNKING STRATEGY COMPARISON:`);
    const summary = results.map(r => ({
      conversation: r.conversation.substring(0, 30),
      tokens: r.estimatedTokens,
      small: r.chunkResults['Small Chunks']?.totalChunks || 'Error',
      medium: r.chunkResults['Medium Chunks']?.totalChunks || 'Error',
      large: r.chunkResults['Large Chunks']?.totalChunks || 'Error'
    }));
    
    console.table(summary);
    
    return {
      analyzedConversations: results.length,
      summary,
      detailedResults: results,
      recommendations: generateChunkingRecommendations(results)
    };
    
  } catch (error) {
    console.error('[Chunking Analysis] Failed:', error);
    return { error: error.message };
  }
};

// Helper function to analyze semantic structure
function analyzeSemanticStructure(text) {
  const headers = (text.match(/^#+\s+/gm) || []).length;
  const paragraphs = (text.match(/\n\s*\n/g) || []).length + 1;
  const sentences = (text.match(/[.!?](?:\s+[A-Z]|\s*\n)/g) || []).length;
  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).length;
  const lists = (text.match(/^\s*[-*+]\s+/gm) || []).length;
  
  return { headers, paragraphs, sentences, codeBlocks, lists };
}

// Generate recommendations based on analysis
function generateChunkingRecommendations(results) {
  const avgResponseLength = results.reduce((sum, r) => sum + r.responseLength, 0) / results.length;
  const avgTokens = results.reduce((sum, r) => sum + r.estimatedTokens, 0) / results.length;
  
  const recommendations = [];
  
  if (avgResponseLength > 1500) {
    recommendations.push("Consider medium chunking (100-600 tokens) for most responses");
  } else {
    recommendations.push("Small to medium chunking (50-400 tokens) may be optimal");
  }
  
  if (results.some(r => r.semanticAnalysis.headers > 2)) {
    recommendations.push("Use header-aware chunking for structured responses");
  }
  
  if (results.some(r => r.semanticAnalysis.codeBlocks > 0)) {
    recommendations.push("Implement code-block preservation in chunking");
  }
  
  return recommendations;
}