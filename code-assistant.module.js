// code-assistant.module.js
import { wait } from "./helpers.js";
import { configProxy } from "./config.module.js";
export const manifest = {
	name: "code-assistant",
	context: ["extension-page"],
	version: "1.0.0",
	description: "AI-powered development: spec → skeleton → TDD with voice-first spec building",
	dependencies: ["file", "inference", "layout", "chrome-sync", "web-speech-stt", "graph-db"],
	requiredDirectories: ["cognition-extension"],
	actions: ["startSpecMode", "stopListening", "acceptSpecChange", "rejectSpecChange", "markWrongTiming", "completeSpec", "toggleHistory", "startSkeletonMode", "completeSkeleton", "startDevelopment", "debugError", "applyChanges"],
	uiComponents: [
		{ name: "spec-builder", getTree: "buildSpecUI" },
		{ name: "skeleton-viewer", getTree: "buildSkeletonUI" },
		{ name: "dev-viewer", getTree: "buildDevUI" }
	],
	config: {
		historyAutoClose: { type: 'number', min: 5, max: 60, value: 15, label: 'History Auto-close (seconds)' },
		minTrainingRecords: { type: 'number', min: 10, max: 100, value: 30, label: 'Training records before auto-prediction' }
	}
};
const config = configProxy(manifest), model = "meta-llama/llama-4-scout-17b-16e-instruct";
let runtime, log, workflowState = { phase: 'idle', spec: null, skeleton: null };
let currentSpec = { what: '', why: '', architecture: { dependencies: [], persistence: 'none', context: [] } };
let pendingChanges = new Map(), transcriptHistory = [], isListening = false;
let lastSpeechTime = 0, lastSuggestion = null, historyVisible = false;
export const initialize = async (rt, l) => {
	runtime = rt; log = l;
}
// ============ SPEC MODE ============
export const startSpecMode = async () => {
	workflowState.phase = 'spec';
	currentSpec = { what: '', why: '', architecture: { dependencies: [], persistence: 'none', context: [] } };
	pendingChanges.clear();
	transcriptHistory = [];
	isListening = true;
	lastSpeechTime = Date.now();
	await runtime.call('web-speech-stt.startListening', handleTranscript);
	await runtime.call('layout.addComponent', 'spec-builder', { x: 0, y: 0, width: 100, height: 100, isMaximized: true });
};
const injectSpecSuggestion = async () => {
	lastSuggestion = await generateSpecSuggestion();
	pendingChanges.set(lastSuggestion.field, { current: currentSpec[lastSuggestion.field], proposed: lastSuggestion.content, type: lastSuggestion.type });
	await refreshSpecUI();
};
const generateSpecSuggestion = async () => {
	try {
		return JSON.parse(await runtime.call('inference.prompt', { query: `${JSON.stringify(currentSpec)}\n\n${transcriptHistory.slice(-10).map(t => t.text).join(' ')}`, model, systemPrompt: getSpecSystemPrompt(), structuredOutput: 'JSON' }));
	} catch (e) { log.error('Spec suggestion parse error:', e); return { type: 'modify', field: 'what', content: 'Error parsing AI response' }; }
};
const getSpecSystemPrompt = () => `You extract and refine software specifications from conversational transcripts.\n\nInput: JSON spec state + recent transcript text\nOutput: ONE suggestion as JSON: {"type": "modify|add|question", "field": "what|why|architecture", "content": "..."}\n\nRules:\n- Extract WHAT (feature/capability) and WHY (user need/goal) from natural speech\n- Suggest specific technical decisions when architecture is vague\n- Ask clarifying questions when requirements are unclear\n- Keep suggestions concise and actionable\n- Focus on WHAT and WHY before architectural HOW`;
export const acceptSpecChange = async (eventData) => { const field = eventData.target.dataset.field, change = pendingChanges.get(field); currentSpec[field] = change.proposed, pendingChanges.delete(field); await logSpecTraining('accepted', true), await refreshSpecUI(); };
export const rejectSpecChange = async (eventData) => { pendingChanges.delete(eventData.target.dataset.field); await logSpecTraining('rejected', null); await refreshSpecUI(); };
export const markWrongTiming = async () => { await logSpecTraining('ignored', false); pendingChanges.clear(); await refreshSpecUI(); };
const logSpecTraining = async (action, rightTiming) => { }
// lastSuggestion && await runtime.call('graph-db.addNode', {
// 	type: 'spec-training', aiResponse: lastSuggestion, userFeedback: { action, rightTiming },
// 	context: { specState: { ...currentSpec }, recentTranscript: transcriptHistory.slice(-5).map(t => t.text).join(' '), pauseDuration: Date.now() - lastSpeechTime },
// });
export const completeSpec = async () => {
	if (!currentSpec.what || !currentSpec.why) return;
	workflowState.phase = 'skeleton';
	workflowState.spec = { ...currentSpec };
	await runtime.call('web-speech-stt.stopListening');
	await runtime.call('layout.removeComponent', 'spec-builder');
	await startSkeletonMode();
};
export const stopListening = async () => (isListening = false, await runtime.call('web-speech-stt.stopListening'), await refreshSpecUI());
export const toggleHistory = async () => (historyVisible = !historyVisible, await refreshSpecUI());
const handleTranscript = async (transcriptData) => {
	transcriptHistory.push(transcriptData);
	if (transcriptData.isFinal) {
		lastSpeechTime = Date.now();
		if (/what do you think/i.test(transcriptData.text)) await injectSpecSuggestion();
	}
};
const refreshSpecUI = () => runtime.call('layout.renderComponent', 'spec-builder');
export const buildSpecUI = () => ({
	"spec-builder": {
		tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; gap: 15px;",
		"header": {
			tag: "div", style: "display: flex; justify-content: space-between; align-items: center;",
			"title": { tag: "h2", text: "Spec Mode", style: "margin: 0;" }, ...micBtn(), ...status()
		},
		"spec-display": { tag: "div", style: "flex: 1; display: flex; flex-direction: column; gap: 20px; overflow-y: auto;", ...buildSpecFields() },
		...(historyVisible && buildHistoryPanel()),
		"actions": { tag: "div", style: "display: flex; gap: 10px; padding-top: 15px; border-top: 1px solid var(--border-primary);", ...historyBtn(), ...completeBtn() }
	}
});
const micBtn = () => ({ "mic-btn": { tag: "button", text: isListening ? "⏸ Pause" : "🎤 Start", class: "cognition-button-primary", events: { click: isListening ? "code-assistant.stopListening" : "code-assistant.startSpecMode" } } });
const completeBtn = () => ({ "complete-btn": { tag: "button", text: "Complete Spec → Skeleton", class: "cognition-button-primary", events: { click: "code-assistant.completeSpec" }, disabled: !currentSpec.what || !currentSpec.why } });
const historyBtn = () => ({ "history-btn": { tag: "button", text: historyVisible ? "Hide History" : "Show History", class: "cognition-button-secondary", events: { click: "code-assistant.toggleHistory" } } });
const status = () => ({ "status": { tag: "div", text: isListening ? "🎤 Listening" : "⏸ Paused", style: `color: ${isListening ? '#4CAF50' : '#666'}; font-weight: 500;` } });
const buildSpecFields = () => Object.fromEntries(['what', 'why', 'architecture'].map(field => {
	const change = pendingChanges.get(field), value = field === 'architecture' ? JSON.stringify(currentSpec[field], null, 2) : currentSpec[field];
	return [`${field}-section`, {
		tag: "div", style: "padding: 15px; background: var(--bg-tertiary); border-radius: 8px;",
		"label": { tag: "h3", text: field.toUpperCase(), style: "margin: 0 0 10px 0; color: var(--text-primary);" },
		...(change ? {
			"diff": { tag: "div", "current": { tag: "div", text: change.current || '(empty)', style: "text-decoration: line-through; color: #ff6b6b; margin-bottom: 8px;" }, "proposed": { tag: "div", text: change.proposed, style: "background: #4CAF5020; color: #4CAF50; padding: 8px; border-radius: 4px;" } },
			"actions": { tag: "div", style: "display: flex; gap: 8px; margin-top: 12px;", ...acceptBtn(field), ...rejectBtn(field), ...wrongTimingBtn(field) }
		} : { "value": { tag: "pre", text: value || '(speak to fill this in)', style: "color: var(--text-primary); margin: 0; white-space: pre-wrap; font-family: inherit;" } })
	}];
}));
const acceptBtn = (field) => ({ "accept": { tag: "button", text: "✓ Accept", class: "cognition-button-primary", style: "padding: 6px 12px;", events: { click: "code-assistant.acceptSpecChange" }, "data-field": field, title: "Ctrl+Y" } });
const rejectBtn = (field) => ({ "reject": { tag: "button", text: "✗ Reject", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "code-assistant.rejectSpecChange" }, "data-field": field, title: "Ctrl+N" } });
const wrongTimingBtn = (field) => ({ "timing": { tag: "button", text: "⏰ Too Early", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "code-assistant.markWrongTiming" }, title: "Valid suggestion, wrong moment" } });
const buildHistoryPanel = () => ({ "history": { tag: "div", style: "flex: 0 0 200px; border-top: 1px solid var(--border-primary); padding-top: 15px; overflow-y: auto;", "history-title": { tag: "h4", text: "Transcript History", style: "margin: 0 0 10px 0;" }, "entries": { tag: "div", style: "font-size: 12px; color: var(--text-muted);", ...Object.fromEntries(transcriptHistory.slice(-20).map((t, i) => [`entry-${i}`, { tag: "div", text: `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.text}`, style: "margin-bottom: 4px;" }])) } } });
// ============ SKELETON MODE ============
export const startSkeletonMode = async () => { } //(workflowState.phase = 'skeleton', workflowState.skeleton = await generateSkeleton(workflowState.spec), await runtime.call('layout.addComponent', 'skeleton-viewer', { x: 0, y: 0, width: 100, height: 100, isMaximized: true }));
const getSkeletonSystemPrompt = () => `You generate module skeletons following this pattern:\n- manifest with name, actions, dependencies\n- Function signatures with clear parameter types\n- Test descriptions: "test name" → expected behavior\n- UI tree: nested objects with events`;
export const completeSkeleton = async () => (workflowState.phase = 'development', await runtime.call('layout.removeComponent', 'skeleton-viewer'), await startDevelopment());
export const buildSkeletonUI = () => ({ "skeleton-viewer": { tag: "div", style: "padding: 20px;", "skeleton-display": { tag: "pre", text: workflowState.skeleton || 'Generating...', style: "white-space: pre-wrap;" }, "complete-btn": { tag: "button", text: "Complete Skeleton → Development", class: "cognition-button-primary", events: { click: "code-assistant.completeSkeleton" } } } });
// ============ DEVELOPMENT MODE ============
export const startDevelopment = async () => (workflowState.phase = 'development', await runtime.call('layout.addComponent', 'dev-viewer'));
export const debugError = async (errorLog) => ({});
export const applyChanges = async () => ({});
export const buildDevUI = () => ({ "dev-viewer": { tag: "div", text: "Development mode - TDD cycles" } });
// ============ TESTING ============

