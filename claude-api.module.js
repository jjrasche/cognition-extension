export let manifest = {
  name: "claude-api",
  keywords: ["claude", "anthropic"],
  context: ["service-worker"],
  version: "1.0.0",
  dependencies: ["api-keys"],
  apiKeys: ["claude"],
  actions: ["makeRequest", "formatInteractionFromResponse", "getInteractionsFromExport"],
  inferenceModels: [
    { "id": "claude-opus-4-20250514", "name": "Claude Opus 4", "family": "claude-4", "releaseDate": "2025-05-22T00:00:00Z", "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "web-search", "file-upload", "streaming"], "inputTypes": ["text", "image", "document"], "outputTypes": ["text", "code"], "bestFor": ["complex-reasoning", "code-generation", "document-analysis", "creative-writing", "science"], "contextWindow": 200000, "maxOutput": 32000, "pricing": { "input": 150, "output": 750 }, "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 20000, "requestsPerDay": 72000 } },
    { "id": "claude-sonnet-4-20250514", "name": "Claude Sonnet 4", "family": "claude-4", "releaseDate": "2025-05-22T00:00:00Z", "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "web-search", "file-upload", "streaming"], "inputTypes": ["text", "image", "document"], "outputTypes": ["text", "code"], "bestFor": ["conversation", "code-generation", "document-analysis", "complex-reasoning"], "contextWindow": 200000, "maxOutput": 64000, "pricing": { "input": 30, "output": 150 }, "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 40000, "requestsPerDay": 72000 } },
    { "id": "claude-3-7-sonnet-20250219", "name": "Claude Sonnet 3.7", "family": "claude-3-7", "releaseDate": "2025-02-24T00:00:00Z", "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"], "inputTypes": ["text", "image", "document"], "outputTypes": ["text", "code"], "bestFor": ["complex-reasoning", "code-generation", "document-analysis", "math", "science"], "contextWindow": 200000, "maxOutput": 64000, "pricing": { "input": 30, "output": 150 }, "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 40000, "requestsPerDay": 72000 } },
    { "id": "claude-3-5-sonnet-20241022", "name": "Claude Sonnet 3.5 (New)", "family": "claude-3-5", "releaseDate": "2024-10-22T00:00:00Z", "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"], "inputTypes": ["text", "image", "document"], "outputTypes": ["text", "code"], "bestFor": ["conversation", "code-generation", "document-analysis", "complex-reasoning"], "contextWindow": 200000, "maxOutput": 4096, "pricing": { "input": 30, "output": 150 }, "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 40000, "requestsPerDay": 72000 } },
    { "id": "claude-3-5-haiku-20241022", "name": "Claude Haiku 3.5", "family": "claude-3-5", "releaseDate": "2024-10-22T00:00:00Z", "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"], "inputTypes": ["text", "image", "document"], "outputTypes": ["text", "code"], "bestFor": ["conversation", "summarization", "code-generation", "translation"], "contextWindow": 200000, "maxOutput": 8192, "pricing": { "input": 8, "output": 40 }, "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 50000, "requestsPerDay": 72000 } },
    { "id": "claude-3-5-sonnet-20240620", "name": "Claude Sonnet 3.5 (Old)", "family": "claude-3-5", "releaseDate": "2024-06-20T00:00:00Z", "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"], "inputTypes": ["text", "image", "document"], "outputTypes": ["text", "code"], "bestFor": ["conversation", "code-generation", "document-analysis", "creative-writing"], "contextWindow": 200000, "maxOutput": 8192, "pricing": { "input": 30, "output": 150 }, "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 40000, "requestsPerDay": 72000 } },
    { "id": "claude-3-haiku-20240307", "name": "Claude Haiku 3", "family": "claude-3", "releaseDate": "2024-03-07T00:00:00Z", "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"], "inputTypes": ["text", "image", "document"], "outputTypes": ["text", "code"], "bestFor": ["conversation", "summarization", "translation", "document-analysis"], "contextWindow": 200000, "maxOutput": 4096, "pricing": { "input": 3, "output": 13 }, "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 50000, "requestsPerDay": 72000 } },
    { "id": "claude-3-opus-20240229", "name": "Claude Opus 3", "family": "claude-3", "releaseDate": "2024-02-29T00:00:00Z", "capabilities": ["text", "vision", "function-calling", "code", "reasoning", "file-upload", "streaming"], "inputTypes": ["text", "image", "document"], "outputTypes": ["text", "code"], "bestFor": ["complex-reasoning", "creative-writing", "document-analysis", "math", "science"], "contextWindow": 200000, "maxOutput": 4096, "pricing": { "input": 150, "output": 750 }, "rateLimits": { "requestsPerMinute": 50, "tokensPerMinute": 20000, "requestsPerDay": 72000 } }
  ],
  defaultModel: "claude-3-5-sonnet-20241022",
};

let runtime, apiKey;
export const initialize = async (rt) => {
  runtime = rt;
  apiKey = await runtime.call("api-keys.getKey",  manifest.apiKeys[0]);
};

export const makeRequest = async (model, messages, webSearch) => {
  const systemMessage = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const body = {
    model: model.id,
    max_tokens: 4096,
    ...(systemMessage && { system: systemMessage.content }),
    messages: chatMessages,
    // stream: true,
  };
  if (webSearch) body.tools = (body.tools ?? []).concat(addWebSearchTool(webSearch));
  const request = { method: 'POST', headers: buildHeaders(), body: JSON.stringify(body) }
  return await fetch('https://api.anthropic.com/v1/messages', request);
};
export const getContent = async (response) => {
  const data = JSON.parse(await response.text());
  console.log("[claude]", data);
  // With tool use, there can be multiple text blocks - concatenate ALL of them
  const textBlocks = data.content
    .filter(block => block.type === 'text')
    .map(block => block.text);
  
  // Join all text blocks to get the complete response
  return textBlocks.join('');
};
const addWebSearchTool = (webSearch) => ({ "type": "web_search_20250305", "name": "web_search", "max_uses": webSearch.max_uses || null, "allowed_domains": webSearch.allowed_domains || null, ...(webSearch.options ?? {})})
const buildHeaders = () => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' });

export const formatInteractionFromResponse = async (response) => {
  // const conversations = await getConversations();
  // const interactions = [];
  
  // conversations.forEach(conv => {
  //   const pairs = extractMessagePairs(conv.chat_messages);
  //   pairs.forEach(pair => {
  //     interactions.push({
  //       id: `${pair.humanMessageId}-${pair.assistantMessageId}`,
  //       userPrompt: pair.userPrompt,
  //       aiResponse: pair.aiResponse,
  //       model: 'claude-conversation-export',
  //       source: 'claude',
  //       timestamp: pair.timestamp,
  //       conversationId: conv.uuid,
  //       conversationName: conv.name
  //     });
  //   });
  // });
  
  // return interactions;
};

export const getInteractionsFromExport = async (exportData) => {}