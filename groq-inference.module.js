export const manifest = {
  name: "groq-inference",
  version: "1.0.0",
  dependencies: ["api-keys"],
  apiKeys: ["groq"],
  actions: ["makeRequest", "formatInteractionFromResponse", "getInteractionsFromExport"],
  inferenceModels: [
    { "id": "llama-3.1-8b-instant", "name": "Llama 3.1 8B Instant", "family": "llama-3.1", "developer": "Meta", "releaseDate": "2024-07-23", "capabilities": ["text generation", "reasoning", "tool use", "structured output"], "inputTypes": ["text"], "outputTypes": ["text"], "bestFor": ["real-time content moderation", "interactive dialogue", "summarization", "data analysis"], "contextWindow": 131072, "maxOutput": 131072, "maxFileSize": null, "pricing": { "input": 0.05, "output": 0.08 }, "rateLimits": { "requestsPerMinute": null, "tokensPerMinute": null, "requestsPerDay": null } },
    { "id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B Versatile", "family": "llama-3.3", "developer": "Meta", "releaseDate": "2024-12-06", "capabilities": ["text generation", "reasoning", "code generation", "multilingual understanding"], "inputTypes": ["text"], "outputTypes": ["text"], "bestFor": ["multilingual understanding", "code completion", "complex reasoning", "mathematical problem solving"], "contextWindow": 131072, "maxOutput": 32768, "maxFileSize": null, "pricing": { "input": 0.59, "output": 0.79 }, "rateLimits": { "requestsPerMinute": null, "tokensPerMinute": null, "requestsPerDay": null } },
    { "id": "meta-llama/llama-guard-4-12b", "name": "Llama Guard 4 12B", "family": "llama-guard-4", "developer": "Meta", "releaseDate": "2025-04-05", "capabilities": ["content moderation", "safety classification", "structured output"], "inputTypes": ["text", "image"], "outputTypes": ["text"], "bestFor": ["multimodal content filtering", "safety analysis"], "contextWindow": 131072, "maxOutput": 1024, "maxFileSize": 20971520, "pricing": { "input": 0.20, "output": 0.20 }, "rateLimits": { "requestsPerMinute": null, "tokensPerMinute": null, "requestsPerDay": null } },
    { "id": "whisper-large-v3", "name": "Whisper Large v3", "family": "whisper-large", "developer": "OpenAI", "releaseDate": "2023-11-08", "capabilities": ["speech-to-text"], "inputTypes": ["audio"], "outputTypes": ["text"], "bestFor": ["high-accuracy transcription", "multilingual ASR"], "contextWindow": null, "maxOutput": null, "maxFileSize": 104857600, "pricing": { "input": 0.111, "output": 0.111 }, "rateLimits": { "requestsPerMinute": null, "tokensPerMinute": null, "requestsPerDay": null } },
    { "id": "whisper-large-v3-turbo", "name": "Whisper Large v3 Turbo", "family": "whisper-large", "developer": "OpenAI", "releaseDate": "2024-10-01", "capabilities": ["speech-to-text"], "inputTypes": ["audio"], "outputTypes": ["text"], "bestFor": ["real-time transcription", "low-latency speech recognition"], "contextWindow": null, "maxOutput": null, "maxFileSize": 104857600, "pricing": { "input": 0.04, "output": 0.04 }, "rateLimits": { "requestsPerMinute": null, "tokensPerMinute": null, "requestsPerDay": null } }
  ],
  defaultModel: "llama-3.1-8b-instant"
};

let runtime, apiKey;
export const initialize = async (rt) => {
  runtime = rt;
  apiKey = await runtime.call("api-keys.getKey",  manifest.apiKeys[0]);
};

export const makeRequest = async (prompt, model) => {
  const response = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt,
      temperature: 0.7, max_tokens: 1024, stream: false
    })
  });
  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Groq API error: ${response.status} - ${errorData}`);
  }
  const data = await response.json();
  return { content: data.choices[0]?.message?.content || 'No response', usage: data.usage };
};
export const formatInteractionFromResponse = async (response) => {};
export const getInteractionsFromExport = async (exportData) => {}