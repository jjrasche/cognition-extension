export const manifest = {
	name: "context",
	context: ["service-worker"],
	version: "1.0.0",
	description: "Packages current state and available actions for LLM consumption",
	permissions: ["storage"],
	actions: ["assemble"],
};

let runtime, log;
export const initialize = async (rt, l) => { runtime = rt; log = l; }

export const assemble = async (query, systemPrompt = defaultSystemPrompt) => {
	const conversationHistory = buildConversationHistory([]);
	return [{ role: 'system', content: systemPrompt }, ...conversationHistory, { role: 'user', content: query }];
};

const buildConversationHistory = (similarInteractions = []) => similarInteractions
	.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
	.flatMap(interaction => [{ role: 'user', content: interaction.userPrompt }, { role: 'assistant', content: interaction.response }]);

const defaultSystemPrompt = "You are Cognition, an AI assistant with access to the user's data and capabilities.";