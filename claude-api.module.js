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
  const { query, caseSensitive = false } = params;
  if (!query) {
    runtime.log('[Dev] Search query required');
    return { success: false, error: 'Search query required' };
  }
  
  try {
    // Load conversations
    const response = await fetch(chrome.runtime.getURL('data/conversations.json'));
    const conversations = await response.json();
    
    // Search for matching conversations
    const searchTerm = caseSensitive ? query : query.toLowerCase();
    const matches = conversations.filter(conv => {
      // Check conversation name
      if ((caseSensitive ? conv.name : conv.name?.toLowerCase())?.includes(searchTerm)) {
        return true;
      }
      
      // Check message content
      return conv.chat_messages?.some(msg => 
        (caseSensitive ? msg.text : msg.text?.toLowerCase())?.includes(searchTerm)
      );
    });
    
    // Display results in console
    if (matches.length === 0) {
      console.log(`No conversations found matching "${query}"`);
      return { success: true, count: 0 };
    }
    
    console.log(`Found ${matches.length} conversations matching "${query}":`);
    
    // Format and display each conversation
    matches.forEach((conv, index) => {
      // Format timestamp
      const created = new Date(conv.created_at).toLocaleString();
      
      // Count messages by type
      const humanMsgs = conv.chat_messages?.filter(m => m.sender === 'human').length || 0;
      const aiMsgs = conv.chat_messages?.filter(m => m.sender === 'assistant').length || 0;
      
      // Display conversation header
      console.group(`${index + 1}. ${conv.name} (${created})`);
      console.log(`ID: ${conv.uuid}`);
      console.log(`Messages: ${conv.chat_messages?.length || 0} (${humanMsgs} human, ${aiMsgs} AI)`);
      
      // Find matching messages
      const matchingMsgs = conv.chat_messages?.filter(msg => 
        (caseSensitive ? msg.text : msg.text?.toLowerCase())?.includes(searchTerm)
      ) || [];
      
      if (matchingMsgs.length > 0) {
        console.log(`Matching messages: ${matchingMsgs.length}`);
        
        // Display first matching message preview
        if (matchingMsgs.length > 0) {
          const msg = matchingMsgs[0];
          const preview = msg.text.length > 150 ? 
            msg.text.substring(0, 150) + '...' : 
            msg.text;
          
          console.log(`Preview (${msg.sender}): ${preview}`);
        }
      }
      
      console.groupEnd();
    });
    
    return { 
      success: true, 
      count: matches.length, 
      conversations: matches
    };
  } catch (error) {
    console.error('[Dev] Error searching conversations:', error);
    return { success: false, error: error.message };
  }
};