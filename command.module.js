export const manifest = {
	name: "command",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Universal command interface - single input that routes to inference, web search, graph search, and app actions",
	// dependencies: ["ui"],
	actions: ["handleCommandInput", "executeCommand", "getRegisteredActions"],
	uiComponents: [
		{ name: "command-input", getTree: "commandTree" }
	]
};

let runtime, commands = [], isExecuting = false;
export const initialize = async (rt) => {
	runtime = rt;
	await registercommands();
};

const registercommands = async () => runtime.getModulesWithProperty('commands').flatMap(m => m.manifest.commands.map(a => ({
	...a,
	func: async (input) => await runtime.call(`${m.manifest.name}.${a.method}`, input),
	condition: a.keyword ? (input) => input.toLowerCase() === a.keyword.toLowerCase() : a.condition,
	priority: a.keyword ? 1 : a.condition && a.condition.toString().includes("startsWith") ? 2 : 3,
	module: m.manifest.name
}))).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

export const handleCommandInput = async (event) => {
	if (event.key !== 'Enter' || !event.target.value.trim()) return;
	const input = event.target.value.trim();
	try { await executeCommand(input); }
	finally { await refreshUI(); }
};
export const getRegisteredActions = async () => commands;
export const executeCommand = async (input) => {
	const action = await getCommand(input);
	if (!action) throw new Error(`No command found for: ${input}`);
	runtime.log(`[Command] Executing: ${action.name} for "${input.substring(0, 30)}${input.length > 30 ? '...' : ''}"`);
	await refreshUI();
	return await action.func(input);
};
const getCommand = async (input) => {
	const matchingActions = commands.filter(a => a.condition(input));
	if (matchingActions.length > 0) {
		runtime.log(`[Command] Found ${matchingActions.length} matching actions:\n${matchingActions.map(a => `- ${a.name} (${a.module})`).join('\n')}`);
	}
	return matchingActions[0]; // Return highest priority match
};
// UI
export const commandTree = async () => ({ tag: "div", style: "display: flex; align-items: center; gap: 8px; flex: 1;", ...commandInput() });
const commandInput = () => ({ "command-input": { tag: "input", id: "cognition-search-input", type: "text", placeholder: "Search the web, ask questions, or type commands...", events: { keydown: "command.handleCommandInput" }, style: "flex: 1;", disabled: isExecuting } })
const refreshUI = async () => await runtime.call('layout.replaceComponent', 'command-input')

// testing
export const test = async () => {
	const { runUnitTest } = runtime.testUtils;
	return [
		await runUnitTest("Search input triggers search on Enter key", async () => {
			let searchQuery = null;
			const originalCall = runtime.call;
			runtime.call = async (action, ...args) => action === 'web-search.getSearchTree' && (searchQuery = args[0]);
			const testQuery = "test search";
			await handleCommandInput({ key: 'Enter', target: { value: testQuery } });
			runtime.call = originalCall;
			const actual = { searchTriggered: !!searchQuery, query: searchQuery };
			const expected = { searchTriggered: true, query: testQuery };
			return { actual, assert: runtime.testUtils.deepEqual, expected };
		})
	];
};