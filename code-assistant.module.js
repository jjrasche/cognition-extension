export const manifest = {
	name: "code-assistant",
	context: ["extension-page"],
	version: "1.0.0",
	description: "AI-powered code generation and debugging with context-aware LLM integration",
	dependencies: ["file", "inference", "layout", "chrome-sync"],
	requiredDirectories: ["cognition-extension"],
	actions: ["debugMode", "requirementsMode", "refineRequirements", "updatePurpose", "clearRequirements", "startImplementation", "applyChanges"],
	uiComponents: [
		{ name: "code-diff-viewer", getTree: "buildDiffViewer" },
		{ name: "context-panel", getTree: "buildContextPanel" },
		{ name: "requirements-ui", getTree: "buildRequirementsUI" },
	],
	config: {
		requirementsKey: { type: 'globalKey', value: 'Alt+Shift+R', label: 'Open Requirements', action: "requirementsMode" }
	}
};

let runtime, log, currentContext, currentChanges, currentIteration, currentRequirements;
const model = "meta-llama/llama-4-scout-17b-16e-instruct";
export const initialize = async (rt, l) => {
	runtime = rt; log = l;
	currentRequirements = await runtime.call('chrome-sync.get', 'code-assistant.requirements') || defaultRequirements;
};

const extractFilesFromStackTrace = (errorLog) => [...new Set([...errorLog.matchAll(/chrome-extension:\/\/[a-z0-9]+\/([a-zA-Z0-9._-]+\.js)/g)].map((m) => m[1]))];
const loadContextFiles = async (filePaths) => Object.fromEntries(await Promise.all(filePaths.map(async (filename) => [filename, await fetch(chrome.runtime.getURL(filename)).then((r) => r.text()).catch((e) => (log.error(`Failed to load ${filename}:`, e), ""))])));
// === DEBUG MODE ORCHESTRATOR ===
export const debugMode = async (errorLog) => {
	const filePaths = extractFilesFromStackTrace(errorLog);
	if (filePaths.length === 0) throw new Error("No files found in stack trace");
	const files = await loadContextFiles(filePaths);
	currentContext = { mode: "debug", error: errorLog, files, coreContext: getCoreContext() };
	currentChanges = await generateChanges(currentContext, "debug");
	await runtime.call("layout.addComponent", "code-diff-viewer");
	return { context: currentContext, changes: currentChanges };
};
// === REQUIREMENTS MODE ===
export const requirementsMode = async () => await runtime.call("layout.addComponent", "requirements-ui", { width: 100, height: 100, isMaximized: true });
const refreshRequirementsUI = () => runtime.call('layout.renderComponent', 'requirements-ui');
export const buildRequirementsUI = () => ({
	"requirements-ui": {
		tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; gap: 15px;",
		"header": { tag: "h2", text: "Requirements Mode", style: "margin: 0;" },
		"purpose-section": {
			tag: "div", style: "display: flex; flex-direction: column; gap: 8px;",
			"purpose-label": { tag: "label", text: "Purpose:", style: "font-weight: 500;" },
			"purpose-field": { tag: "textarea", class: "cognition-input", value: currentRequirements.purpose || '', placeholder: "What should this feature do?", style: "padding: 12px; border: 1px solid var(--border-primary); border-radius: 4px; min-height: 80px; resize: vertical; background: var(--bg-input);", events: { change: "code-assistant.updatePurpose" } }
		},
		"requirements-section": {
			tag: "div", style: "flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0;",
			"requirements-label": { tag: "label", text: `User Stories (${currentRequirements.userStories?.length || 0}):`, style: "font-weight: 500;" },
			"requirements-list": buildUserStories()
		},
		"refinement-section": {
			tag: "div",
			style: "display: flex; flex-direction: column; gap: 8px;",
			"refinement-label": { tag: "label", text: "Refine requirements (Shift+Enter):", style: "font-weight: 500;" },
			"refinement-input": { tag: "textarea", class: "cognition-input", placeholder: "Add details, ask questions, or refine existing requirements...", style: "padding: 12px; border: 1px solid var(--border-primary); border-radius: 4px; min-height: 100px; resize: vertical; background: var(--bg-input);", events: { keydown: "code-assistant.refineRequirements" } }
		},
		"actions": {
			tag: "div", style: "display: flex; gap: 10px;",
			"refine-btn": { tag: "button", text: "Refine with AI", class: "cognition-button-primary", events: { click: "code-assistant.refineRequirements" } },
			"clear-btn": { tag: "button", text: "Clear", class: "cognition-button-secondary", events: { click: "code-assistant.clearRequirements" } }
		}
	}
});
const buildUserStories = () => currentRequirements.userStories?.length ? userStoriesUI() : noStoriesMessage();
const noStoriesMessage = () => ({ "empty-state": { tag: "div", text: "No requirements yet. Start by describing what you want to build...", style: "color: var(--text-muted); padding: 20px; text-align: center;" } });
const userStoriesUI = () => ({
	"stories-container": {
		tag: "div", style: "flex: 1; overflow-y: auto; border: 1px solid var(--border-primary); border-radius: 4px; padding: 10px; background: var(--bg-secondary);",
		...Object.fromEntries(currentRequirements.userStories.map((story, i) => [`story-${i}`, { tag: "div", style: "padding: 8px; margin-bottom: 8px; background: var(--bg-tertiary); border-radius: 4px; border-left: 3px solid var(--accent-primary);", text: story }]))
	}
});
const defaultRequirements = { purpose: "", userStories: [] };
export const updatePurpose = async (eventData) => {
	currentRequirements.purpose = eventData.target.value;
	await runtime.call('chrome-sync.set', { 'code-assistant.requirements': currentRequirements });
}
export const clearRequirements = async () => {
	currentRequirements = defaultRequirements;
	await runtime.call('chrome-sync.remove', 'code-assistant.requirements');
	await refreshRequirementsUI();
};
export const refineRequirements = async (eventData) => {
	if (eventData.key !== 'Enter' || !eventData.shiftKey) return;
	const userInput = eventData.target.value.trim();
	if (!userInput) return;
	eventData.preventDefault();
	eventData.target.value = '';
	try {
		const llmResponse = await callRequirementsLLM(assembleRequirementsPrompt(userInput), model, getRequirementsSystemPrompt());
		const response = JSON.parse(llmResponse);
		currentRequirements = response;
		await refreshRequirementsUI();
		await runtime.call('chrome-sync.set', { 'code-assistant.requirements': currentRequirements });
	} catch (error) { log.error("Requirements refinement failed:", error); }
};

