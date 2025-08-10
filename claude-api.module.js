export let manifest = {
  name: "claude-api",
  keywords: ["claude", "anthropic"],
  context: "service-worker",
  version: "1.0.0",
  permissions: ["storage"],
  dependencies: ["api-keys", "graph-db", "chunking", "embedding"],
  apiKeys: ["claude"],
  actions: ["setApiKey", "viewModels", "makeRequest", "searchExportedConversations", "processConversationsToGraph"], // Added new action
  defaultModel: "claude-3-5-sonnet-20241022"
};

const buildHeaders = () => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' });
const fetchModels = async () => (await (await fetch(`https://api.anthropic.com/v1/models`, { method: 'GET', headers: buildHeaders() })).json()).data;
export const viewModels = async () => console.table(Object.fromEntries((await fetchModels()).map(({ display_name, id, created_at }) => [display_name, { id, created_at }])));

let apiKey, runtime;
export const initialize = async (rt) => (runtime = rt, apiKey = await runtime.call("api-keys.getKey", { service: "claude" }));

export const makeRequest = async (params) => {
  const { model, messages, onChunk } = params;
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const body = {
    model,
    max_tokens: 4096,
    ...(systemMessage && { system: systemMessage.content }),
    messages: chatMessages,
    stream: true,
  };
  if (params.webSearch) body.tools = (body.tools ?? []).concat(addWebSearchTool(params.webSearch));

  const resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: buildHeaders(), body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`Claude API error: ${resp.status} - ${await resp.text()}`);
  return await processStream(resp, onChunk);
};
const addWebSearchTool = ({params}) => ({ "type": "web_search", "name": "web_search", "max_uses": params.max_uses || null, "allowed_domains": params.allowed_domains || null, ...(params.options ?? {})})

const processStream = async (resp, onChunk) => {
  let [reader, decoder, content, metadata] = [resp.body.getReader(), new TextDecoder(), '', { tokens: 0 }];
  try {
    for (let chunk; !(chunk = await reader.read()).done;)
      decoder.decode(chunk.value).split('\n').filter(l => l.startsWith('data: ') && l.slice(6) !== '[DONE]')
        .forEach(l => { try { const p = JSON.parse(l.slice(6)), d = p.delta?.text || p.content?.[0]?.text; d && (content += d, onChunk(d)); p.usage && (metadata.tokens = p.usage); } catch { } });
  } finally { reader.releaseLock(); }
  return { content, metadata };
};

