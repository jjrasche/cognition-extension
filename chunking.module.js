export const manifest = {
  name: "chunking",
  version: "1.0.0",
  description: "Semantic chunking for documents and text with flexible size boundaries",
  context: "service-worker",
  permissions: ["storage"],
  actions: ["chunkText", "chunkInferenceInteraction", "chunkDocument", "testWithClaudeData", "runAllChunkingTests", "analyzeConversationChunking","extractTestCases", "generateStaticTestCases", "validateRealWorldChunking"],
  dependencies: ["embedding"],
  state: {
    reads: [],
    writes: ["chunking.stats", "chunking.config"]
  }
};

let runtime;
export const initialize = async (rt) => { runtime = rt; };


const estimateTokenCount = (text) => {
  if (!text) return 0;
  
  // More accurate token estimation based on GPT tokenization patterns
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  let tokenCount = 0;
  
  for (const word of words) {
    const clean = word.replace(/[^\w'-]/g, '');
    if (!clean.length) continue;
    
    // Base token count
    if (clean.length <= 3) tokenCount += 1;
    else if (clean.length <= 6) tokenCount += 1.5;
    else if (clean.length <= 10) tokenCount += Math.ceil(clean.length / 4);
    else tokenCount += Math.ceil(clean.length / 3); // Long words break into more tokens
    
    // Subword tokens for common patterns
    if (/^(un|re|pre|dis|over|under|out|up)/.test(clean)) tokenCount += 0.3;
    if (/(ing|ed|er|est|ly|tion|ness|ment|able|ible)$/.test(clean)) tokenCount += 0.3;
    if (/'(s|t|re|ve|ll|d)$/.test(clean)) tokenCount += 0.2;
  }
  
  // Punctuation and special characters (more generous)
  const punctuation = (text.match(/[.!?;:,()[\]{}"`'""\-–—]/g) || []).length;
  tokenCount += punctuation * 0.15;
  
  // Code tokens (code is typically more tokens per character)
  const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).join('');
  const inlineCode = (text.match(/`[^`\n]+`/g) || []).join('');
  const totalCodeChars = codeBlocks.length + inlineCode.length;
  if (totalCodeChars > 0) {
    tokenCount += totalCodeChars / 3; // Code is denser in tokens
  }
  
  // Newlines and structure
  const newlines = (text.match(/\n/g) || []).length;
  tokenCount += newlines * 0.1;
  
  return Math.ceil(tokenCount);
};

const removeCodeBlocks = (text) => {
  return text
    // Replace fenced code blocks with placeholder that preserves structure
    .replace(/```[\s\S]*?```/g, (match) => {
      const lines = match.split('\n').length;
      return '\n[CODE_BLOCK]\n'.repeat(Math.min(lines, 3)); // Preserve some line breaks
    })
    // Replace inline code with shorter placeholder
    .replace(/`[^`\n]+`/g, '[CODE]')
    // Replace indented code but preserve paragraph breaks
    .replace(/^[ \t]{4,}.+$/gm, '[INDENTED_CODE]')
    // Normalize but don't collapse all structure
    .replace(/\n\s*\n\s*\n/g, '\n\n') // Collapse excessive newlines but keep paragraphs
    .trim();
};

const preprocessText = (text, options = {}) => removeCodeBlocks(text)
  .replace(/\r\n/g, '\n') // Normalize line endings
  .replace(/[ \t]+/g, ' ') // Normalize spaces
  .replace(/\n[ \t]+/g, '\n') // Remove leading whitespace on lines
  .trim();

const boundaryStrengths = { header: 6, paragraph: 4, sentence: 2, comma: 1 };
const detectSemanticBoundaries = (text, options = {}) => {
  const boundaries = [];
  
  // Headers (highest priority)
  [...text.matchAll(/^(#{1,6})\s+(.+)$/gm)].forEach(match => {
    boundaries.push({ 
      position: match.index, 
      type: 'header', 
      strength: 8 - match[1].length, // H1=7, H2=6, etc.
      content: match[2] 
    });
  });
  
  // Strong paragraph breaks (double+ newlines)
  [...text.matchAll(/\n\s*\n\s*\n/g)].forEach(match => {
    boundaries.push({ 
      position: match.index + match[0].length, 
      type: 'strong_paragraph', 
      strength: 5 
    });
  });
  
  // Regular paragraph breaks
  [...text.matchAll(/\n\s*\n/g)].forEach(match => {
    // Skip if already captured as strong paragraph
    const pos = match.index + match[0].length;
    if (!boundaries.some(b => Math.abs(b.position - pos) < 3)) {
      boundaries.push({ 
        position: pos, 
        type: 'paragraph', 
        strength: 4 
      });
    }
  });
  
  // List boundaries (new for better structure preservation)
  [...text.matchAll(/\n\s*(?:[-*+]|\d+\.)\s/g)].forEach(match => {
    boundaries.push({ 
      position: match.index + 1, 
      type: 'list_item', 
      strength: 3 
    });
  });
  
  // Code block boundaries
  [...text.matchAll(/\n\s*\[CODE_BLOCK\]\n/g)].forEach(match => {
    boundaries.push({ 
      position: match.index + match[0].length, 
      type: 'code_boundary', 
      strength: 3 
    });
  });
  
  // Strong sentence boundaries (. ! ? followed by capital or newline)
  [...text.matchAll(/[.!?](?:\s+[A-Z]|\s*\n)/g)].forEach(match => {
    const pos = match.index + 1;
    if (!isAbbreviation(text, match.index)) {
      boundaries.push({ 
        position: pos, 
        type: 'sentence', 
        strength: 2 
      });
    }
  });
  
  // Colon boundaries (often indicate explanations or lists)
  [...text.matchAll(/:\s*\n/g)].forEach(match => {
    boundaries.push({ 
      position: match.index + match[0].length, 
      type: 'colon_break', 
      strength: 2 
    });
  });
  
  // Comma boundaries (last resort, but more selective)
  [...text.matchAll(/,\s+(?=[A-Z])/g)].forEach(match => {
    boundaries.push({ 
      position: match.index + 1, 
      type: 'comma', 
      strength: 1 
    });
  });
  
  return boundaries.sort((a, b) => a.position - b.position);
};

const isAbbreviation = (text, dotIndex) => /\b(Mr|Mrs|Dr|Prof|etc|vs|ie|eg)$/.test(text.slice(Math.max(0, dotIndex - 10), dotIndex));

const createBoundaryBasedChunks = (text, boundaries, options = {}) => {
  const { minTokens = 50, maxTokens = 1000, overlapTokens = 50 } = options;
  const chunks = [];
  let currentStart = 0;
  
  while (currentStart < text.length) {
    let chunkEnd = findOptimalChunkEnd(text, currentStart, boundaries, minTokens, maxTokens);
    
    // For very large chunks, ensure we're making progress
    const segmentText = text.slice(currentStart, chunkEnd);
    const actualTokens = estimateTokenCount(segmentText);
    
    // If chunk is still too large, force split at paragraph boundaries
    if (actualTokens > maxTokens * 1.5) {
      const paragraphBoundaries = boundaries.filter(b => 
        b.position > currentStart && 
        b.position < chunkEnd && 
        (b.type === 'paragraph' || b.type === 'strong_paragraph' || b.type === 'header')
      );
      
      if (paragraphBoundaries.length > 0) {
        // Split at middle paragraph boundary
        const midIndex = Math.floor(paragraphBoundaries.length / 2);
        chunkEnd = paragraphBoundaries[midIndex].position;
      }
    }
    
    const chunkText = text.slice(currentStart, chunkEnd).trim();
    
    if (chunkText.length > 0) {
      const tokenCount = estimateTokenCount(chunkText);
      chunks.push({ 
        text: chunkText, 
        tokenCount, 
        startPos: currentStart, 
        endPos: chunkEnd, 
        chunkIndex: chunks.length 
      });
      
      // Add overlap for better context continuity (except for last chunk)
      if (chunkEnd < text.length) {
        // Find a good overlap point (sentence or paragraph boundary)
        const overlapStart = Math.max(currentStart, chunkEnd - (overlapTokens * 4)); // Approximate char count
        const overlapBoundaries = boundaries.filter(b => 
          b.position >= overlapStart && 
          b.position < chunkEnd &&
          (b.type === 'sentence' || b.type === 'paragraph')
        );
        
        if (overlapBoundaries.length > 0) {
          currentStart = overlapBoundaries[overlapBoundaries.length - 1].position;
        } else {
          currentStart = chunkEnd;
        }
      } else {
        currentStart = chunkEnd;
      }
    } else {
      // Safety: prevent infinite loop
      currentStart = chunkEnd + 1;
    }
  }
  
  return chunks;
};

function predictChunkingBehavior(text, analysis) {
  const tokens = estimateTokenCount(text);
  
  const strategies = {
    small: { minTokens: 50, maxTokens: 300 },
    medium: { minTokens: 100, maxTokens: 600 },
    large: { minTokens: 200, maxTokens: 1000 }
  };
  
  const predictions = {};
  
  Object.entries(strategies).forEach(([name, strategy]) => {
    if (tokens <= strategy.minTokens) {
      predictions[name] = { expectedChunks: 1, reason: 'Below minimum threshold' };
    } else if (tokens <= strategy.maxTokens) {
      predictions[name] = { expectedChunks: 1, reason: 'Within single chunk limit' };
    } else {
      // More accurate prediction based on content structure
      let estimatedChunks = Math.ceil(tokens / (strategy.maxTokens * 0.8)); // Account for overlap
      
      // Adjust for semantic structure
      if (analysis.headers >= 3) {
        estimatedChunks = Math.max(estimatedChunks, Math.min(analysis.headers + 1, 8));
      }
      
      // Code-heavy content tends to chunk more
      if (analysis.codeBlocks >= 2) {
        estimatedChunks = Math.max(estimatedChunks, analysis.codeBlocks + 1);
      }
      
      // Very long content with minimal structure still needs to be split
      if (tokens > 3000 && analysis.headers <= 1) {
        estimatedChunks = Math.max(estimatedChunks, Math.ceil(tokens / strategy.maxTokens));
      }
      
      predictions[name] = { 
        expectedChunks: estimatedChunks, 
        reason: `Multiple chunks needed (~${tokens} tokens, structure-aware)` 
      };
    }
  });
  
  return predictions;
}

const findOptimalChunkEnd = (text, start, boundaries, minTokens, maxTokens) => {
  const availableBoundaries = boundaries.filter(b => b.position > start);
  
  if (availableBoundaries.length === 0) {
    return text.length;
  }
  
  let bestEnd = text.length;
  let currentTokens = 0;
  let lastViableEnd = start;
  let lastMinEnd = start;
  
  // For very large content, be more aggressive about finding boundaries
  const isLargeContent = estimateTokenCount(text.slice(start)) > 2000;
  const targetMax = isLargeContent ? Math.floor(maxTokens * 0.8) : maxTokens; // Chunk smaller for large content
  
  for (const boundary of availableBoundaries) {
    const segmentText = text.slice(start, boundary.position);
    currentTokens = estimateTokenCount(segmentText);
    
    // Track first boundary that meets minimum
    if (currentTokens >= minTokens && lastMinEnd === start) {
      lastMinEnd = boundary.position;
    }
    
    // For boundaries that meet minimum, prefer higher-strength boundaries
    if (currentTokens >= minTokens) {
      // Prefer stronger boundaries (headers, paragraphs over sentences)
      if (boundary.strength >= 3 || currentTokens >= targetMax * 0.6) {
        lastViableEnd = boundary.position;
      }
    }
    
    // Hard stop at max tokens, but prefer strong boundaries near the limit
    if (currentTokens >= targetMax) {
      // Look for a strong boundary within the last 20% of content
      const recentBoundaries = availableBoundaries.filter(b => 
        b.position <= boundary.position && 
        b.position >= start + (segmentText.length * 0.8) &&
        b.strength >= 3
      );
      
      if (recentBoundaries.length > 0) {
        bestEnd = recentBoundaries[recentBoundaries.length - 1].position;
      } else {
        bestEnd = lastViableEnd;
      }
      break;
    }
    
    bestEnd = boundary.position;
  }
  
  // Safety: ensure we don't return something smaller than minimum
  if (currentTokens > maxTokens && lastViableEnd > start) {
    return lastViableEnd;
  }
  
  // If we never found a good boundary, at least use minimum boundary
  if (bestEnd === start && lastMinEnd > start) {
    return lastMinEnd;
  }
  
  return bestEnd;
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









// Add this to your chunking.module.js

export const extractTestCases = async (params = {}) => {
  const { maxCases = 15, includeContent = false } = params;
  
  try {
    // Load conversation data
    const response = await fetch(chrome.runtime.getURL('data/conversations.json'));
    const conversations = await response.json();
    const interactions = await processClaudeConversations({ conversations });
    
    runtime.log(`[Test Extraction] Analyzing ${interactions.length} interactions...`);
    
    // Categorize conversations by characteristics
    const categories = {
      short: [],      // < 500 chars
      medium: [],     // 500-2000 chars  
      long: [],       // 2000-5000 chars
      veryLong: [],   // > 5000 chars
      codeHeavy: [],  // > 2 code blocks
      structured: [], // > 3 headers
      listHeavy: [],  // > 10 list items
      minimal: [],    // Low structure (few headers/lists/code)
      edgeCases: []   // Unusual patterns
    };
    
    // Analyze each interaction
    interactions.forEach((interaction, index) => {
      const response = interaction.aiResponse;
      const length = response.length;
      const analysis = analyzeSemanticStructure(response);
      
      const metadata = {
        index,
        length,
        tokens: estimateTokenCount(response),
        promptPreview: interaction.userPrompt.substring(0, 100),
        responsePreview: response.substring(0, 150),
        conversationName: interaction.metadata.conversationName,
        ...analysis
      };
      
      // Categorize by length
      if (length < 500) categories.short.push(metadata);
      else if (length < 2000) categories.medium.push(metadata);
      else if (length < 5000) categories.long.push(metadata);
      else categories.veryLong.push(metadata);
      
      // Categorize by content type
      if (analysis.codeBlocks >= 2) categories.codeHeavy.push(metadata);
      if (analysis.headers >= 3) categories.structured.push(metadata);
      if (analysis.lists >= 10) categories.listHeavy.push(metadata);
      if (analysis.headers <= 1 && analysis.lists <= 2 && analysis.codeBlocks === 0) {
        categories.minimal.push(metadata);
      }
      
      // Edge cases
      if (analysis.sentences < 3 || response.includes('```json') || response.includes('```yaml')) {
        categories.edgeCases.push(metadata);
      }
    });
    
    // Sort each category by interesting characteristics
    Object.keys(categories).forEach(key => {
      categories[key].sort((a, b) => {
        if (key === 'codeHeavy') return b.codeBlocks - a.codeBlocks;
        if (key === 'structured') return b.headers - a.headers;
        if (key === 'listHeavy') return b.lists - a.lists;
        return b.tokens - a.tokens; // Default: most tokens first
      });
    });
    
    // Select representatives from each category
    const selectedCases = [];
    const casesPerCategory = Math.floor(maxCases / Object.keys(categories).length);
    
    Object.entries(categories).forEach(([categoryName, items]) => {
      const selected = items.slice(0, casesPerCategory);
      selected.forEach(item => {
        item.category = categoryName;
        item.testReason = getTestReason(categoryName, item);
      });
      selectedCases.push(...selected);
    });
    
    // Fill remaining slots with most interesting cases
    const remaining = maxCases - selectedCases.length;
    if (remaining > 0) {
      const allSorted = interactions
        .map((interaction, index) => ({
          index,
          tokens: estimateTokenCount(interaction.aiResponse),
          analysis: analyzeSemanticStructure(interaction.aiResponse),
          interaction
        }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, remaining);
      
      allSorted.forEach(item => {
        if (!selectedCases.find(sc => sc.index === item.index)) {
          selectedCases.push({
            ...item,
            category: 'additional',
            testReason: 'High token count for stress testing'
          });
        }
      });
    }
    
    // Add full content if requested
    if (includeContent) {
      selectedCases.forEach(testCase => {
        const interaction = interactions[testCase.index];
        testCase.fullInteraction = interaction;
      });
    }
    
    // Generate summary
    const summary = {
      totalInteractions: interactions.length,
      categoryCounts: Object.fromEntries(
        Object.entries(categories).map(([key, items]) => [key, items.length])
      ),
      selectedCases: selectedCases.length,
      casesByCategory: selectedCases.reduce((acc, item) => {
        acc[item.category] = (acc[item.category] || 0) + 1;
        return acc;
      }, {})
    };
    
    runtime.log('[Test Extraction] Summary:', summary);
    
    return {
      summary,
      selectedCases: selectedCases.slice(0, maxCases),
      categories // For detailed analysis
    };
    
  } catch (error) {
    runtime.logError('[Test Extraction] Failed:', error);
    return { error: error.message };
  }
};

function getTestReason(category, item) {
  const reasons = {
    short: 'Tests single-chunk behavior for brief responses',
    medium: 'Tests boundary detection in moderate-length content',
    long: 'Tests multi-chunk splitting with semantic boundaries',
    veryLong: 'Stress tests chunking on very large responses',
    codeHeavy: `Tests code block preservation (${item.codeBlocks} blocks)`,
    structured: `Tests header-aware chunking (${item.headers} headers)`,
    listHeavy: `Tests list handling (${item.lists} list items)`,
    minimal: 'Tests chunking with minimal semantic structure',
    edgeCases: 'Tests edge cases and unusual content patterns',
    additional: 'Additional high-token case for comprehensive testing'
  };
  return reasons[category] || 'General chunking validation';
}

// Helper function to anonymize content for test cases
export const anonymizeContent = (text) => {
  return text
    // Replace names and emails
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, 'John Smith')
    .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, 'user@example.com')
    // Replace URLs
    .replace(/https?:\/\/[^\s]+/g, 'https://example.com')
    // Replace file paths
    .replace(/[C-Z]:\\[^\s]+/g, 'C:\\path\\to\\file')
    .replace(/\/[a-zA-Z0-9/_.-]+/g, '/path/to/file')
    // Replace specific numbers that might be sensitive
    .replace(/\b\d{3}-\d{3}-\d{4}\b/g, '555-123-4567')
    .replace(/\b\d{16}\b/g, '1234567890123456');
};

// Generate static test cases from selected interactions
export const generateStaticTestCases = async (params = {}) => {
  const { testCaseName = 'realWorldChunking', anonymize = true } = params;
  
  const analysis = await extractTestCases({ maxCases: 12, includeContent: true });
  
  if (analysis.error) {
    return analysis;
  }
  
  const testCases = analysis?.selectedCases?.map((testCase, index) => {
    const interaction = testCase.fullInteraction;
    let userPrompt = interaction.userPrompt;
    let aiResponse = interaction.aiResponse;
    
    if (anonymize) {
      userPrompt = anonymizeContent(userPrompt);
      aiResponse = anonymizeContent(aiResponse);
    }
    
    // Predict expected chunking behavior
    const expectedBehavior = predictChunkingBehavior(aiResponse, testCase);
    
    return {
      name: `${testCase.category}_${index + 1}`,
      category: testCase.category,
      testReason: testCase.testReason,
      userPrompt,
      aiResponse,
      metadata: {
        originalLength: testCase.length,
        estimatedTokens: testCase.tokens,
        semanticStructure: {
          headers: testCase.headers,
          paragraphs: testCase.paragraphs,
          sentences: testCase.sentences,
          codeBlocks: testCase.codeBlocks,
          lists: testCase.lists
        }
      },
      expectedBehavior
    };
  });
  
  return {
    testSuiteName: testCaseName,
    generatedAt: new Date().toISOString(),
    testCases,
    summary: analysis.summary
  };
};

// Run validation tests on generated test cases
export const validateRealWorldChunking = async (params = {}) => {
  const { regenerateTests = false, showDetails = true } = params;
  
  runtime.log('[Real World Validation] Starting test validation...');
  
  // Generate or use cached test cases
  const testSuite = await generateStaticTestCases({ testCaseName: 'realWorldValidation' });
  
  if (testSuite.error) {
    return testSuite;
  }
  
  const results = [];
  const strategies = [
    { name: 'small', minTokens: 50, maxTokens: 300 },
    { name: 'medium', minTokens: 100, maxTokens: 600 },
    { name: 'large', minTokens: 200, maxTokens: 1000 }
  ];
  
  runtime.log(`[Real World Validation] Testing ${testSuite.testCases.length} cases across ${strategies.length} strategies...`);
  
  for (const testCase of testSuite.testCases) {
    const testResult = {
      name: testCase.name,
      category: testCase.category,
      testReason: testCase.testReason,
      originalTokens: testCase.metadata.estimatedTokens,
      strategies: {}
    };
    
    for (const strategy of strategies) {
      try {
        // Test prompt chunking
        const promptResult = await chunkText({
          text: testCase.userPrompt,
          ...strategy
        });
        
        // Test response chunking  
        const responseResult = await chunkText({
          text: testCase.aiResponse,
          ...strategy
        });
        
        const actualChunks = responseResult.chunks.length;
        const expectedChunks = testCase.expectedBehavior[strategy.name].expectedChunks;
        const tolerance = Math.max(1, Math.ceil(expectedChunks * 0.3)); // 30% tolerance
        
        const passed = Math.abs(actualChunks - expectedChunks) <= tolerance;
        
        testResult.strategies[strategy.name] = {
          promptChunks: promptResult.chunks.length,
          responseChunks: actualChunks,
          expectedChunks,
          tolerance,
          passed,
          prediction: testCase.expectedBehavior[strategy.name].reason,
          chunkSizes: responseResult.chunks.map(c => c.tokenCount)
        };
        
        if (showDetails && !passed) {
          runtime.log(`❌ ${testCase.name} (${strategy.name}): Expected ~${expectedChunks}, got ${actualChunks}`);
        }
        
      } catch (error) {
        testResult.strategies[strategy.name] = {
          error: error.message,
          passed: false
        };
        runtime.logError(`Error testing ${testCase.name} with ${strategy.name}:`, error);
      }
    }
    
    results.push(testResult);
  }
  
  // Calculate overall statistics
  const stats = calculateValidationStats(results);
  
  if (showDetails) {
    runtime.log('[Real World Validation] Results by category:');
    displayResultsByCategory(results);
  }
  
  runtime.log('[Real World Validation] Overall Statistics:', stats);
  
  return {
    testSuite: testSuite.testSuiteName,
    totalTests: results.length,
    results,
    statistics: stats,
    recommendations: generateValidationRecommendations(results, stats)
  };
};

function calculateValidationStats(results) {
  const stats = {
    byStrategy: {},
    byCategory: {},
    overall: { totalTests: results.length, totalPassed: 0, totalFailed: 0 }
  };
  
  // Initialize strategy stats
  ['small', 'medium', 'large'].forEach(strategy => {
    stats.byStrategy[strategy] = { passed: 0, failed: 0, accuracy: 0 };
  });
  
  // Calculate stats
  results.forEach(result => {
    // Strategy stats
    Object.entries(result.strategies).forEach(([strategy, strategyResult]) => {
      if (strategyResult.passed) {
        stats.byStrategy[strategy].passed++;
        stats.overall.totalPassed++;
      } else {
        stats.byStrategy[strategy].failed++;
        stats.overall.totalFailed++;
      }
    });
    
    // Category stats
    if (!stats.byCategory[result.category]) {
      stats.byCategory[result.category] = { passed: 0, failed: 0, tests: 0 };
    }
    stats.byCategory[result.category].tests++;
    
    const categoryPassed = Object.values(result.strategies).some(s => s.passed);
    if (categoryPassed) {
      stats.byCategory[result.category].passed++;
    } else {
      stats.byCategory[result.category].failed++;
    }
  });
  
  // Calculate accuracy percentages
  Object.keys(stats.byStrategy).forEach(strategy => {
    const strategyStats = stats.byStrategy[strategy];
    const total = strategyStats.passed + strategyStats.failed;
    strategyStats.accuracy = total > 0 ? (strategyStats.passed / total * 100).toFixed(1) : 0;
  });
  
  Object.keys(stats.byCategory).forEach(category => {
    const categoryStats = stats.byCategory[category];
    categoryStats.accuracy = (categoryStats.passed / categoryStats.tests * 100).toFixed(1);
  });
  
  stats.overall.accuracy = (stats.overall.totalPassed / (stats.overall.totalPassed + stats.overall.totalFailed) * 100).toFixed(1);
  
  return stats;
}

function displayResultsByCategory(results) {
  const byCategory = results.reduce((acc, result) => {
    if (!acc[result.category]) acc[result.category] = [];
    acc[result.category].push(result);
    return acc;
  }, {});
  
  Object.entries(byCategory).forEach(([category, categoryResults]) => {
    runtime.log(`\n=== ${category.toUpperCase()} CATEGORY ===`);
    categoryResults.forEach(result => {
      const strategies = Object.entries(result.strategies)
        .map(([name, data]) => `${name}: ${data.passed ? '✅' : '❌'} ${data.responseChunks || 'ERR'}`)
        .join(' | ');
      runtime.log(`  ${result.name}: ${strategies}`);
    });
  });
}

function generateValidationRecommendations(results, stats) {
  const recommendations = [];
  
  // Strategy-specific recommendations
  Object.entries(stats.byStrategy).forEach(([strategy, data]) => {
    if (data.accuracy < 70) {
      recommendations.push(`${strategy} strategy has low accuracy (${data.accuracy}%) - review token limits`);
    }
  });
  
  // Category-specific recommendations
  Object.entries(stats.byCategory).forEach(([category, data]) => {
    if (data.accuracy < 60) {
      recommendations.push(`${category} content performs poorly - consider specialized handling`);
    }
  });
  
  // Overall recommendations
  if (stats.overall.accuracy < 75) {
    recommendations.push('Overall chunking accuracy is below 75% - review boundary detection logic');
  }
  
  // Find patterns in failures
  const failedTests = results.filter(r => 
    Object.values(r.strategies).every(s => !s.passed)
  );
  
  if (failedTests.length > 0) {
    const failurePatterns = failedTests.map(t => t.category);
    const uniquePatterns = [...new Set(failurePatterns)];
    recommendations.push(`Consistent failures in: ${uniquePatterns.join(', ')}`);
  }
  
  return recommendations;
}