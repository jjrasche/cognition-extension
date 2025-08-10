export let manifest = {
  name: "claude-api",
  keywords: ["claude", "anthropic"],
  context: "service-worker",
  version: "1.0.0",
  permissions: ["storage"],
  dependencies: ["api-keys"],
  apiKeys: ["claude"],
  actions: ["setApiKey", "viewModels", "makeRequest", "searchExportedConversations"],
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






export const searchExportedConversations = async (params) => {
  const { query, caseSensitive = false, operator = "OR" } = params;
  
  if (!query) {
    runtime.log('[Dev] Search query required');
    return { success: false, error: 'Search query required' };
  }
  
  try {
    // Parse query for exact phrases and individual terms
    const { phrases, terms } = parseSearchQuery(query);
    
    // Load conversations
    const response = await fetch(chrome.runtime.getURL('data/conversations.json'));
    const conversations = await response.json();
    
    // Search for matching conversations
    const matches = conversations.filter(conv => {
      return matchesConversation(conv, phrases, terms, caseSensitive, operator);
    });
    
    // Display results (keep existing format)
    if (matches.length === 0) {
      console.log(`No conversations found matching "${query}" (${operator})`);
      return { success: true, count: 0 };
    }
    
    console.log(`Found ${matches.length} conversations matching "${query}" (${operator}):`);
    
    // Same display logic as before...
    matches.forEach((conv, index) => {
      const created = new Date(conv.created_at).toLocaleString();
      const humanMsgs = conv.chat_messages?.filter(m => m.sender === 'human').length || 0;
      const aiMsgs = conv.chat_messages?.filter(m => m.sender === 'assistant').length || 0;
      
      console.group(`${index + 1}. ${conv.name} (${created})`);
      console.log(`ID: https://claude.ai/chat/${conv.uuid}`);
      console.log(`Messages: ${conv.chat_messages?.length || 0} (${humanMsgs} human, ${aiMsgs} AI)`);
      
      // Show matching messages
      const matchingMsgs = findMatchingMessages(conv, phrases, terms, caseSensitive, operator);
      if (matchingMsgs.length > 0) {
        console.log(`Matching messages: ${matchingMsgs.length}`);
        const msg = matchingMsgs[0];
        const preview = msg.text.length > 150 ? 
          msg.text.substring(0, 150) + '...' : 
          msg.text;
        console.log(`Preview (${msg.sender}): ${preview}`);
      }
      
      console.groupEnd();
    });
    
    return { 
      success: true, 
      count: matches.length, 
      conversations: matches,
      query: { original: query, phrases, terms, operator }
    };
  } catch (error) {
    console.error('[Dev] Error searching conversations:', error);
    return { success: false, error: error.message };
  }
};

// Helper function to parse search query
function parseSearchQuery(query) {
  const phrases = [];
  const terms = [];
  
  // Extract quoted phrases first
  const phraseMatches = query.match(/"([^"]*)"/g);
  let remainingQuery = query;
  
  if (phraseMatches) {
    phraseMatches.forEach(match => {
      const phrase = match.slice(1, -1); // Remove quotes
      if (phrase.trim()) {
        phrases.push(phrase.trim());
      }
      remainingQuery = remainingQuery.replace(match, '');
    });
  }
  
  // Extract individual terms from remaining query
  const individualTerms = remainingQuery.trim().split(/\s+/).filter(term => term.length > 0);
  terms.push(...individualTerms);
  
  return { phrases, terms };
}

// Helper function to check if conversation matches
function matchesConversation(conv, phrases, terms, caseSensitive, operator) {
  // Collect all searchable text
  const searchTexts = [
    conv.name || '',
    ...(conv.chat_messages || []).map(msg => msg.text || '')
  ];
  
  const allText = searchTexts.join(' ');
  const searchIn = caseSensitive ? allText : allText.toLowerCase();
  
  // Prepare search terms
  const searchPhrases = caseSensitive ? phrases : phrases.map(p => p.toLowerCase());
  const searchTerms = caseSensitive ? terms : terms.map(t => t.toLowerCase());
  
  // Combine all search items
  const allSearchItems = [...searchPhrases, ...searchTerms];
  
  if (allSearchItems.length === 0) return false;
  
  if (operator === "AND") {
    return allSearchItems.every(item => searchIn.includes(item));
  } else {
    return allSearchItems.some(item => searchIn.includes(item));
  }
}

// Helper function to find matching messages
function findMatchingMessages(conv, phrases, terms, caseSensitive, operator) {
  return (conv.chat_messages || []).filter(msg => {
    const text = caseSensitive ? msg.text : msg.text?.toLowerCase();
    const searchPhrases = caseSensitive ? phrases : phrases.map(p => p.toLowerCase());
    const searchTerms = caseSensitive ? terms : terms.map(t => t.toLowerCase());
    
    const allSearchItems = [...searchPhrases, ...searchTerms];
    
    if (operator === "AND") {
      return allSearchItems.every(item => text?.includes(item));
    } else {
      return allSearchItems.some(item => text?.includes(item));
    }
  });
}