const callRequirementsLLM = async (query, model, systemPrompt) => await runtime.call("inference.prompt", { query, model, systemPrompt, responseFormat: { type: "json_schema", json_schema: { name: "requirements_response", strict: true, schema: getRequirementsResponseSchema() } } });
const assembleRequirementsPrompt = (userInput) => `Current Requirements:\nPurpose: ${currentRequirements.purpose || 'Not defined'}\nUser Stories: ${JSON.stringify(currentRequirements.userStories || [])}\n\nUser Input: ${userInput}\n\nUpdate the requirements based on this input. Add, refine, or clarify user stories.`;
const getRequirementsSystemPrompt = () => `You are a requirements analyst for a Chrome extension project.\n\nYour goal: Help users articulate clear, actionable requirements as user stories.\n\nRules:\n- Ask clarifying questions when needed\n- Break vague requests into specific user stories\n- Use format: "As a user, I want to... so that..."\n- Keep stories small and testable\n- Update purpose if user provides new context\n- Return valid JSON only`;
const getRequirementsResponseSchema = () => ({ type: "object", required: ["purpose", "userStories"], additionalProperties: false, properties: { purpose: { type: "string" }, userStories: { type: "array", items: { type: "string" } } } });

// === IMPLEMENTATION MODE ===
export const buildMode = async (requirements) => ({}); // Build mode: takes requirements, gathers target context with LLM-selected examples, generates new code implementations
// === CHANGE FILES ===
export const applyChanges = async () => !currentChanges?.changes ? (log.error("No changes to apply"), false)
	: Promise.all(currentChanges.changes.map(applyFileChange)).then(onApply).catch((error) => (log.error("Failed to apply changes:", error), false));
