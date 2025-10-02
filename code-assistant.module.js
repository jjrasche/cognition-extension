// code-assistant.module.js
import { getId, wait } from "./helpers.js";
import { configProxy } from "./config.module.js";
export const manifest = {
	name: "code-assistant",
	context: ["extension-page"],
	version: "1.0.0",
	description: "AI-powered development: spec → skeleton → develop. Prioritizing operating in the voice-first intent layer and test driven development",
	dependencies: ["file", "inference", "layout", "chrome-sync", "web-speech-stt", "graph-db"],
	requiredDirectories: ["cognition-extension"],
	actions: ["renderUI", "handleWorkflowSelect", "toggleListening", "toggleLiveTranscript", "acceptSpecChange", "rejectSpecChange", "markWrongTiming", "completeSpec", "toggleHistory", "completeSkeleton", "debugError", "applyChanges", "loadWorkflow", "searchWorkflows", "deleteWorkflow", "updateWorkflowName", "showWorkflowPicker"],
	uiComponents: [{ name: "code-assistant", getTree: "buildUI" }],
	config: {
		historyAutoClose: { type: 'number', min: 5, max: 60, value: 15, label: 'History Auto-close (seconds)' },
		minTrainingRecords: { type: 'number', min: 10, max: 100, value: 30, label: 'Training records before auto-prediction' }
	},
	indexeddb: {
		name: 'CodeAssistantDB', version: 1,
		storeConfigs: [{
			name: 'workflows',
			options: { keyPath: 'id' },
			indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }, { name: 'by-modified', keyPath: 'lastModified' }]
		}]
	}
};
const config = configProxy(manifest), model = "meta-llama/llama-4-scout-17b-16e-instruct";
let runtime, log, workflowPickerVisible = false;
let phases = {
	spec: { ui: "spec-mode", title: "Spec Mode"},
	skeleton: { ui: "skeleton-builder", title: "Skeleton Mode"},
	develop: { ui: "dev-viewer", title: "Develop Mode"}
};
export const initialize = async (rt, l) => {
	runtime = rt; log = l;
	cachedWorkflows = await db('getAllRecords');
};

