export const manifest = {
  name: "groq-inference",
  version: "1.0.0",
  dependencies: ["api-keys"],
  apiKeys: ["groq"],
  actions: ["makeRequest", "formatInteractionFromResponse", "getInteractionsFromExport"],
  inferenceModels: [

  ],
  defaultModel: "llama3-8b-8192"
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