export const test = async () => {
	const { runUnitTest, deepEqual } = runtime.testUtils;

	return [
		await runUnitTest("LLM suggestion quality validation", async () => {
			initializeTrainingModuleTest();
			const suggestion = await generateSpecSuggestion();
			const systemPrompt = `You are an expert evaluator of AI-generated software specifications.\n\nScore each suggestion 0-10 on:\n- Relevance: Does it address the user's transcripts?\n- Actionability: Is it specific and implementable?\n- Clarity: Is it well-articulated?\n\nOutput JSON: {"relevance": 0-10, "actionability": 0-10, "clarity": 0-10, "reasoning": "brief explanation"}`;
			const query = `Spec State: ${JSON.stringify(currentSpec)}\nTranscripts: "${transcriptHistory.map(t => t.text).join(' ')}"\nSuggestion: ${JSON.stringify(suggestion)}`;
			const evaluation = JSON.parse(await runtime.call('inference.prompt', { query, systemPrompt, model: { id: "openai/gpt-oss-20b" }, structuredOutput: 'JSON' }));
			return { actual: evaluation, assert: (actual) => actual.relevance >= 7 && actual.actionability >= 7 && actual.clarity >= 7, expected: { meetsThreshold: true } };
		}, cleanupTest())
		// await runUnitTest("Accept suggestion updates spec", async () => {
		// 	let actual = {};
		// 	currentSpec.what = "build a training module";
		// 	await injectSpecSuggestion();
		// 	actual.suggestionGenerated = !!(lastSuggestion && lastSuggestion.field && lastSuggestion.content);
		// 	actual.hasPending = pendingChanges.has(lastSuggestion.field);
		// 	await acceptSpecChange({ target: { dataset: { field: lastSuggestion.field } } });
		// 	actual.specUpdated = currentSpec[lastSuggestion.field] === lastSuggestion.content;
		// 	actual.pendingCleared = !pendingChanges.has(lastSuggestion.field);
		// 	return { actual, assert: deepEqual, expected: Object.keys(actual).reduce((obj, key) => ({ ...obj, [key]: true }), {}) };
		// }, cleanupTest())
	];
};

const cleanupTest = () => async () => {
	workflowState = { phase: 'idle', spec: null, skeleton: null };
	currentSpec = { what: '', why: '', architecture: { dependencies: [], persistence: 'none', context: [] } };
	pendingChanges.clear();
	transcriptHistory = [];
};
const initializeTrainingModuleTest = async () => {
	transcriptHistory = [
		{ text: "I want to build a training module", timestamp: Date.now(), isFinal: true },
		{ text: "um maybe to collect user feedback on automatically taken actions by systems", timestamp: Date.now() + 10000, isFinal: true },
		{ text: " the real goal here is to collect training data so it can be a source of training these statistical and conditional and potentially even neural automation models to eventually run how I would run autonomously.", timestamp: Date.now() + 20000, isFinal: true }
	];
	currentSpec.what = "build a training module";
}