manifest.models = [
  {
    "id": "claude-opus-4-20250514",
    "name": "Claude Opus 4",
    "family": "claude-4",
    "releaseDate": "2025-05-22T00:00:00Z",
    "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "web-search", "file-upload", "streaming"],
    "inputTypes": ["text", "image", "document"],
    "outputTypes": ["text", "code"],
    "bestFor": ["complex-reasoning", "code-generation", "document-analysis", "creative-writing", "science"],
    "contextWindow": 200000,
    "maxOutput": 32000,
    "pricing": { "input": 150, "output": 750 },
    "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 20000, "requestsPerDay": 72000 }
  },
  {
    "id": "claude-sonnet-4-20250514",
    "name": "Claude Sonnet 4",
    "family": "claude-4",
    "releaseDate": "2025-05-22T00:00:00Z",
    "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "web-search", "file-upload", "streaming"],
    "inputTypes": ["text", "image", "document"],
    "outputTypes": ["text", "code"],
    "bestFor": ["conversation", "code-generation", "document-analysis", "complex-reasoning"],
    "contextWindow": 200000,
    "maxOutput": 64000,
    "pricing": { "input": 30, "output": 150 },
    "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 40000, "requestsPerDay": 72000 }
  },
  {
    "id": "claude-3-7-sonnet-20250219",
    "name": "Claude Sonnet 3.7",
    "family": "claude-3-7",
    "releaseDate": "2025-02-24T00:00:00Z",
    "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"],
    "inputTypes": ["text", "image", "document"],
    "outputTypes": ["text", "code"],
    "bestFor": ["complex-reasoning", "code-generation", "document-analysis", "math", "science"],
    "contextWindow": 200000,
    "maxOutput": 64000,
    "pricing": { "input": 30, "output": 150 },
    "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 40000, "requestsPerDay": 72000 }
  },
  {
    "id": "claude-3-5-sonnet-20241022",
    "name": "Claude Sonnet 3.5 (New)",
    "family": "claude-3-5",
    "releaseDate": "2024-10-22T00:00:00Z",
    "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"],
    "inputTypes": ["text", "image", "document"],
    "outputTypes": ["text", "code"],
    "bestFor": ["conversation", "code-generation", "document-analysis", "complex-reasoning"],
    "contextWindow": 200000,
    "maxOutput": 4096,
    "pricing": { "input": 30, "output": 150 },
    "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 40000, "requestsPerDay": 72000 }
  },
  {
    "id": "claude-3-5-haiku-20241022",
    "name": "Claude Haiku 3.5",
    "family": "claude-3-5",
    "releaseDate": "2024-10-22T00:00:00Z",
    "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"],
    "inputTypes": ["text", "image", "document"],
    "outputTypes": ["text", "code"],
    "bestFor": ["conversation", "summarization", "code-generation", "translation"],
    "contextWindow": 200000,
    "maxOutput": 8192,
    "pricing": { "input": 8, "output": 40 },
    "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 50000, "requestsPerDay": 72000 }
  },
  {
    "id": "claude-3-5-sonnet-20240620",
    "name": "Claude Sonnet 3.5 (Old)",
    "family": "claude-3-5",
    "releaseDate": "2024-06-20T00:00:00Z",
    "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"],
    "inputTypes": ["text", "image", "document"],
    "outputTypes": ["text", "code"],
    "bestFor": ["conversation", "code-generation", "document-analysis", "creative-writing"],
    "contextWindow": 200000,
    "maxOutput": 8192,
    "pricing": { "input": 30, "output": 150 },
    "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 40000, "requestsPerDay": 72000 }
  },
  {
    "id": "claude-3-haiku-20240307",
    "name": "Claude Haiku 3",
    "family": "claude-3",
    "releaseDate": "2024-03-07T00:00:00Z",
    "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"],
    "inputTypes": ["text", "image", "document"],
    "outputTypes": ["text", "code"],
    "bestFor": ["conversation", "summarization", "translation", "document-analysis"],
    "contextWindow": 200000,
    "maxOutput": 4096,
    "pricing": { "input": 3, "output": 13 },
    "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 50000, "requestsPerDay": 72000 }
  },
  {
    "id": "claude-3-opus-20240229",
    "name": "Claude Opus 3",
    "family": "claude-3",
    "releaseDate": "2024-02-29T00:00:00Z",
    "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"],
    "inputTypes": ["text", "image", "document"],
    "outputTypes": ["text", "code"],
    "bestFor": ["complex-reasoning", "creative-writing", "document-analysis", "math", "science"],
    "contextWindow": 200000,
    "maxOutput": 4096,
    "pricing": { "input": 150, "output": 750 },
    "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 20000, "requestsPerDay": 72000 }
  }
];




const getConversations = async () => await (await fetch(chrome.runtime.getURL('data/conversations.json'))).json();
export const searchExportedConversations = async (params) => {
  const { query, caseSensitive = false, operator = "OR" } = params;
  if (!query) return { success: false, error: 'Search query required' };
  
  try {
    const { phrases, terms } = parseSearchQuery(query);
    const conversations = await getConversations();
    const matches = conversations.filter(conv => matchesConversation(conv, phrases, terms, caseSensitive, operator));
    
    if (matches.length === 0) {
      console.log(`No conversations found matching "${query}" (${operator})`);
      return { success: true, count: 0 };
    }
    
    console.log(`Found ${matches.length} conversations matching "${query}" (${operator}):`);
    matches.forEach((conv, i) => logConversation(conv, i, phrases, terms, caseSensitive, operator));
    
    return { success: true, count: matches.length, conversations: matches, query: { original: query, phrases, terms, operator } };
  } catch (error) {
    console.error('[Dev] Error searching conversations:', error);
    return { success: false, error: error.message };
  }
};