// ============ WORKFLOW MANAGEMENT ============
const transitions = { spec: 'skeleton', skeleton: 'develop', develop: null };
const specDefault = () => ({ what: '', why: '', architecture: { dependencies: [], persistence: 'none', context: [] } });
const getBlankWorkflowState = () => ({ id: null, name: '', phase: 'spec', spec: specDefault(), skeleton: null, communicationHistory: [], lastModified: null });
let workflowState = getBlankWorkflowState();
const db = async (method, ...args) => await runtime.call(`indexed-db.${method}`, 'CodeAssistantDB', 'workflows', ...args);
const updateWorkflow = async (updates) => {
	workflowState.id = workflowState.id || getId('wf-');
	workflowState.lastModified = Date.now();
	Object.assign(workflowState, updates);
	await db('updateRecord', workflowState);
};
export const loadWorkflow = async (id) => {
	workflowState = await db('getRecord', id) ?? (() => { throw new Error('Workflow not found') })();
	pendingChanges.clear();
	await renderUI();
};
export const deleteWorkflow = async (id) => { 
	await db('removeRecord', id);
	if (workflowState.id === id) workflowState = getBlankWorkflowState();
	await renderUI(); 
};
export const updateWorkflowName = async (eventData) => updateWorkflow({ name: eventData.target.value });
// === COMMUNICATION HISTORY ===
const logComm = async (type, data) => updateWorkflow({ communicationHistory: [...workflowState.communicationHistory, { type, ...data, timestamp: Date.now() }] });
// === SHARED UI ===
const getPhase = () => phases[workflowState.phase]
const workflowPickerBtn = () => ({ "picker-btn": { tag: "button", text: "📁 Workflows", class: "cognition-button-secondary", events: { click: "code-assistant.showWorkflowPicker" } } });
const nameInput = () => ({ "name-input": { tag: "input", type: "text", value: workflowState.name, placeholder: "Workflow name...", class: "cognition-input", style: "flex: 1; max-width: 300px;", events: { change: "code-assistant.updateWorkflowName" } } });
const completeBtn = () => ({ "complete-btn": { tag: "button", text: `Complete ${getPhase().title}`, class: "cognition-button-primary", events: { click: "code-assistant.complete" }, disabled: getPhase().canComplete() } });
const modeHeaderAndTitle = () => ({ tag: "div", style: "display: flex; justify-content: space-between; align-items: center; gap: 10px;", "title": { tag: "h2", text: getPhase().title, style: "margin: 0;" } });
const modeBody = () => ({ [getPhase().ui]: { tag: "div", style: "flex: 1; display: flex; flex-direction: column; gap: 20px; overflow-y: auto;", ...getPhase().body() } });
const actionsBar = () => ({ "actions": { tag: "div", style: "display: flex; gap: 10px; padding-top: 15px; border-top: 1px solid var(--border-primary);", ...Object.assign({}, ...getPhase().actions.map(a => a())) } });
export const start = async () => getPhase().start();
export const complete = async () => {
	const phase = getPhase();
	if (!phase.canComplete()) return;
	await phase.stop?.();
	const nextPhase = transitions[workflowState.phase];
	if (!nextPhase) return log.info('Workflow complete!');
	await updateWorkflow({ phase: nextPhase });
	await getPhase().start?.();
	await renderUI();
};
export const renderUI = async () => await runtime.call('layout.renderComponent', "code-assistant");
export const buildUI = () => ({[getPhase().ui]: {
	tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; gap: 15px;",
	"header": { ...modeHeaderAndTitle(), ...nameInput(), ...workflowPickerBtn(), ...getPhase()?.additionalHeader() ?? {} },
	...(workflowPickerVisible && buildWorkflowPickerUI()), ...modeBody(), ...actionsBar()
}});
// === SEARCH ===
let cachedWorkflows = [];
export const searchWorkflows = async (query) => {
	const all = await db('getAllRecords');
	cachedWorkflows = all;
	if (!query.trim()) return all.sort((a, b) => b.lastModified - a.lastModified);
	const lq = query.toLowerCase();
	return all.map(wf => ({...wf,
		score: (wf.name?.toLowerCase().includes(lq) ? 10 : 0) +
		(wf.spec?.what?.toLowerCase().includes(lq) ? 5 : 0) +
		(wf.spec?.why?.toLowerCase().includes(lq) ? 5 : 0) +
		(JSON.stringify(wf.spec?.architecture).toLowerCase().includes(lq) ? 2 : 0) +
		(wf.communicationHistory?.some(c => c.text?.toLowerCase().includes(lq)) ? 1 : 0)
	})).filter(wf => wf.score > 0).sort((a, b) => b.score - a.score);
};
export const handleSearchInput = async (eventData) => { const results = await searchWorkflows(eventData.target.value); await renderUI(); };
export const showWorkflowPicker = async () => { workflowPickerVisible = !workflowPickerVisible; await renderUI(); };
export const handleWorkflowSelect = async (eventData) => { await loadWorkflow(eventData.target.closest('[data-workflow-id]').dataset.workflowId); renderUI(); }
const buildWorkflowPickerUI = () => ({ "workflow-drawer": {
	tag: "div", style: "position: absolute; top: 60px; right: 20px; width: 300px; max-height: 400px; background: var(--bg-secondary); border: 1px solid var(--border-primary); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; display: flex; flex-direction: column;",
	"picker-header": { tag: "div", style: "padding: 10px; border-bottom: 1px solid var(--border-primary);", ...searchInput() },
	"picker-list": { tag: "div", style: "flex: 1; overflow-y: auto; padding: 8px;", ...buildWorkflowList() }
}});
const searchInput = () => ({ "search": { tag: "input", type: "text", placeholder: "Search workflows...", class: "cognition-input", events: { input: "code-assistant.handleSearchInput" } } });
const buildWorkflowList = () => cachedWorkflows.length === 0 ? {"loading": {tag: "div", text: "Loading...", style: "..."}} : Object.fromEntries(cachedWorkflows.slice(0, 20).map(wf => [`wf-${wf.id}`, {
	tag: "div", style: "...", events: {click: "code-assistant.handleWorkflowSelect"}, 
	"data-workflow-id": wf.id,
	"name": {tag: "div", text: wf.name, style: "font-weight: 500;"},
	"what": {tag: "div", text: wf.spec?.what || '', style: "..."}
}]));
// ============ MIC & SPEECH RECOGNITION ============
let liveTranscript = '';
const injectSpecSuggestion = async () => {
	try {
		lastSuggestion = await generateSpecSuggestion();
		pendingChanges.set(lastSuggestion.field, { current: workflowState.spec[lastSuggestion.field], proposed: lastSuggestion.content, type: lastSuggestion.type });
		await renderUI();
	} catch (error) { log.error('Failed to generate spec suggestion:', error); }
};
const generateSpecSuggestion = async () => {
	try { return JSON.parse(await runtime.call('inference.prompt', { query: `${JSON.stringify(workflowState.spec)}\n\n${transcriptHistory.slice(-10).map(t => t.text).join(' ')}`, model, systemPrompt: getSpecSystemPrompt(), structuredOutput: 'JSON' })); }
	catch (e) { log.error('Spec suggestion parse error:', e); return { type: 'modify', field: 'what', content: 'Error parsing AI response' }; }
};
const getSpecSystemPrompt = () => `You extract and refine software specifications from conversational transcripts.\n\nInput: JSON spec state + recent transcript text\nOutput: ONE suggestion as JSON: {"type": "modify|add|question", "field": "what|why|architecture", "content": "..."}\n\nRules:\n- Extract WHAT (feature/capability) and WHY (user need/goal) from natural speech\n- Suggest specific technical decisions when architecture is vague\n- Ask clarifying questions when requirements are unclear\n- Keep suggestions concise and actionable\n- Focus on WHAT and WHY before architectural HOW`;
export const acceptSpecChange = async (eventData) => {
	const field = eventData.target.dataset.field, change = pendingChanges.get(field);
	await updateWorkflow({ spec: { ...workflowState.spec, [field]: change.proposed } });
	pendingChanges.delete(field);
	await logSpecTraining('accepted', true); await renderUI();
};
export const rejectSpecChange = async (eventData) => {
	pendingChanges.delete(eventData.target.dataset.field);
	await logSpecTraining('rejected', null); await renderUI();
};
export const markWrongTiming = async () => {
	await logSpecTraining('ignored', false);
	pendingChanges.clear(); await renderUI();
};
const logSpecTraining = async (action, rightTiming) => { }
// lastSuggestion && await runtime.call('graph-db.addNode', {
// 	type: 'spec-training', aiResponse: lastSuggestion, userFeedback: { action, rightTiming },
// 	context: { specState: { ...currentSpec }, recentTranscript: transcriptHistory.slice(-5).map(t => t.text).join(' '), pauseDuration: Date.now() - lastSpeechTime },
// });
// ============ SPEC MODE ============
let pendingChanges = new Map(), transcriptHistory = [], isListening = false, lastSpeechTime = 0, lastSuggestion = null, historyVisible = false, liveTranscriptVisible = true;
phases.spec.start = async () => { pendingChanges.clear(); transcriptHistory = []; isListening = true; lastSpeechTime = Date.now(); };
phases.spec.stop = async () => { await runtime.call('web-speech-stt.stopListening'); isListening = false; };
phases.spec.canComplete = () => !!(workflowState.spec.what && workflowState.spec.why);
export const toggleLiveTranscript = async () => { liveTranscriptVisible = !liveTranscriptVisible; await renderUI(); };
export const toggleHistory = async () => (historyVisible = !historyVisible, await renderUI());
export const toggleListening = async () => {
	isListening = !isListening;
	if (!isListening) liveTranscript = '';
	await runtime.call('web-speech-stt.toggleListening', handleTranscript, 8000);
	renderUI();
};
const handleTranscript = async (chunk) => {
	if (chunk.finalizedAt) {
		transcriptHistory.push(chunk); liveTranscript = ''; log.log('finalized:', chunk.text);
		if (/what do you think/i.test(chunk.text)) await injectSpecSuggestion();
		await renderUI();
	} else { liveTranscript = chunk.text; await renderUI(); }
};
// todo: standardize all style using css classes
const specFields = () => Object.fromEntries(['what', 'why', 'architecture'].map(field => {
	const change = pendingChanges.get(field), value = field === 'architecture' ? JSON.stringify(workflowState.spec[field], null, 2) : workflowState.spec[field];
	return [`${field}-section`, {
		tag: "div", style: "padding: 15px; background: var(--bg-tertiary); border-radius: 8px;",
		"label": { tag: "h3", text: field.toUpperCase(), style: "margin: 0 0 10px 0; color: var(--text-primary);" },
		...(change ? {
			"diff": { tag: "div", "current": { tag: "div", text: change.current || '(empty)', style: "text-decoration: line-through; color: #ff6b6b; margin-bottom: 8px;" }, "proposed": { tag: "div", text: change.proposed, style: "background: #4CAF5020; color: #4CAF50; padding: 8px; border-radius: 4px;" } },
			"actions": { tag: "div", style: "display: flex; gap: 8px; margin-top: 12px;", ...acceptBtn(field), ...rejectBtn(field), ...wrongTimingBtn() }
		} : { "value": { tag: "pre", text: value || '(speak to fill this in)', style: "color: var(--text-primary); margin: 0; white-space: pre-wrap; font-family: inherit;" } })
	}];
}));
const transcriptContent = () => ({ "content": { tag: "textarea", value: liveTranscript, readonly: true,placeholder: "Listening...",style: "width: 100%; height: 150px; resize: vertical; font-size: 12px; color: var(--text-muted); font-style: italic;" } });
const micToggle = () => ({ "mic-toggle": { tag: "button", text: isListening ? "⏸ Pause Listening" : "🎤 Start Listening", class: isListening ? "cognition-button-secondary" : "cognition-button-primary", style: isListening ? "background: #4CAF50;" : "", events: { click: "code-assistant.toggleListening" } } });
const transcriptBtn = () => ({ "toggle": { tag: "button", text: liveTranscriptVisible ? "Hide Transcript" : "Show Transcript", class: "cognition-button-secondary", events: { click: "code-assistant.toggleLiveTranscript" } } });
const historyBtn = () => ({ "history-btn": { tag: "button", text: historyVisible ? "Hide History" : "Show History", class: "cognition-button-secondary", events: { click: "code-assistant.toggleHistory" } } });
const acceptBtn = (field) => ({ "accept": { tag: "button", text: "✓ Accept", class: "cognition-button-primary", style: "padding: 6px 12px;", events: { click: "code-assistant.acceptSpecChange" }, "data-field": field, title: "Ctrl+Y" } });
const rejectBtn = (field) => ({ "reject": { tag: "button", text: "✗ Reject", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "code-assistant.rejectSpecChange" }, "data-field": field, title: "Ctrl+N" } });
const wrongTimingBtn = () => ({ "timing": { tag: "button", text: "⏰ Too Early", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "code-assistant.markWrongTiming" }, title: "Valid suggestion, wrong moment" } });
const historyPanel = () => ({"history": {
	tag: "div", style: "flex: 0 0 200px; border-top: 1px solid var(--border-primary); padding-top: 15px; overflow-y: auto;",
	"history-title": { tag: "h4", text: "Transcript History", style: "margin: 0 0 10px 0;" },
	"entries": { tag: "div", style: "font-size: 12px; color: var(--text-muted);", ...historyEntries() }
}});
const liveTranscriptPanel = () => ({ "live-transcript": {
	tag: "div", style: "flex: 0 0 200px; border-top: 1px solid var(--border-primary); padding-top: 15px;",
	"transcript-title": { tag: "h4", text: "Live Transcript", style: "margin: 0;" },
	...(liveTranscriptVisible && transcriptContent())
}});
const historyEntries = () => Object.fromEntries(transcriptHistory.slice(-20).map((t, i) => [`entry-${i}`, { tag: "div", text: `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.text}`, style: "margin-bottom: 4px;" }]));
phases.spec.additionalHeader = () => ({ ...micToggle() });
phases.spec.body = () => ({ ...specFields(), ...(historyVisible && historyPanel()), ...(liveTranscriptVisible && liveTranscriptPanel()) });
phases.spec.actions = [historyBtn, transcriptBtn, completeBtn];
// ============ SKELETON MODE ============
phases.skeleton.start = async () => { };
phases.skeleton.stop = async () => { };
phases.skeleton.canComplete = () => false; // TODO: check skeleton files exist
const getSkeletonSystemPrompt = () => `You generate module skeletons following this pattern:\n- manifest with name, actions, dependencies\n- Function signatures with clear parameter types\n- Test descriptions: "test name" → expected behavior\n- UI tree: nested objects with events`;
phases.skeleton.body = () => ({})
phases.skeleton.actions = [completeBtn];
// ============ DEVELOP MODE ============
phases.develop.start = async () => { };
phases.develop.stop = async () => { };
phases.develop.canComplete = () => false; // TODO: check tests pass
export const startDevelopment = async () => {
	await updateWorkflow({ phase: 'development' });
}
export const applyChanges = async () => ({});
phases.develop.body = () => ({})
phases.develop.actions = [completeBtn];
// ============ TESTING ============
export const test = async () => {
	const { runUnitTest, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Workflow persistence roundtrip", async () => {
			let actual = {};
			await initializeTrainingModuleTest();
			await updateWorkflow();
			const savedId = workflowState.id;
			actual.workflowSaved = !!savedId;
			workflowState = getBlankWorkflowState(); renderUI();
			actual.workflowCleared = !workflowState.id;
			await loadWorkflow(savedId); renderUI();
			actual.workflowLoaded = workflowState.id == savedId;
			await deleteWorkflow(savedId); renderUI();
			actual.recordNotInDB = !(await db('getRecord', savedId));
			actual.workflowClearedAfterDelete = !workflowState.id;
			return { actual, assert: deepEqual, expected: Object.keys(actual).reduce((obj, key) => ({ ...obj, [key]: true }), {}) };
		})
		// await runUnitTest("LLM suggestion quality validation", async () => {
			// 	initializeTrainingModuleTest();
		// 	const suggestion = await generateSpecSuggestion();
		// 	const systemPrompt = `You are an expert evaluator of AI-generated software specifications.\n\nScore each suggestion 0-10 on:\n- Relevance: Does it address the user's transcripts?\n- Actionability: Is it specific and implementable?\n- Clarity: Is it well-articulated?\n\nOutput JSON: {"relevance": 0-10, "actionability": 0-10, "clarity": 0-10, "reasoning": "brief explanation"}`;
		// 	const query = `Spec State: ${JSON.stringify(workflowState.spec)}\nTranscripts: "${transcriptHistory.map(t => t.text).join(' ')}"\nSuggestion: ${JSON.stringify(suggestion)}`;
		// 	const evaluation = JSON.parse(await runtime.call('inference.prompt', { query, systemPrompt, model: { id: "openai/gpt-oss-20b" }, structuredOutput: 'JSON' }));
		// 	return { actual: evaluation, assert: (actual) => actual.relevance >= 7 && actual.actionability >= 7 && actual.clarity >= 7, expected: { meetsThreshold: true } };
		// }, cleanupTest())
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

const cleanupTest = () => async () => { workflowState = getBlankWorkflowState(); pendingChanges.clear(); transcriptHistory = []; };
const initializeTrainingModuleTest = async () => {
	transcriptHistory = [
		{ text: "I want to build a training module", timestamp: Date.now(), isFinal: true },
		{ text: "um maybe to collect user feedback on automatically taken actions by systems", timestamp: Date.now() + 10000, isFinal: true },
		{ text: " the real goal here is to collect training data so it can be a source of training these statistical and conditional and potentially even neural automation models to eventually run how I would run autonomously.", timestamp: Date.now() + 20000, isFinal: true }
	];
	workflowState.spec.what = "build a training module";
	renderUI();
}