const applyFileChange = async ({ filePath, functionName, newCode }) => await replaceFunctionInFile(filePath, functionName, newCode);
const onApply = async () => { log.log("✅ All changes applied successfully"); runtime.call("layout.removeComponent", "code-diff-viewer"); return true; };
const replaceFunctionInFile = async (filePath, functionName, newImplementation) => {
	const currentContent = await runtime.call("file.read", { dir: "cognition-extension", filename: filePath });
	const match = getFunction(functionName, currentContent);
	const startPos = match.index, endPos = getFunctionEndPosition(match, startPos, currentContent);
	const newContent = currentContent.slice(0, startPos) + newImplementation + currentContent.slice(endPos);
	await runtime.call("file.write", { dir: "cognition-extension", filename: filePath, data: newContent });
	log.log(`✅ Replaced ${functionName} in ${filePath}`);
};
const getFunction = (functionName, fileContent) => (new RegExp(`(export\\s+const\\s+${functionName}\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>\\s*{)`, "g")).exec(fileContent) ?? (() => { throw new Error(`Function ${functionName} not found`); })();
const getFunctionEndPosition = (match, startPos, fileContent) => {
	let depth = 0, pos = startPos + match[0].length;
	for (; pos < fileContent.length; pos++) {
		if (fileContent[pos] === "{") depth++;
		if (fileContent[pos] === "}" && depth-- === 0) return pos + 1;
	}
	return pos;
};
// === LLM INTEGRATION ===
const generateChanges = async (context, mode) => {
	try {
		const llmResponse = await runtime.call("inference.prompt", {
			query: assemblePrompt(context, mode),
			model,
			systemPrompt: getSystemPrompt(mode),
			responseFormat: { type: "json_schema", json_schema: { name: `${mode}_fix_response`, strict: true, schema: getResponseSchema(mode), }, },
		});
		return JSON.parse(llmResponse);
	} catch (error) {
		log.error("LLM call failed:", error);
		return { changes: [], reasoning: `Failed to generate changes: ${error.message}` };
	}
};
const getResponseSchema = (mode) => (mode === "debug" ? getDebugResponseSchema() : getBuildResponseSchema());
const getBuildResponseSchema = () => ({
	type: "object", required: ["changes", "reasoning"], additionalProperties: false,
	properties: {
		changes: {
			type: "array",
			items: {
				type: "object",
				properties: { filePath: { type: "string" }, functionName: { type: "string" }, newCode: { type: "string" } },
				required: ["filePath", "functionName", "newCode"],
				additionalProperties: false,
			},
		},
		reasoning: { type: "string" },
		testCases: { type: "array", items: { type: "string" } },
	}
});
const getDebugResponseSchema = () => ({
	type: "object", required: ["changes", "reasoning"], additionalProperties: false,
	properties: {
		changes: {
			type: "array",
			items: {
				type: "object",
				properties: { filePath: { type: "string" }, functionName: { type: "string" }, newCode: { type: "string" } },
				required: ["filePath", "functionName", "newCode"],
				additionalProperties: false,
			},
		},
		reasoning: { type: "string" },
	}
});
// todo: simplify prompt - no need for JSON format instructions
const assembleDebugPrompt = (context) => {
	const { error, files, coreContext } = context;

	// Simplified - no need for JSON format instructions
	return `# DEBUG MODE: Fix Runtime Error

## Error Log
\`\`\`
${error}
\`\`\`

## File Content
${Object.entries(files)
			.map(
				([path, content]) => `
### ${path}
\`\`\`javascript
${content}
\`\`\`
`
			)
			.join("\n")}