const parseSearchQuery = (query) => {
  const phrases = (query.match(/"([^"]*)"/g) || []).map(m => m.slice(1, -1).trim()).filter(Boolean);
  const terms = query.replace(/"[^"]*"/g, '').trim().split(/\s+/).filter(Boolean);
  return { phrases, terms };
};

const matchesConversation = (conv, phrases, terms, caseSensitive, operator) => {
  const searchText = [conv.name || '', ...(conv.chat_messages || []).map(m => m.text || '')].join(' ');
  const text = caseSensitive ? searchText : searchText.toLowerCase();
  const items = [...(caseSensitive ? phrases : phrases.map(p => p.toLowerCase())), ...(caseSensitive ? terms : terms.map(t => t.toLowerCase()))];
  return items.length > 0 && (operator === "AND" ? items.every(item => text.includes(item)) : items.some(item => text.includes(item)));
};

const findMatchingMessages = (conv, phrases, terms, caseSensitive, operator) => {
  const items = [...(caseSensitive ? phrases : phrases.map(p => p.toLowerCase())), ...(caseSensitive ? terms : terms.map(t => t.toLowerCase()))];
  return (conv.chat_messages || []).filter(msg => {
    const text = caseSensitive ? msg.text : msg.text?.toLowerCase();
    return operator === "AND" ? items.every(item => text?.includes(item)) : items.some(item => text?.includes(item));
  });
};

const logConversation = (conv, index, phrases, terms, caseSensitive, operator) => {
  const created = new Date(conv.created_at).toLocaleString();
  const [humanMsgs, aiMsgs] = [conv.chat_messages?.filter(m => m.sender === 'human').length || 0, conv.chat_messages?.filter(m => m.sender === 'assistant').length || 0];
  
  console.group(`${index + 1}. ${conv.name} (${created})`);
  console.log(`ID: https://claude.ai/chat/${conv.uuid}`);
  console.log(`Messages: ${conv.chat_messages?.length || 0} (${humanMsgs} human, ${aiMsgs} AI)`);
  
  const matchingMsgs = findMatchingMessages(conv, phrases, terms, caseSensitive, operator);
  if (matchingMsgs.length > 0) {
    console.log(`Matching messages: ${matchingMsgs.length}`);
    const preview = matchingMsgs[0].text.length > 150 ? matchingMsgs[0].text.substring(0, 150) + '...' : matchingMsgs[0].text;
    console.log(`Preview (${matchingMsgs[0].sender}): ${preview}`);
  }
  console.groupEnd();
};



export const processConversationsToGraph = async ({batchSize = 5, skipExisting = true }) => {
  let [totalProcessed, totalInteractions, totalSkipped] = [0, 0, 0];
  const conversations = await getConversations();
  runtime.log(`[Claude] Starting to process ${conversations.length} conversations with batchSize=${batchSize}, skipExisting=${skipExisting}`);
  
  for (let i = 0; i < conversations.length; i += batchSize) {
    const batch = conversations.slice(i, i + batchSize);
    runtime.log(`[Claude] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(conversations.length/batchSize)} (${batch.length} conversations)`);
    
    const batchResults = await Promise.all(batch.map(conv => processConversation(conv, skipExisting)));
    const { processed, interactions, skipped } = batchResults.reduce((acc, r) => ({ processed: acc.processed + 1, interactions: acc.interactions + r.interactions, skipped: acc.skipped + r.skipped }), { processed: 0, interactions: 0, skipped: 0 });
    
    [totalProcessed, totalInteractions, totalSkipped] = [totalProcessed + processed, totalInteractions + interactions, totalSkipped + skipped];
    runtime.log(`[Claude] Batch complete: ${interactions} interactions, ${skipped} skipped`);
    
    if (i + batchSize < conversations.length) await new Promise(r => setTimeout(r, 100));
  }
  
  runtime.log(`[Claude] Processing complete: ${totalProcessed} conversations, ${totalInteractions} interactions, ${totalSkipped} skipped`);
  return { success: true, processedConversations: totalProcessed, totalInteractions, skipped: totalSkipped };
};

