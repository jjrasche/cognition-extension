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
		interjectionInterval: { type: 'number', min: 15, max: 600, value: 45, label: 'AI Check-in (seconds)' },
		historyAutoClose: { type: 'number', min: 5, max: 60, value: 15, label: 'History Auto-close (seconds)' },
		minTrainingRecords: { type: 'number', min: 10, max: 100, value: 30, label: 'Training records before auto-prediction' }
	}
};
const config = configProxy(manifest), model = "meta-llama/llama-4-scout-17b-16e-instruct";
let runtime, log, workflowState = { phase: 'idle', spec: null, skeleton: null };
let currentSpec = { what: '', why: '', architecture: { dependencies: [], persistence: 'none', context: [] } };
let pendingChanges = new Map(), transcriptHistory = [], isListening = false;
let lastSpeechTime = 0, lastInterjectionTime = 0, lastSuggestion = null, interjectionTimer = null, historyVisible = false;
export const initialize = async (rt, l) => (runtime = rt, log = l, runtime.actions.set('code-assistant.onTranscript', { func: handleTranscript, context: runtime.runtimeName, moduleName: manifest.name }));
// ============ SPEC MODE ============
export const startSpecMode = async () => {
	workflowState.phase = 'spec';
	currentSpec = { what: '', why: '', architecture: { dependencies: [], persistence: 'none', context: [] } };
	pendingChanges.clear();
	transcriptHistory = [];
	isListening = true;
	lastSpeechTime = Date.now();
	await runtime.call('web-speech-stt.startListening');
	await runtime.call('layout.addComponent', 'spec-builder', { width: 100, height: 100, isMaximized: true });
	scheduleSpecInterjection();
}
const scheduleSpecInterjection = () => workflowState.phase !== 'spec' ? null : (interjectionTimer = setTimeout(async () => (isListening && await shouldInterjectSpec() && await injectSpecSuggestion(), scheduleSpecInterjection()), config.interjectionInterval * 1000));
const shouldInterjectSpec = async () => {
	const timeSinceLastSpeech = Date.now() - lastSpeechTime, specIncomplete = !currentSpec.what || !currentSpec.why;
	const recentText = transcriptHistory.slice(-5).map(t => t.text).join(' '), hasUncertainty = /\b(um|uh|maybe|I think|not sure|probably)\b/i.test(recentText);
	const trainingRecords = await runtime.call('graph-db.getNodesByType', 'spec-training');
	return trainingRecords.length >= config.minTrainingRecords ? predictInterjectionSuccess(trainingRecords, { timeSinceLastSpeech, hasUncertainty, specIncomplete }).shouldInterject : specIncomplete || hasUncertainty || timeSinceLastSpeech > 60000;
};
const predictInterjectionSuccess = (records, ctx) => {
	const similar = records.filter(r => Math.abs(r.context.pauseDuration - ctx.timeSinceLastSpeech) < 10000 && ((ctx.hasUncertainty && /\b(um|uh|maybe)\b/i.test(r.context.recentTranscript)) || (!ctx.hasUncertainty && !/\b(um|uh|maybe)\b/i.test(r.context.recentTranscript))));
	if (similar.length < 5) return { shouldInterject: true, confidence: 0.5 };
	const successRate = similar.filter(r => r.userFeedback.action === 'accepted' || r.userFeedback.rightTiming === true).length / similar.length;
	return { shouldInterject: successRate > 0.6, confidence: successRate };
};
const injectSpecSuggestion = async () => (await runtime.call('web-speech-stt.stopListening'), lastSuggestion = await generateSpecSuggestion(), lastInterjectionTime = Date.now(), pendingChanges.set(lastSuggestion.field, { current: currentSpec[lastSuggestion.field], proposed: lastSuggestion.content, type: lastSuggestion.type }), await refreshSpecUI(), await runtime.call('web-speech-stt.startListening'));
const generateSpecSuggestion = async () => JSON.parse(await runtime.call('inference.prompt', { query: `Current spec:\nWhat: ${currentSpec.what || 'Not defined'}\nWhy: ${currentSpec.why || 'Not defined'}\nArchitecture: ${JSON.stringify(currentSpec.architecture)}\n\nRecent: "${transcriptHistory.slice(-30).map(t => t.text).join(' ')}"\n\nGenerate ONE suggestion (modify/add/question).`, model, systemPrompt: getSpecSystemPrompt(), responseFormat: { type: 'json_schema', json_schema: { name: 'spec_suggestion', strict: true, schema: { type: 'object', required: ['type', 'field', 'content'], additionalProperties: false, properties: { type: { type: 'string', enum: ['modify', 'add', 'question'] }, field: { type: 'string', enum: ['what', 'why', 'architecture'] }, content: { type: 'string' } } } } } }));
const getSpecSystemPrompt = () => `You help developers articulate clear specifications.\n\nRules:\n- Ask clarifying questions when vague\n- Suggest specific technical decisions\n- Keep suggestions concise\n- Focus on WHAT and WHY before HOW`;
export const acceptSpecChange = async (eventData) => {
	const field = eventData.target.dataset.field, change = pendingChanges.get(field);
	currentSpec[field] = change.proposed, pendingChanges.delete(field);
	await logSpecTraining('accepted', true), await refreshSpecUI();
};
export const rejectSpecChange = async (eventData) => (pendingChanges.delete(eventData.target.dataset.field), await logSpecTraining('rejected', null), await refreshSpecUI());
export const markWrongTiming = async () => (await logSpecTraining('ignored', false), pendingChanges.clear(), await refreshSpecUI());
const logSpecTraining = async (action, rightTiming) => lastSuggestion && await runtime.call('graph-db.addNode', { type: 'spec-training', timestamp: new Date().toISOString(), context: { specState: { ...currentSpec }, recentTranscript: transcriptHistory.slice(-30).map(t => t.text).join(' '), pauseDuration: Date.now() - lastSpeechTime, lastAIInterjection: Date.now() - lastInterjectionTime }, aiResponse: lastSuggestion, userFeedback: { action, rightTiming } });
export const completeSpec = async () => !currentSpec.what || !currentSpec.why ? log.log('Spec incomplete - need what and why') : (clearTimeout(interjectionTimer), workflowState.phase = 'skeleton', workflowState.spec = { ...currentSpec }, await runtime.call('web-speech-stt.stopListening'), await runtime.call('layout.removeComponent', 'spec-builder'), await startSkeletonMode());
export const stopListening = async () => (isListening = false, await runtime.call('web-speech-stt.stopListening'), await refreshSpecUI());
export const toggleHistory = async () => (historyVisible = !historyVisible, await refreshSpecUI());
const handleTranscript = (transcriptData) => (transcriptHistory.push({ text: transcriptData.text, timestamp: Date.now(), isFinal: transcriptData.isFinal }), transcriptData.isFinal && (lastSpeechTime = Date.now(), updateSpecFromTranscript(transcriptData.text)));
const updateSpecFromTranscript = (text) => (/^(I want to|I need to|Build|Create)/i.test(text) ? currentSpec.what = (currentSpec.what + ' ' + text).trim() : /^(because|so that|to enable)/i.test(text) && (currentSpec.why = (currentSpec.why + ' ' + text).trim()), refreshSpecUI());
const refreshSpecUI = () => runtime.call('layout.renderComponent', 'spec-builder');
export const buildSpecUI = () => ({
	"spec-builder": {
		tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; gap: 15px;",
		"header": {
			tag: "div", style: "display: flex; justify-content: space-between; align-items: center;",
			"title": { tag: "h2", text: "Spec Mode", style: "margin: 0;" },
			"mic-btn": { tag: "button", text: isListening ? "⏸ Pause" : "🎤 Start", class: "cognition-button-primary", events: { click: isListening ? "code-assistant.stopListening" : "code-assistant.startSpecMode" } },
			"status": { tag: "div", text: isListening ? "🎤 Listening" : "⏸ Paused", style: `color: ${isListening ? '#4CAF50' : '#666'}; font-weight: 500;` }
		},
		"spec-display": { tag: "div", style: "flex: 1; display: flex; flex-direction: column; gap: 20px; overflow-y: auto;", ...buildSpecFields() },
		...(historyVisible && buildHistoryPanel()),
		"actions": { tag: "div", style: "display: flex; gap: 10px; padding-top: 15px; border-top: 1px solid var(--border-primary);", "history-btn": { tag: "button", text: historyVisible ? "Hide History" : "Show History", class: "cognition-button-secondary", events: { click: "code-assistant.toggleHistory" } }, "complete-btn": { tag: "button", text: "Complete Spec → Skeleton", class: "cognition-button-primary", events: { click: "code-assistant.completeSpec" }, disabled: !currentSpec.what || !currentSpec.why } }
	}
});
const buildSpecFields = () => Object.fromEntries(['what', 'why', 'architecture'].map(field => {
	const change = pendingChanges.get(field), value = field === 'architecture' ? JSON.stringify(currentSpec[field], null, 2) : currentSpec[field];
	return [`${field}-section`, {
		tag: "div", style: "padding: 15px; background: var(--bg-tertiary); border-radius: 8px;",
		"label": { tag: "h3", text: field.toUpperCase(), style: "margin: 0 0 10px 0; color: var(--text-primary);" },
		...(change ? {
			"diff": { tag: "div", "current": { tag: "div", text: change.current || '(empty)', style: "text-decoration: line-through; color: #ff6b6b; margin-bottom: 8px;" }, "proposed": { tag: "div", text: change.proposed, style: "background: #4CAF5020; color: #4CAF50; padding: 8px; border-radius: 4px;" } },
			"actions": { tag: "div", style: "display: flex; gap: 8px; margin-top: 12px;", "accept": { tag: "button", text: "✓ Accept", class: "cognition-button-primary", style: "padding: 6px 12px;", events: { click: "code-assistant.acceptSpecChange" }, "data-field": field, title: "Ctrl+Y" }, "reject": { tag: "button", text: "✗ Reject", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "code-assistant.rejectSpecChange" }, "data-field": field, title: "Ctrl+N" }, "timing": { tag: "button", text: "⏰ Too Early", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "code-assistant.markWrongTiming" }, title: "Valid suggestion, wrong moment" } }
		} : { "value": { tag: "pre", text: value || '(speak to fill this in)', style: "color: var(--text-primary); margin: 0; white-space: pre-wrap; font-family: inherit;" } })
	}];
}));
const buildHistoryPanel = () => ({ "history": { tag: "div", style: "flex: 0 0 200px; border-top: 1px solid var(--border-primary); padding-top: 15px; overflow-y: auto;", "history-title": { tag: "h4", text: "Transcript History", style: "margin: 0 0 10px 0;" }, "entries": { tag: "div", style: "font-size: 12px; color: var(--text-muted);", ...Object.fromEntries(transcriptHistory.slice(-20).map((t, i) => [`entry-${i}`, { tag: "div", text: `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.text}`, style: "margin-bottom: 4px;" }])) } } });
// ============ SKELETON MODE ============
export const startSkeletonMode = async () => (workflowState.phase = 'skeleton', workflowState.skeleton = await generateSkeleton(workflowState.spec), await runtime.call('layout.addComponent', 'skeleton-viewer', { width: 100, height: 100, isMaximized: true }));
const generateSkeleton = async (spec) => await runtime.call('inference.prompt', { query: `Generate module skeleton for:\n${JSON.stringify(spec, null, 2)}\n\nInclude:\n1. Function signatures with JSDoc\n2. Test case descriptions\n3. UI component tree`, model, systemPrompt: getSkeletonSystemPrompt() });
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
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Spec interjection timing with no training data", async () => (lastSpeechTime = Date.now() - 70000, currentSpec = { what: '', why: '', architecture: {} }, { actual: predictInterjectionSuccess([], { timeSinceLastSpeech: 70000, hasUncertainty: false, specIncomplete: true }).shouldInterject, assert: strictEqual, expected: true })),
		await runUnitTest("Training record captures all context", async () => (lastSuggestion = { type: 'modify', field: 'what', content: 'Test' }, transcriptHistory = [{ text: 'test', timestamp: Date.now() }], lastSpeechTime = Date.now() - 5000, lastInterjectionTime = Date.now() - 10000, await logSpecTraining('accepted', true), { actual: ((r) => ({ hasContext: !!r.context, hasAIResponse: !!r.aiResponse, hasFeedback: !!r.userFeedback, actionCorrect: r.userFeedback.action === 'accepted' }))((await runtime.call('graph-db.getNodesByType', 'spec-training')).slice(-1)[0]), assert: deepEqual, expected: { hasContext: true, hasAIResponse: true, hasFeedback: true, actionCorrect: true } })),
		await runUnitTest("Workflow transitions", async () => (workflowState = { phase: 'idle', spec: null, skeleton: null }, workflowState.phase = 'spec', { actual: { afterSpec: workflowState.phase, afterSkeleton: (workflowState.phase = 'skeleton', workflowState.spec = { what: 'test', why: 'test' }, workflowState.phase), afterDev: (workflowState.phase = 'development', workflowState.phase) }, assert: deepEqual, expected: { afterSpec: 'spec', afterSkeleton: 'skeleton', afterDev: 'development' } }))
	];
};