## System Architecture Context
${JSON.stringify(coreContext.systemArchitecture, null, 2)}

## Common Patterns
${JSON.stringify(coreContext.moduleBuildPatterns, null, 2)}

## Runtime Call Examples
${JSON.stringify(coreContext.runtimeCallExamples, null, 2)}

## Instructions
1. Identify the root cause of the error
2. Generate a MINIMAL fix (change only what's necessary)
3. Use safe references from class instance (this.property) instead of global references
4. Preserve all existing logic and structure
5. Return complete replacement function code with proper formatting`;
};

const assemblePrompt = (context, mode) => {
	if (mode === "debug") {
		return assembleDebugPrompt(context);
	}
	return assembleBuildPrompt(context);
};

const assembleBuildPrompt = (context) => {
	// TODO: Implement for build mode
	return `Build mode not yet implemented`;
};

// todo simplify
const getSystemPrompt = (mode) => {
	if (mode === "debug") {
		return `You are a debugging assistant for a Chrome extension with a modular architecture. 

Your goal: Generate MINIMAL fixes that resolve errors while preserving existing code structure.

Rules:
- Change ONLY the code necessary to fix the error
- Use instance properties (this.contextModules) not global variables (modules)
- Preserve all existing function logic and structure
- Return complete function replacement code
- Response must be valid JSON only`;
	}

	return `You are a code generation assistant for a Chrome extension with a modular architecture.

Your goal: Generate complete, working implementations following established patterns.

Rules:
- Follow the manifest schema exactly
- Use runtime.call() for cross-module communication
- Include proper error handling
- Write complete, production-ready code
- Return valid JSON only`;
};


// === FILE OPERATIONS ===
// Maps chrome-extension:// URLs and webpack bundle references back to actual source file paths
const mapExtensionPathsToSource = (extensionPaths) => [];
// === UI COMPONENTS ===
export const buildDiffViewer = () => !currentChanges?.changes?.length ? noChangesMessage() : buildDiffViewerTree();
const buildDiffViewerTree = () => {
	const change = currentChanges.changes[0];
	const oldCode = currentContext?.files?.[change.filePath] || "";
	return {
		"diff-viewer": {
			tag: "div", style: "display: flex; flex-direction: column; height: 100%; padding: 20px; gap: 15px;",
			header: buildChangeHeader(change),
			reasoning: buildReasoning(),
			"diff-grid": buildDiffGrid(change, oldCode)
		}
	};
}
const buildChangeHeader = (change) => ({
	tag: "div", style: "display: flex; justify-content: space-between; align-items: center;",
	title: { tag: "h3", text: `Fix for ${change.filePath} → ${change.functionName}`, style: "margin: 0;" },
	"apply-btn": { tag: "button", text: "Apply Changes", class: "cognition-button-primary", events: { click: "code-assistant.applyChanges" } },
});
const buildReasoning = () => ({ tag: "div", style: "padding: 10px; background: var(--bg-tertiary); border-radius: 4px; font-size: 14px;", text: currentChanges.reasoning });
const buildDiffPane = (code, bgColor) => ({ tag: "pre", style: `margin: 0; padding: 15px; background: ${bgColor}; border: 1px solid ${bgColor}33; border-radius: 4px; overflow: auto; font-size: 12px; font-family: monospace;`, text: code });
const buildDiffGrid = (change, oldCode) => ({ tag: "div", style: "display: grid; grid-template-columns: 1fr 1fr; gap: 10px; flex: 1; min-height: 0;", before: buildDiffPane(oldCode, "#2d0000"), after: buildDiffPane(change.newCode, "#002d00") });
const noChangesMessage = () => ({ "no-changes": { tag: "div", style: "padding: 20px; text-align: center; color: var(--text-muted);", text: "No changes to display. Run debugMode(errorLog) first." } });
// Renders collapsible context panel showing what context was sent to LLM, organized by mode
export const buildContextPanel = () => ({});

// Helper for building expandable context sections with toggle functionality and mode-specific styling
const buildContextSection = (title, content, isExpanded, mode) => ({});

// === EVENT HANDLERS ===
// Toggles expansion state of context panel sections
export const toggleContextSection = async (eventData) => ({});

// Handles user modifications in diff viewer - tracks changes for training pipeline
export const handleDiffModification = async (eventData) => ({});

// todo: stil determining pattern
// === TRAINING INTEGRATION ===
// todo: tune this
// === CORE CONTEXT ASSEMBLY ===
const getCoreContext = () => ({
	systemArchitecture: getSystemArchitecture(),
	moduleBuildPatterns: getModuleBuildPatterns(),
	runtimeCallExamples: getRuntimeCallExamples(),
	manifestSchema: getManifestSchema(),
	moduleSummary: getModuleSummary(),
});
const getSystemArchitecture = () => ({
	contexts: { "service-worker": "Main context - background tasks, API calls, no UI access", "extension-page": "UI context - components, user interaction, DOM access", "offscreen": "Heavy compute - ML models, embeddings, isolated processing" },
	communication: { pattern: "runtime.call(action, ...args)", routing: "Auto-routes across contexts via Chrome message passing", actions: "Format: 'moduleName.actionName'", waiting: "Modules wait for dependencies during initialization", },
	storage: { "chrome-local": "Local device storage - fast, not synced", "chrome-sync": "Synced across devices - smaller limits", "indexed-db": "Large data storage with queries" },
	errorHandling: { moduleFailure: "Modules marked 'failed', others continue", crossContext: "Automatic retry with timeout handling", gracefulDegradation: "Extension remains functional with partial failures", },
});
const getModuleBuildPatterns = () => ({
	manifest: { required: ["name", "version", "description"], optional: ["context", "dependencies", "actions", "uiComponents", "config"], context: "Array of contexts where module runs", dependencies: "Other modules this one requires" },
	initialization: { pattern: "export const initialize = async (runtime, log) => { ... }", order: "Dependencies initialized first", state: "Runtime tracks module states: loading → ready/failed" },
	actions: { export: "export const actionName = async (params) => { ... }", registration: "Automatic from manifest.actions array", calling: "await runtime.call('moduleName.actionName', params)" },
	testing: { pattern: "export const test = async () => [testResults]", utilities: "runtime.testUtils provides assertions", structure: "Array of {name, actual, assert, expected, passed}" },
	uiComponents: { pattern: "Tree structures transformed by tree-to-dom", events: "{ events: { click: 'moduleName.actionName' } }", state: "Component state managed by modules" },
});
const getRuntimeCallExamples = () => [
	{ purpose: "Cross-context communication", example: "await runtime.call('groq-inference.makeRequest', model, messages)", note: "Auto-routes from extension-page to service-worker" },
	{ purpose: "Storage operations", example: "await runtime.call('chrome-sync.set', { key: value })", note: "Consistent API across storage types" },
	{ purpose: "UI updates", example: "await runtime.call('layout.renderComponent', 'componentName')", note: "Only works in extension-page context" },
	{ purpose: "File operations", example: "await runtime.call('file.write', { dir: 'Documents', filename: 'test.txt', data: content })", note: "Requires user permission grants" },
	{ purpose: "Error handling", example: "try { await runtime.call('action') } catch (e) { log.error('Failed:', e) }", note: "Always wrap cross-context calls in try-catch" },
];
const getManifestSchema = () => ({
	type: "object",
	required: ["name", "version", "description"],
	properties: {
		name: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
		context: { type: "array", items: { enum: ["service-worker", "extension-page", "offscreen"] } },
		version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+$" },
		description: { type: "string", minLength: 10 },
		dependencies: { type: "array", items: { type: "string" }, description: "Other module names this depends on" },
		actions: { type: "array", items: { type: "string" }, description: "Function names to expose as actions" },
		uiComponents: {
			type: "array",
			items: {
				type: "object",
				required: ["name", "getTree"],
				properties: {
					name: { type: "string" },
					getTree: { type: "string", description: "Function name that returns UI tree" },
					zLayer: { enum: ["SYSTEM", "PINNED", "ACTIVE", "NORMAL"] },
				},
			},
		},
		config: {
			type: "object",
			patternProperties: {
				".*": {
					type: "object",
					required: ["type", "value"],
					properties: {
						type: { enum: ["string", "number", "boolean", "select", "globalKey"] }, value: {}, label: { type: "string" }, description: { type: "string" },
					},
				},
			},
		},
	},
});
const getModuleSummary = () => {
	if (!runtime) return {};
	return runtime.getContextModules().reduce((summary, module) => {
		summary[module.manifest.name] = {
			purpose: module.manifest.description,
			context: module.manifest.context || ["all"],
			dependencies: module.manifest.dependencies || [],
			actions: module.manifest.actions?.length || 0,
			hasUI: !!module.manifest.uiComponents?.length,
			hasConfig: !!(module.manifest.config && Object.keys(module.manifest.config).length),
			hasTests: typeof module.test === "function",
		};
		return summary;
	}, {});
};
// testing
export const test = async () => {
	const { runUnitTest, deepEqual } = runtime.testUtils;
	return [
		// await runUnitTest("LLM Architecture Comprehension", async () => {
		//     const results = await testArchitectureComprehension();
		// 	return { actual: results.filter(r => r.passed).length, assert: greaterThanOrEqual, expected: (results.length - 1) };
		// }),
		// // Stack Trace Extraction Tests - Extension Specific
		// await runUnitTest("Stack trace extraction handles chrome-extension:// URLs correctly", async () => true),
		// await runUnitTest("Stack trace extraction handles webpack bundle references", async () => true),
		// await runUnitTest("Stack trace extraction handles source map redirects", async () => true),
		// await runUnitTest("Stack trace extraction handles cross-context errors (service-worker → extension-page)", async () => true),
		// await runUnitTest("Stack trace extraction handles missing files gracefully", async () => true),
		// await runUnitTest("Extension path mapping converts chrome-extension URLs to source paths", async () => true),

		// // Context Assembly Tests
		// await runUnitTest("Core context includes architecture, patterns, examples, and module summary", async () => true),
		// await runUnitTest("Debug context focuses on error context and minimal fixes", async () => true),
		// await runUnitTest("Build context focuses on example modules and complete implementations", async () => true),
		// await runUnitTest("Requirements gathering suggests relevant existing modules for context", async () => true),
		// await runUnitTest("LLM-powered module selection returns contextually relevant examples", async () => true),

		// // Mode Distinction Tests
		// await runUnitTest("Debug mode system prompt focuses on minimal fixes and error resolution", async () => true),
		// await runUnitTest("Build mode system prompt focuses on complete implementations and best practices", async () => true),
		// await runUnitTest("Debug mode validation expects minimal, targeted changes", async () => true),
		// await runUnitTest("Build mode validation expects complete, functional implementations", async () => true),
		// await runUnitTest("Mode-specific response parsing applies different validation rules", async () => true),
		// await runUnitTest("Debug mode generates valid fix for real runtime error", async () => true),
		// // LLM Integration Tests - Single Calls
		// await runUnitTest("Debug mode LLM call returns valid function-level fixes", async () => true),
		// await runUnitTest("Build mode LLM call returns valid function-level implementations", async () => true),
		// await runUnitTest("LLM response parsing handles malformed JSON without crashing", async () => true),
		// await runUnitTest("Prompt assembly creates structured prompt with mode-specific context sections", async () => true),

		// // LLM Consistency Tests - Multiple Calls
		// await runUnitTest("Same debug context produces consistent LLM responses (5 calls)", async () => true),
		// await runUnitTest("Same build context produces consistent LLM responses (5 calls)", async () => true),
		// await runUnitTest("Different error logs produce different debug responses (3 calls)", async () => true),
		// await runUnitTest("Different requirements produce different build responses (3 calls)", async () => true),

		// // File Operations Tests
		// await runUnitTest("File loading handles missing files gracefully", async () => true),
		// await runUnitTest("Function replacement preserves file structure and formatting", async () => true),
		// await runUnitTest("Function boundary detection works with various coding styles", async () => true),
		// await runUnitTest("Multiple changes are applied in dependency order", async () => true),

		// // Training Pipeline Tests
		// await runUnitTest("Iteration records include context + output + mode + metadata", async () => true),
		// await runUnitTest("User modifications in diff viewer are captured for training", async () => true),
		// await runUnitTest("Training data includes mode-specific validation results", async () => true),
		// await runUnitTest("Multiple iterations create separate training records with progression tracking", async () => true)
	];
};

const testArchitectureComprehension = async () => {
	return await Promise.all([
		{ concept: "cross-context-communication", question: "How do modules communicate across different contexts (service-worker, extension-page, offscreen)?", options: ["A: Direct function calls", "B: runtime.call() with action routing", "C: Chrome message passing directly", "D: Shared global variables"], correct: "B" },
		{ concept: "module-design-patterns", question: "When should you create a NEW module vs extending an existing one?", options: ["A: Always create new modules", "B: For distinct features with own state/actions", "C: Only when file gets too large", "D: Never create new modules"], correct: "B" },
		{ concept: "context-restrictions", question: "Which context can render UI components?", options: ["A: service-worker only", "B: extension-page only", "C: offscreen only", "D: Any context"], correct: "B" },
		{ concept: "action-routing", question: "What happens when runtime.call() targets an action in a different context?", options: ["A: Throws an error immediately", "B: Auto-routes via message passing", "C: Times out silently", "D: Falls back to local execution"], correct: "B" },
		{ concept: "dependency-management", question: "How are module dependencies handled during initialization?", options: ["A: Parallel initialization", "B: Dependency order with waiting", "C: Manual dependency management", "D: Random initialization order"], correct: "B" },
		{ concept: "storage-architecture", question: "What's the difference between chrome-local and chrome-sync modules?", options: ["A: No difference, same API", "B: Local is faster, sync persists across devices", "C: Local is temporary, sync is permanent", "D: Local is for settings, sync for data"], correct: "B" },
		{ concept: "ui-architecture", question: "How should UI components be structured in this architecture?", options: ["A: Direct DOM manipulation", "B: Tree structures transformed by tree-to-dom", "C: React components only", "D: HTML templates"], correct: "B" },
		{ concept: "error-resilience", question: "What happens if a module fails to initialize?", options: ["A: Entire extension crashes", "B: Module marked as 'failed', others continue", "C: Automatic retry until success", "D: Silent failure"], correct: "B" },
	].map(async (q) => questionLLM(q)));
};
const questionLLM = async (q) => {
	try {
		const prompt = `Given this system architecture context:\n${JSON.stringify(getCoreContext(), null, 2)}\nAnswer this multiple choice question:\n${q.question}\n${q.options.join("\n")}.\nRespond with ONLY the letter (A, B, C, or D) of the correct answer.`;
		const llmAnswer = (await runtime.call("inference.prompt", { query: prompt })).trim().toUpperCase();
		const isCorrect = llmAnswer === q.correct;
		return { concept: q.concept, question: q.question, correctAnswer: q.correct, llmAnswer: llmAnswer, passed: isCorrect, explanation: isCorrect ? "✅ Correct" : `❌ Expected ${q.correct}, got ${llmAnswer}` };
	} catch (error) { return { concept: q.concept, passed: false, error: error.message }; }
};
