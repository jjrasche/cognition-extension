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
  const interactions = extractMessagePairs(conversation.chat_messages);
  let [processedInteractions, skippedInteractions] = [0, 0];
  
  for (const interaction of interactions) {
    if (skipExisting && await runtime.call('graph-db.findInteractionByIds', { humanMessageId: interaction.humanMessageId, assistantMessageId: interaction.assistantMessageId })) {
      skippedInteractions++;
      continue;
    }
    
    try {
      const interactionNodeId = await runtime.call('graph-db.addInferenceNode', {
        userPrompt: interaction.userPrompt,
        assembledPrompt: interaction.userPrompt,
        response: interaction.aiResponse,
        model: 'claude-conversation-export',
        context: { conversationId: conversation.uuid, conversationName: conversation.name, timestamp: interaction.timestamp, messageIds: { human: interaction.humanMessageId, assistant: interaction.assistantMessageId } }
      });
      
      const [promptChunks, responseChunks] = await Promise.all([
        runtime.call('chunking.chunkText', { text: interaction.userPrompt, minTokens: 30, maxTokens: 200 }),
        runtime.call('chunking.chunkText', { text: interaction.aiResponse, minTokens: 100, maxTokens: 500 })
      ]);
      
      await Promise.all([
        storeChunkReferences(promptChunks.chunks, interactionNodeId, 'prompt_chunk'),
        storeChunkReferences(responseChunks.chunks, interactionNodeId, 'response_chunk')
      ]);
      
      processedInteractions++;
    } catch (error) {
      runtime.logError(`[Claude] Failed to process interaction in ${conversation.name}:`, error);
    }
  }
  
  return { interactions: processedInteractions, skipped: skippedInteractions };
};

const storeChunkReferences = async (chunks, parentInteractionId, chunkType) => 
  chunks.length > 0 && await runtime.call('graph-db.updateNode', {
    nodeId: parentInteractionId,
    updateData: { [`${chunkType}s`]: chunks.map(c => ({ text: c.text, tokenCount: c.tokenCount, chunkIndex: c.chunkIndex, startPos: c.startPos, endPos: c.endPos })) }
  });

const extractMessagePairs = (chatMessages) => {
  const interactions = [];
  let currentHuman = null;
  
  for (const message of chatMessages) {
    if (message.sender === 'human') {
      currentHuman = { userPrompt: message.text, humanMessageId: message.uuid, timestamp: message.created_at };
    } else if (message.sender === 'assistant' && currentHuman) {
      interactions.push({ ...currentHuman, aiResponse: message.text, assistantMessageId: message.uuid, timestamp: message.created_at });
      currentHuman = null;
    }
  }
  
  return interactions;
};