const processConversation = async (conversation, skipExisting) => {
  runtime.log(`[Claude] Processing conversation: "${conversation.name}" (${conversation.uuid})`);
  
  const interactions = extractMessagePairs(conversation.chat_messages);
  runtime.log(`[Claude] Extracted ${interactions.length} message pairs from conversation "${conversation.name}"`);
  
  let [processedInteractions, skippedInteractions] = [0, 0];
  
  for (let i = 0; i < interactions.length; i++) {
    const interaction = interactions[i];
    runtime.log(`[Claude] Processing interaction ${i + 1}/${interactions.length} in conversation "${conversation.name}"`);
    
    try {
      // Check if already exists
      if (skipExisting && await runtime.call('graph-db.findInteractionByIds', { 
        humanMessageId: interaction.humanMessageId, 
        assistantMessageId: interaction.assistantMessageId 
      })) {
        runtime.log(`[Claude] Skipping existing interaction ${i + 1} in conversation "${conversation.name}"`);
        skippedInteractions++;
        continue;
      }
      
      // Create the interaction node
      runtime.log(`[Claude] Creating interaction node for interaction ${i + 1} in conversation "${conversation.name}"`);
      const interactionNodeId = await runtime.call('graph-db.addInferenceNode', {
        userPrompt: interaction.userPrompt,
        assembledPrompt: interaction.userPrompt,
        response: interaction.aiResponse,
        model: 'claude-conversation-export',
        context: { 
          conversationId: conversation.uuid, 
          conversationName: conversation.name, 
          timestamp: interaction.timestamp, 
          messageIds: { human: interaction.humanMessageId, assistant: interaction.assistantMessageId } 
        }
      });
      
      runtime.log(`[Claude] Created interaction node with ID: ${interactionNodeId} for conversation "${conversation.name}"`);
      
      if (!interactionNodeId) {
        throw new Error(`Failed to create interaction node for conversation ${conversation.name} - received null/undefined ID`);
      }
      
      // Chunk the text
      runtime.log(`[Claude] Chunking texts for interaction ${i + 1} in conversation "${conversation.name}"`);
      runtime.log(`[Claude] Prompt length: ${interaction.userPrompt?.length || 0} chars, Response length: ${interaction.aiResponse?.length || 0} chars`);
      
      const [promptChunks, responseChunks] = await Promise.all([
        runtime.call('chunking.chunkText', { text: interaction.userPrompt, minTokens: 30, maxTokens: 200 }),
        runtime.call('chunking.chunkText', { text: interaction.aiResponse, minTokens: 100, maxTokens: 500 })
      ]);
      
      runtime.log(`[Claude] Chunking results for interaction ${i + 1}: prompt chunks=${promptChunks?.chunks?.length || 0}, response chunks=${responseChunks?.chunks?.length || 0}`);
      
      if (!promptChunks || !responseChunks) {
        throw new Error(`Failed to chunk interaction ${i + 1} in conversation ${conversation.name} - promptChunks: ${!!promptChunks}, responseChunks: ${!!responseChunks}`);
      }
      
      if (!promptChunks.chunks || !responseChunks.chunks) {
        throw new Error(`Chunks property missing - promptChunks.chunks: ${!!promptChunks.chunks}, responseChunks.chunks: ${!!responseChunks.chunks}`);
      }
      
      // Store chunk references
      runtime.log(`[Claude] Storing chunk references for interaction ${i + 1} in conversation "${conversation.name}"`);
      
      const [promptStore, responseStore] = await Promise.all([
        storeChunkReferences(promptChunks.chunks, interactionNodeId, 'prompt_chunk', conversation.name, i + 1),
        storeChunkReferences(responseChunks.chunks, interactionNodeId, 'response_chunk', conversation.name, i + 1)
      ]);
      
      runtime.log(`[Claude] Chunk storage results for interaction ${i + 1}: promptStore=${!!promptStore}, responseStore=${!!responseStore}`);
      
      if (promptStore === false || responseStore === false) {
        throw new Error(`Failed to store chunk references for interaction ${i + 1} in conversation ${conversation.name} - promptStore: ${promptStore}, responseStore: ${responseStore}`);
      }
      
      processedInteractions++;
      runtime.log(`[Claude] ✅ Successfully processed interaction ${i + 1}/${interactions.length} in conversation "${conversation.name}"`);
      
    } catch (error) {
      runtime.logError(`[Claude] ❌ Error processing interaction ${i + 1} in conversation "${conversation.name}":`, error);
      throw new Error(`Failed to process interaction ${i + 1} in conversation ${conversation.name}: ${error.message}`);
    }
  }
  
  runtime.log(`[Claude] Completed conversation "${conversation.name}": ${processedInteractions} processed, ${skippedInteractions} skipped`);
  return { interactions: processedInteractions, skipped: skippedInteractions };
};

