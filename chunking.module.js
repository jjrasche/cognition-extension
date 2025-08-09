export const manifest = {
  name: "chunking",
  version: "1.0.0",
  description: "Semantic chunking for documents and text with flexible size boundaries",
  context: "service-worker",
  permissions: ["storage"],
  actions: ["chunkText", "chunkInferenceInteraction", "chunkDocument", "testWithClaudeData", "runAllChunkingTests", "analyzeConversationChunking","extractTestCases", "generateStaticTestCases", "validateRealWorldChunking", "runRealTests", "generateTestFile"],
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
  
  // Check if entire text fits in one chunk
  const totalTokens = estimateTokenCount(text);
  if (totalTokens <= maxTokens) {
    return [{
      text: text.trim(),
      tokenCount: totalTokens,
      startPos: 0,
      endPos: text.length,
      chunkIndex: 0
    }];
  }
  
  let currentStart = 0;
  
  while (currentStart < text.length) {
    let chunkEnd = findOptimalChunkEnd(text, currentStart, boundaries, minTokens, maxTokens);
    
    // FIX: More aggressive forced splitting
    const segmentText = text.slice(currentStart, chunkEnd);
    const actualTokens = estimateTokenCount(segmentText);
    
    // If chunk is still too large, force split at maxTokens
    if (actualTokens > maxTokens * 1.2) {  // Changed from 1.5 to 1.2
      // Find approximate position for maxTokens
      const avgCharsPerToken = text.length / totalTokens;
      const targetChars = Math.floor(maxTokens * avgCharsPerToken);
      chunkEnd = currentStart + targetChars;
      
      // Try to find nearest boundary
      const nearbyBoundaries = boundaries.filter(b => 
        b.position > currentStart && 
        b.position < chunkEnd + 100 &&
        b.position > chunkEnd - 100
      );
      
      if (nearbyBoundaries.length > 0) {
        chunkEnd = nearbyBoundaries[0].position;
      }
    }
    
    // Ensure forward progress
    if (chunkEnd <= currentStart) {
      const avgCharsPerToken = text.length / totalTokens;
      chunkEnd = Math.min(currentStart + (maxTokens * avgCharsPerToken), text.length);
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
      
      // FIX: Simplify overlap - just use a small character overlap
      if (chunkEnd < text.length) {
        // Find last sentence boundary for overlap
        const overlapBoundaries = boundaries.filter(b => 
          b.position >= chunkEnd - 200 && 
          b.position < chunkEnd &&
          b.type === 'sentence'
        );
        
        if (overlapBoundaries.length > 0 && overlapTokens > 0) {
          // Start next chunk from last sentence
          currentStart = overlapBoundaries[overlapBoundaries.length - 1].position;
        } else {
          // No overlap
          currentStart = chunkEnd;
        }
      } else {
        currentStart = chunkEnd;
      }
    } else {
      currentStart = Math.min(currentStart + 100, text.length);
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
  
  // FIX: Remove the 0.8 multiplier - use full maxTokens
  const targetMax = maxTokens;  // Not: Math.floor(maxTokens * 0.8)
  
  let bestEnd = start;
  let closestToTarget = null;
  let closestDistance = Infinity;
  
  for (const boundary of availableBoundaries) {
    const segmentText = text.slice(start, boundary.position);
    const currentTokens = estimateTokenCount(segmentText);
    
    // FIX: Find boundary closest to target, not just first acceptable one
    const distance = Math.abs(currentTokens - targetMax);
    
    // Stop if we've exceeded max tokens
    if (currentTokens > targetMax) {
      // Use the closest boundary we've found so far
      if (closestToTarget) {
        return closestToTarget;
      }
      // Or use this boundary if it's the first one past the limit
      return boundary.position;
    }
    
    // Track the boundary closest to our target
    if (distance < closestDistance) {
      closestDistance = distance;
      closestToTarget = boundary.position;
    }
    
    // Update bestEnd to the furthest boundary within limits
    if (currentTokens <= targetMax) {
      bestEnd = boundary.position;
    }
  }
  
  // FIX: If no boundary found at target, force split at approximate position
  if (bestEnd === start && text.length > start) {
    // Estimate position for target tokens
    const avgCharsPerToken = 4;  // Approximate
    const targetPosition = start + (targetMax * avgCharsPerToken);
    return Math.min(targetPosition, text.length);
  }
  
  return bestEnd > start ? bestEnd : text.length;
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






export const generateTestFile = async () => {
  const response = await fetch(chrome.runtime.getURL('data/conversations.json'));
  const conversations = await response.json();
  const interactions = await processClaudeConversations({ conversations });
  
  // Pick diverse samples by length
  const samples = [
    interactions.find(i => i.aiResponse.length < 500),           // short
    interactions.find(i => i.aiResponse.length > 1000 && i.aiResponse.length < 2000),  // medium
    interactions.find(i => i.aiResponse.length > 5000),           // long
    interactions.find(i => i.aiResponse.includes('```')),         // code
    interactions.find(i => i.aiResponse.includes('##')),          // headers
    interactions.find(i => i.aiResponse.match(/^\d+\./m)),        // lists
  ].filter(Boolean).slice(0, 6);
  
  const tests = samples.map((s, i) => ({
    name: `real_${i}`,
    input: s.aiResponse.substring(0, 10000), // Cap length
    tokens: estimateTokenCount(s.aiResponse),
    expected: {
      small: Math.ceil(estimateTokenCount(s.aiResponse) / 250),   // ~300 max
      medium: Math.ceil(estimateTokenCount(s.aiResponse) / 500),  // ~600 max  
      large: Math.ceil(estimateTokenCount(s.aiResponse) / 800)    // ~1000 max
    }
  }));
  
  // Copy to clipboard for pasting into test file
  const testCode = `export const realWorldTests = ${JSON.stringify(tests, null, 2)};`;
  console.log(testCode)
  console.table(tests.map(t => ({ name: t.name, tokens: t.tokens, ...t.expected })));
  return tests;
};

export const realWorldTests = [
  {
    "name": "real_0",
    "input": " Yes! Here's a one-liner using `flatMap()`:\n\n```javascript\nconst allModels = new Set(\n  runtime.getModulesWithProperty('localModels')\n    .flatMap(module => module.manifest.localModels || [])\n);\n```\n\nThis:\n1. Gets modules with `localModels` property\n2. `flatMap()` flattens all the model arrays into one array (handles undefined/null with `|| []`)\n3. `Set()` constructor removes duplicates\n\nMuch cleaner than the forEach approach!",
    "tokens": 183,
    "expected": {
      "small": 1,
      "medium": 1,
      "large": 1
    }
  },
  {
    "name": "real_1",
    "input": " There are several approaches to compile your Chrome extension to a CRX file. Let me explain the options from simplest to most robust:\n\n## Approach Options:\n\n### 1. **Chrome Developer Dashboard (Recommended for Distribution)**\n- Upload your `build/` folder as a ZIP to the Chrome Web Store Developer Dashboard\n- Google automatically generates the CRX during the review process\n- Best for actual distribution\n\n### 2. **Chrome CLI with Private Key (Development/Testing)**\n- Use Chrome's built-in packing via command line\n- Requires generating and managing a private key\n- Good for testing signed builds locally\n\n### 3. **Build Script Integration (Most Convenient)**\n- Add CRX generation to your existing `scripts/build.js`\n- Automate the entire build-to-CRX process\n- Best for development workflow\n\n### 4. **Third-party Tools**\n- Use tools like `crx3` or `chrome-webstore-upload-cli`\n- More flexible but requires additional dependencies\n\n## Questions Before I Implement:\n\n1. **What's your primary use case?**\n   - Local testing of signed builds?\n   - Preparing for Chrome Web Store submission?\n   - Internal distribution to team members?\n\n2. **Do you want this integrated into your build process?**\n   - Should `npm run build` also generate a CRX?\n   - Or do you prefer a separate `npm run build:crx` command?\n\n3. **Key management preference?**\n   - Auto-generate and store private key?\n   - Use existing key file?\n   - No key management (just ZIP for upload)?\n\nThe simplest approach for most development workflows is option #3 (build script integration), but I want to confirm your specific needs before writing the implementation.\n\nWhich approach sounds best for your workflow?",
    "tokens": 491,
    "expected": {
      "small": 2,
      "medium": 1,
      "large": 1
    }
  },
  {
    "name": "real_2",
    "input": "The user is right to challenge my assumptions. Let me reconsider:\n\n1. They're saying the prebuilt browser bundle for Transformers.js v3 doesn't exist or isn't available\n2. They want to go the WebGPU route if it's not much harder\n3. They want to \"get it right first\" rather than just making it work with CPU\n\nLet me think about what WebGPU requires:\n- WebGPU support in the browser (Chrome has this)\n- ONNX Runtime WebGPU backend\n- Proper WASM files for WebGPU execution\n- Correct configuration\n\nLooking at the error messages and code, the issue is that Transformers.js is trying to load ONNX Runtime files from CDN. For WebGPU, it would need:\n- ort-wasm-simd-threaded.jsep.mjs (or similar WebGPU-enabled ONNX Runtime)\n- The associated WASM files\n\nThe challenge is that Transformers.js v3 is relatively new and the documentation might not be complete. Let me search for the correct approach.## You're Right - Let's Reassess\n\nYou're correct - Transformers.js v3 doesn't have a pre-built browser bundle like v2 did. Let's go straight for WebGPU since that's what you want.\n\n## WebGPU Route Analysis\n\nLooking at your error and the actual Transformers.js v3 architecture:\n\n### What WebGPU Needs:\n1. **ONNX Runtime WebGPU/JSEP files** - The actual execution engine\n2. **Proper WASM paths configuration** - Tell it where to find local files  \n3. **WebGPU-compatible models** - Your model (all-MiniLM-L6-v2) should work\n\n### The Real Issue:\nYour current code tries to load: `ort-wasm-simd-threaded.jsep.mjs` from CDN. This is the WebGPU-enabled ONNX Runtime.\n\n## Solution for WebGPU\n```\nThis block is not supported on your current device yet.\n```\n\nLooking at the search results, I can see several key insights:\n\n1. **WebGPU in Service Workers is problematic** - From the GitHub issue #20876, WebGPU doesn't work in service workers due to import() restrictions. The error \"import() is disallowed on ServiceWorkerGlobalScope\" is a known issue.\n\n2. **Offscreen Documents are the solution** - Multiple sources show that Chrome extensions need to use offscreen documents to access WebGPU. The user already has this set up!\n\n3. **ONNX Runtime WASM paths** - The key configuration needed is:\n   - `env.backends.onnx.wasm.wasmPaths` needs to point to local WASM files\n   - These files need to be downloaded from the ONNX Runtime CDN\n\n4. **WebGPU-specific ONNX files needed**:\n   - `ort-wasm-simd-threaded.jsep.mjs` (or similar WebGPU-enabled runtime)\n   - Associated WASM files\n\nLet me check what specific files are needed and provide a solution.## Critical Finding: WebGPU Won't Work in Service Workers\n\nLooking at the search results, there's a fundamental issue: WebGPU is not available in Service Workers - you get \"TypeError: import() is disallowed on ServiceWorkerGlobalScope\". \n\n**BUT** - you're already using offscreen documents which is the correct solution! In order to access WebGPU API, it launches the offscreen.html which includes offscreen.js. In offscreen.js the WebGPU is accessible.\n\n## WebGPU Solution for Your Setup\n\nSince your transformer module already runs in the offscreen context, you're perfectly positioned for WebGPU. Here's what's needed:\n\n### Step 1: Download ONNX Runtime WebGPU Files\n\nBased on the search results, you need these specific files from ONNX Runtime:\n```\nThis block is not supported on your current device yet.\n```\n\nI can't fetch that directly, but I can provide the user with the specific files they need to download based on the search results.### Files You Need to Download\n\nBased on the search results, download these ONNX Runtime WebGPU files:\n\n```\n# Core WebGPU files (from https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/)\n- ort.webgpu.min.js (or ort.webgpu.mjs) \n- ort-wasm-simd-threaded.jsep.wasm\n- ort-wasm-simd.wasm\n- ort-wasm.wasm\n```\n\n### Step 2: Update Your Build Script\n\nAdd to `scripts/build.js`:\n\n```javascript\n// Add after copyModels()\nconst copyOnnxRuntime = async () => {\n  const onnxDir = path.join(buildDir, 'onnx-runtime');\n  await fs.mkdir(onnxDir, { recursive: true });\n  \n  // Copy ONNX Runtime files you downloaded\n  const onnxFiles = [\n    'ort-wasm-simd-threaded.jsep.wasm',\n    'ort-wasm-simd.wasm', \n    'ort-wasm.wasm'\n  ];\n  \n  for (const file of onnxFiles) {\n    await fs.copyFile(\n      path.join(rootDir, 'onnx-runtime', file),\n      path.join(onnxDir, file)\n    );\n  }\n};\n```\n\n### Step 3: Update transformer.module.js for WebGPU\n\n```javascript\nexport const manifest = {\n  name: 'transformer',\n  context: \"offscreen\",\n  version: \"1.0.0\",\n  description: 'Hugging Face Transformers.js runtime for WebGPU acceleration',\n  actions: [\"getModel\", \"listModels\"],\n};\n\nconst pipelineCache = new Map();\nlet runtime;\n\nexport const initialize = async (rt) => {\n  runtime = rt;\n  initializeEnvironment();\n  await preloadModels();\n};\n\nconst initializeEnvironment = () => {\n  const env = Transformer.env;\n  \n  // Core settings\n  env.allowRemoteModels = false;\n  env.allowLocalModels = true;\n  env.localModelPath = chrome.runtime.getURL('models/');\n  \n  // Critical: Set WASM paths for WebGPU\n  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('onnx-runtime/');\n  \n  // WebGPU optimizations\n  if (env.backends?.onnx?.wasm) {\n    env.backends.onnx.wasm.numThreads = 1; // Service worker limitation\n  }\n};\n\nconst loadModel = async (params) => {\n  const { modelId, options = {} } = params;\n  if (pipelineCache.has(modelId)) return;\n  \n  try {\n    // Try WebGPU first (fastest)\n    const pipe = await Transformer.pipeline('feature-extraction', modelId, { \n      device: 'webgpu',\n      dtype: 'fp32',  // WebGPU default\n      local_files_only: true,\n      ...options\n    });\n    \n    pipelineCache.set(modelId, pipe);\n    runtime.log(`[Transformer] ✅ Loaded ${modelId} with WebGPU`);\n    \n  } catch (webgpuError) {\n    runtime.log(`[Transformer] WebGPU failed for ${modelId}, trying CPU...`, webgpuError.message);\n    \n    // Fallback to CPU\n    const pipe = await Transformer.pipeline('feature-extraction', modelId, { \n      device: 'cpu',  // Most compatible\n      dtype: 'q8',    // Quantized for CPU\n      local_files_only: true,\n      ...options\n    });\n    \n    pipelineCache.set(modelId, pipe);\n    runtime.log(`[Transformer] ✅ Loaded ${modelId} with CPU fallback`);\n  }\n};\n```\n\n### Step 4: Quick Test First\n\nBefore dealing with WASM files, let's verify WebGPU detection works:\n\n```javascript\n// Add this test function to transformer.module.js\nexport const testWebGPU = async () => {\n  try {\n    if (!navigator.gpu) {\n      return { available: false, reason: 'navigator.gpu not found' };\n    }\n    \n    const adapter = await navigator.gpu.requestAdapter();\n    if (!adapter) {\n      return { available: false, reason: 'No GPU adapter found' };\n    }\n    \n    const hasF16 = adapter.features.has('shader-f16');\n    return { \n      available: true, \n      adapter: adapter.name,\n      supportsF16: hasF16 \n    };\n  } catch (error) {\n    return { available: false, error: error.message };\n  }\n};\n```\n\n## The Real Challenge\n\nThe tricky part is that env.backends.onnx.wasm.wasmPaths defaults to use a CDN, but your CSP blocks external loading. You need to:\n\n1. **Download the WASM files manually** from `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/`\n2. **Place them in your extension** at `onnx-runtime/`  \n3. **Configure the path** as shown above\n\nWould you like me to:\n1. Help you identify the exact WASM files to download?\n2. Create a download script to automate this?\n3. Test with CPU-only first to ensure the basic setup works?\n\nThe WebGPU route isn't much harder - it's mostly about getting the right files in place. The code complexity is similar.",
    "tokens": 3200,
    "expected": {
      "small": 13,
      "medium": 7,
      "large": 4
    }
  },
  {
    "name": "real_3",
    "input": " Perfect! Here's how to stop tracking `transformers.min.js` while keeping your local copy:\n\n## Steps to Stop Tracking the File:\n\n### 1. Remove from Git tracking (but keep local file)\n```bash\ngit rm --cached transformers.min.js\n```\n\n### 2. Add to .gitignore to prevent future tracking\n```bash\necho \"transformers.min.js\" >> .gitignore\n```\n\n### 3. Commit the changes\n```bash\ngit add .gitignore\ngit commit -m \"Stop tracking transformers.min.js, add to .gitignore\"\n```\n\n## What this does:\n- ✅ Removes the file from Git's tracking system\n- ✅ Keeps your local copy intact\n- ✅ Prevents accidentally committing it again\n- ✅ Future pulls/clones won't include this file\n\n## Important Notes:\n- **Other team members**: When they pull this change, their local `transformers.min.js` will be deleted\n- **If they need the file**: They'll need to download/generate it separately\n- **The file remains in Git history**: Previous commits still contain it, but it won't be tracked going forward\n\nDoes this approach work for your needs? Should I proceed with these exact commands, or do you need any modifications (like adding it to a specific location in .gitignore)?",
    "tokens": 392,
    "expected": {
      "small": 2,
      "medium": 1,
      "large": 1
    }
  },
  {
    "name": "real_4",
    "input": " There are several approaches to compile your Chrome extension to a CRX file. Let me explain the options from simplest to most robust:\n\n## Approach Options:\n\n### 1. **Chrome Developer Dashboard (Recommended for Distribution)**\n- Upload your `build/` folder as a ZIP to the Chrome Web Store Developer Dashboard\n- Google automatically generates the CRX during the review process\n- Best for actual distribution\n\n### 2. **Chrome CLI with Private Key (Development/Testing)**\n- Use Chrome's built-in packing via command line\n- Requires generating and managing a private key\n- Good for testing signed builds locally\n\n### 3. **Build Script Integration (Most Convenient)**\n- Add CRX generation to your existing `scripts/build.js`\n- Automate the entire build-to-CRX process\n- Best for development workflow\n\n### 4. **Third-party Tools**\n- Use tools like `crx3` or `chrome-webstore-upload-cli`\n- More flexible but requires additional dependencies\n\n## Questions Before I Implement:\n\n1. **What's your primary use case?**\n   - Local testing of signed builds?\n   - Preparing for Chrome Web Store submission?\n   - Internal distribution to team members?\n\n2. **Do you want this integrated into your build process?**\n   - Should `npm run build` also generate a CRX?\n   - Or do you prefer a separate `npm run build:crx` command?\n\n3. **Key management preference?**\n   - Auto-generate and store private key?\n   - Use existing key file?\n   - No key management (just ZIP for upload)?\n\nThe simplest approach for most development workflows is option #3 (build script integration), but I want to confirm your specific needs before writing the implementation.\n\nWhich approach sounds best for your workflow?",
    "tokens": 491,
    "expected": {
      "small": 2,
      "medium": 1,
      "large": 1
    }
  },
  {
    "name": "real_5",
    "input": " There are several approaches to compile your Chrome extension to a CRX file. Let me explain the options from simplest to most robust:\n\n## Approach Options:\n\n### 1. **Chrome Developer Dashboard (Recommended for Distribution)**\n- Upload your `build/` folder as a ZIP to the Chrome Web Store Developer Dashboard\n- Google automatically generates the CRX during the review process\n- Best for actual distribution\n\n### 2. **Chrome CLI with Private Key (Development/Testing)**\n- Use Chrome's built-in packing via command line\n- Requires generating and managing a private key\n- Good for testing signed builds locally\n\n### 3. **Build Script Integration (Most Convenient)**\n- Add CRX generation to your existing `scripts/build.js`\n- Automate the entire build-to-CRX process\n- Best for development workflow\n\n### 4. **Third-party Tools**\n- Use tools like `crx3` or `chrome-webstore-upload-cli`\n- More flexible but requires additional dependencies\n\n## Questions Before I Implement:\n\n1. **What's your primary use case?**\n   - Local testing of signed builds?\n   - Preparing for Chrome Web Store submission?\n   - Internal distribution to team members?\n\n2. **Do you want this integrated into your build process?**\n   - Should `npm run build` also generate a CRX?\n   - Or do you prefer a separate `npm run build:crx` command?\n\n3. **Key management preference?**\n   - Auto-generate and store private key?\n   - Use existing key file?\n   - No key management (just ZIP for upload)?\n\nThe simplest approach for most development workflows is option #3 (build script integration), but I want to confirm your specific needs before writing the implementation.\n\nWhich approach sounds best for your workflow?",
    "tokens": 491,
    "expected": {
      "small": 2,
      "medium": 1,
      "large": 1
    }
  }
];

// Run validation
export const runRealTests = async () => {
  // const tests = await generateTestFile();
  const results = [];
  
  for (const test of realWorldTests) {
    const small = (await chunkText({ text: test.input, minTokens: 50, maxTokens: 300 })).chunks.length;
    const medium = (await chunkText({ text: test.input, minTokens: 100, maxTokens: 600 })).chunks.length;
    const large = (await chunkText({ text: test.input, minTokens: 200, maxTokens: 1000 })).chunks.length;
    
    results.push({
      name: test.name,
      tokens: test.tokens,
      small: `${small}/${test.expected.small} ${small === test.expected.small ? '✅' : '❌'}`,
      medium: `${medium}/${test.expected.medium} ${medium === test.expected.medium ? '✅' : '❌'}`,
      large: `${large}/${test.expected.large} ${large === test.expected.large ? '✅' : '❌'}`
    });
  }
  
  console.table(results);
  return results;
};