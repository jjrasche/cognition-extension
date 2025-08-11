export const manifest = {
  name: "chunking",
  version: "1.0.0",
  description: "Semantic chunking for documents and text with flexible size boundaries",
  context: "service-worker",
  permissions: ["storage"],
  actions: ["chunkText", "chunkInferenceInteraction", "chunkDocument", "testWithClaudeData", "runAllChunkingTests", "analyzeConversationChunking","extractTestCases", "generateStaticTestCases", "validateRealWorldChunking", "runRealTests", "generateTestFile", "debugChunking", "testTokenEstimation", "runUpdatedTests", "visualizeChunking", "exploreChunk", "visualizeChunkingWithMap", "visualizeChunkSplits"],
  // dependencies: ["embedding"],
  state: {
    reads: [],
    writes: ["chunking.stats", "chunking.config"]
  }
};

let runtime;
export const initialize = async (rt) => { runtime = rt; };


const estimateTokenCount = (text) => {
  if (!text) return 0;
  
  // Empirical ratios from GPT tokenizer testing:
  // - Average English text: ~1 token per 4 characters
  // - With punctuation: ~1 token per 3.8 characters  
  // - Code: ~1 token per 3.5 characters
  // - Mixed content: ~1 token per 3.7 characters
  
  // Count words and special characters
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const punctuation = (text.match(/[.,!?;:()[\]{}"`'""—–\-]/g) || []).length;
  const hasCode = text.includes('```') || text.includes('`');
  
  // Base calculation: words + some punctuation
  let tokenCount = words.length;
  
  // Add tokens for punctuation (not all punctuation is a separate token)
  tokenCount += punctuation * 0.3;
  
  // Adjust for word length (longer words = more tokens)
  for (const word of words) {
    if (word.length > 10) {
      tokenCount += 0.5; // Long words often split
    }
    if (word.length > 15) {
      tokenCount += 0.5; // Very long words split more
    }
  }
  
  // If there's code, use character-based estimation for those parts
  if (hasCode) {
    const codeBlocks = (text.match(/```[\s\S]*?```/g) || []).join('');
    const inlineCode = (text.match(/`[^`\n]+`/g) || []).join('');
    const codeChars = codeBlocks.length + inlineCode.length;
    
    if (codeChars > 0) {
      // Remove word count for code sections and use char-based estimate
      const codeWords = (codeBlocks + inlineCode).split(/\s+/).length;
      tokenCount -= codeWords;
      tokenCount += codeChars / 3.5;
    }
  }
  
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
  
  // Early return for empty text
  if (!text || text.trim().length === 0) {
    return [];
  }
  
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
  
  const chunks = [];
  let currentStart = 0;
  
  // AGGRESSIVE CHUNKING: Calculate expected number of chunks
  // Use a target size that will produce the expected number of chunks
  // For small (50-300): use ~250 tokens per chunk
  // For medium (100-600): use ~450 tokens per chunk  
  // For large (200-1000): use ~800 tokens per chunk
  const optimalChunkSize = Math.min(maxTokens * 0.83, maxTokens - 50);
  const expectedChunks = Math.ceil(totalTokens / optimalChunkSize);
  const actualTargetTokens = Math.floor(totalTokens / expectedChunks);
  
  runtime.log(`[Chunking] Total tokens: ${totalTokens}, Target per chunk: ${actualTargetTokens}, Expected chunks: ${expectedChunks}`);
  
  while (currentStart < text.length) {
    const remainingText = text.slice(currentStart);
    const remainingTokens = estimateTokenCount(remainingText);
    
    // If remaining fits in max tokens, take it all
    if (remainingTokens <= maxTokens) {
      const chunkText = remainingText.trim();
      if (chunkText.length > 0) {
        chunks.push({
          text: chunkText,
          tokenCount: remainingTokens,
          startPos: currentStart,
          endPos: text.length,
          chunkIndex: chunks.length
        });
      }
      break;
    }
    
    // FORCE CHUNKING: Calculate exact position for target tokens
    // Use character/token ratio for THIS specific text
    const charsPerToken = text.length / totalTokens;
    const targetChunkChars = Math.floor(actualTargetTokens * charsPerToken);
    
    // Start by looking at the exact target position
    let chunkEnd = currentStart + targetChunkChars;
    
    // Ensure we don't go past the end
    chunkEnd = Math.min(chunkEnd, text.length);
    
    // Look for a boundary near our target (within 20% range)
    const searchRange = Math.floor(targetChunkChars * 0.2);
    const searchStart = Math.max(currentStart, chunkEnd - searchRange);
    const searchEnd = Math.min(text.length, chunkEnd + searchRange);
    
    let bestBoundary = null;
    let bestScore = -1;
    
    for (const boundary of boundaries) {
      if (boundary.position <= searchStart) continue;
      if (boundary.position >= searchEnd) break;
      
      // Score based on proximity to target and boundary strength
      const distance = Math.abs(boundary.position - chunkEnd);
      const normalizedDistance = 1 - (distance / searchRange);
      const strengthBonus = (boundary.strength || 1) / 10;
      const score = normalizedDistance + strengthBonus;
      
      if (score > bestScore) {
        const segmentTokens = estimateTokenCount(text.slice(currentStart, boundary.position));
        // Only use if it's within reasonable token range
        if (segmentTokens >= minTokens && segmentTokens <= maxTokens) {
          bestScore = score;
          bestBoundary = boundary.position;
        }
      }
    }
    
    // Use boundary if found, otherwise use calculated position
    if (bestBoundary) {
      chunkEnd = bestBoundary;
    } else {
      // No boundary found - try to at least break at a word
      const nearestSpace = text.indexOf(' ', chunkEnd);
      const previousSpace = text.lastIndexOf(' ', chunkEnd);
      
      if (nearestSpace !== -1 && nearestSpace - chunkEnd < 50) {
        chunkEnd = nearestSpace;
      } else if (previousSpace !== -1 && chunkEnd - previousSpace < 50) {
        chunkEnd = previousSpace;
      }
    }
    
    // Absolute minimum progress to prevent infinite loops
    if (chunkEnd <= currentStart) {
      chunkEnd = Math.min(currentStart + 100, text.length);
      console.warn(`[Chunking] Forced progress from ${currentStart} to ${chunkEnd}`);
    }
    
    // Extract and save the chunk
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
      runtime.log(`[Chunking] Chunk ${chunks.length}: ${tokenCount} tokens`);
    }
    
    // Simple overlap handling - just move forward
    if (overlapTokens > 0 && chunkEnd < text.length) {
      // Very small overlap to not consume too many tokens
      const overlapChars = Math.min(50, Math.floor(overlapTokens * 2));
      currentStart = chunkEnd - overlapChars;
    } else {
      currentStart = chunkEnd;
    }
    
    // Ensure forward progress
    if (currentStart >= text.length) break;
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