const storeChunkReferences = async (chunks, parentInteractionId, chunkType, conversationName, interactionIndex) => {
  runtime.log(`[Claude] storeChunkReferences called with ${chunks?.length || 0} chunks, nodeId: ${parentInteractionId}, type: ${chunkType}`);
  
  if (!chunks || chunks.length === 0) {
    runtime.log(`[Claude] No chunks to store for ${chunkType} in conversation "${conversationName}" interaction ${interactionIndex}`);
    return true; // No chunks to store is not an error
  }
  
  if (!parentInteractionId) {
    throw new Error(`Invalid parentInteractionId: ${parentInteractionId} for ${chunkType} in conversation "${conversationName}" interaction ${interactionIndex}`);
  }
  
  try {
    const chunkData = chunks.map(c => {
      if (!c) {
        runtime.logError(`[Claude] Null/undefined chunk found in ${chunkType} for conversation "${conversationName}" interaction ${interactionIndex}`);
        return null;
      }
      
      return {
        text: c.text || '',
        tokenCount: c.tokenCount || 0,
        chunkIndex: c.chunkIndex || 0,
        startPos: c.startPos || 0,
        endPos: c.endPos || 0
      };
    }).filter(Boolean); // Remove any null chunks
    
    runtime.log(`[Claude] Updating node ${parentInteractionId} with ${chunkData.length} ${chunkType}s`);
    
    const result = await runtime.call('graph-db.updateNode', {
      nodeId: parentInteractionId,
      updateData: { [`${chunkType}s`]: chunkData }
    });
    
    runtime.log(`[Claude] Successfully updated node ${parentInteractionId} with ${chunkType}s`);
    return result;
    
  } catch (error) {
    runtime.logError(`[Claude] Error storing ${chunkType} references for node ${parentInteractionId} in conversation "${conversationName}" interaction ${interactionIndex}:`, error);
    throw error;
  }
};

const extractMessagePairs = (chatMessages) => {
  runtime.log(`[Claude] Extracting message pairs from ${chatMessages?.length || 0} chat messages`);
  
  if (!chatMessages || !Array.isArray(chatMessages)) {
    runtime.logError(`[Claude] Invalid chatMessages:`, chatMessages);
    return [];
  }
  
  const interactions = [];
  let currentHuman = null;
  let unpairedHuman = 0;
  let unpairedAssistant = 0;
  
  for (let i = 0; i < chatMessages.length; i++) {
    const message = chatMessages[i];
    
    if (!message) {
      runtime.logError(`[Claude] Null/undefined message at index ${i}`);
      continue;
    }
    
    if (message.sender === 'human') {
      if (currentHuman) {
        runtime.log(`[Claude] Found unpaired human message, replacing with new one at index ${i}`);
        unpairedHuman++;
      }
      
      currentHuman = { 
        userPrompt: message.text || '',
        humanMessageId: message.uuid,
        timestamp: message.created_at 
      };
    } else if (message.sender === 'assistant' && currentHuman) {
      interactions.push({ 
        ...currentHuman, 
        aiResponse: message.text || '',
        assistantMessageId: message.uuid,
        timestamp: message.created_at 
      });
      currentHuman = null;
    } else if (message.sender === 'assistant') {
      runtime.log(`[Claude] Found unpaired assistant message at index ${i}`);
      unpairedAssistant++;
    }
  }
  
  if (currentHuman) {
    unpairedHuman++;
  }
  
  runtime.log(`[Claude] Message pair extraction complete: ${interactions.length} pairs, ${unpairedHuman} unpaired human, ${unpairedAssistant} unpaired assistant`);
  
  return interactions;
};