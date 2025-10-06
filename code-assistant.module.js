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
	actions: ["renderUI", "handleWorkflowSelect", "acceptSpecChange", "rejectSpecChange", "markWrongTiming", "toggleListening", "toggleUserPrompt", "toggleHistory", "showWorkflowPicker", "handleWorkflowSelect", "handleSearchInput", "handleWorkflowDelete", "updateWorkflowName", "complete", "handleUserPromptFocus", "updateSpecField", "updateUserPrompt", "updateTranscriptEntry", "deleteTranscriptEntry"],
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
const config = configProxy(manifest);
let runtime, log, workflowPickerVisible = false, isManuallyEditing = false, model = "meta-llama/llama-4-scout-17b-16e-instruct";
let phases = {
	spec: { ui: "spec-mode", title: "Spec Mode"},
	skeleton: { ui: "skeleton-builder", title: "Skeleton Mode"},
	develop: { ui: "dev-viewer", title: "Develop Mode"}
};
export const initialize = async (rt, l) => {
	runtime = rt; log = l;
	cachedWorkflows = await db('getAllRecords');
	await loadMostRecentWorkflow();
};

// ============ WORKFLOW MANAGEMENT ============
const loadMostRecentWorkflow = async () => {
	workflowState = cachedWorkflows.sort((a, b) => b.lastModified - a.lastModified)[0] ?? getBlankWorkflowState();
};
const transitions = { spec: 'skeleton', skeleton: 'develop', develop: null };
const specDefault = () => ({ what: '', why: '', architecture: { dependencies: [], persistence: 'none', context: [] } });
const getBlankWorkflowState = () => ({ id: null, name: '', phase: 'spec', spec: specDefault(), skeleton: null, transcriptHistory: [], lastModified: null });
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
const deleteWorkflow = async (id) => { 
	await db('removeRecord', id);
	if (workflowState.id === id) workflowState = getBlankWorkflowState();
	cachedWorkflows = cachedWorkflows.filter(w => w.id !== id);
	await renderUI(); 
};
export const handleWorkflowDelete = async (eventData) => {
	await deleteWorkflow(eventData.ancestorData.workflowId);
	workflowPickerVisible = true;
	await renderUI();
};
export const updateWorkflowName = async (eventData) => updateWorkflow({ name: eventData.target.value });
// ============ EVENT HANDLERS ============
export const updateSpecField = async (eventData) => {
	const field = eventData.target.dataset.field;
	const value = field === 'architecture' ? JSON.parse(eventData.target.value) : eventData.target.value;
	await updateWorkflow({ spec: { ...workflowState.spec, [field]: value } });
};
export const updateUserPrompt = async (eventData) => {
	if (isManuallyEditing && !isListening) {
		userPrompt = eventData.target.value;
	}
};
export const handleUserPromptFocus = async () => {
	if (isListening) {
		await runtime.call('web-speech-stt.stopListening');
		isListening = false;
		await renderUI();
	}
	isManuallyEditing = true;
};
export const updateTranscriptEntry = async (eventData) => {
	const index = parseInt(eventData.ancestorData.entryIndex);
	const updated = [...workflowState.transcriptHistory];
	updated[index] = eventData.target.value;
	await updateWorkflow({ transcriptHistory: updated });
};
export const deleteTranscriptEntry = async (eventData) => {
	const index = parseInt(eventData.ancestorData.entryIndex);
	await updateWorkflow({ transcriptHistory: workflowState.transcriptHistory.filter((_, i) => i !== index) });
	await renderUI();
};
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
export const renderUI = async () => {
	await runtime.call('layout.renderComponent', "code-assistant");
};
export const buildUI = () => {
	return {[getPhase().ui]: {
		tag: "div", style: "height: 100vh; display: flex; flex-direction: column; padding: 20px; gap: 15px;",
		"header": { ...modeHeaderAndTitle(), ...nameInput(), ...workflowPickerBtn(), ...getPhase()?.additionalHeader() ?? {} },
		...(workflowPickerVisible && buildWorkflowPickerUI()), ...modeBody(), ...actionsBar()
	}}
};
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
		(wf.transcriptHistory?.some(c => c.text?.toLowerCase().includes(lq)) ? 1 : 0)
	})).filter(wf => wf.score > 0).sort((a, b) => b.score - a.score);
};
export const handleSearchInput = async (eventData) => { const results = await searchWorkflows(eventData.target.value); await renderUI(); };
export const showWorkflowPicker = async () => { workflowPickerVisible = !workflowPickerVisible; await renderUI(); };
export const handleWorkflowSelect = async (eventData) => {
	await loadWorkflow(eventData.ancestorData.workflowId);
	workflowPickerVisible = false;
	renderUI();
};
export const handleBackdropClick = async (eventData) => {
	if (eventData.target === eventData.currentTarget) {
		workflowPickerVisible = false;
		await renderUI();
	}
};
const buildWorkflowPickerUI = () => ({ "workflow-drawer": {
	"workflow-backdrop": { tag: "div", style: "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); z-index: 999;", events: { click: "code-assistant.handleBackdropClick" } },
	"workflow-drawer": { tag: "div", style: "position: absolute; top: 60px; right: 20px; width: 300px; max-height: 400px; background: var(--bg-secondary); border: 1px solid var(--border-primary); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; display: flex; flex-direction: column;",
		"picker-header": { tag: "div", style: "padding: 10px; border-bottom: 1px solid var(--border-primary);", ...searchInput() },
		"picker-list": { tag: "div", style: "flex: 1; overflow-y: auto; padding: 8px;", ...workflowList() }
	}
}});
const searchInput = () => ({ "search": { tag: "input", type: "text", placeholder: "Search workflows...", class: "cognition-input", events: { input: "code-assistant.handleSearchInput" } } });
const workflowList = () => cachedWorkflows.length === 0 ? {"loading": {tag: "div", text: "Loading...", style: "padding: 10px; text-align: center; color: var(--text-muted);"}} : 
Object.fromEntries(cachedWorkflows.slice(0, 20).map(wf => [`wf-${wf.id}`, workflowItem(wf)]));
const workflowItem = (wf) => ({ tag: "div", style: "position: relative; padding: 10px 40px 10px 10px; border-bottom: 1px solid var(--border-primary); cursor: pointer;", events: {click: "code-assistant.handleWorkflowSelect"}, "data-workflow-id": wf.id,
	"name": {tag: "div", text: wf.name || '(unnamed)', style: "font-weight: 500; margin-bottom: 4px;"},
	"what": {tag: "div", text: wf.spec?.what || '(no description)', style: "font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"},
	...deleteWorkflowBtn()
});
const deleteWorkflowBtn = () => ({ "delete-btn": { tag: "button", text: "🗑️", class: "cognition-button-secondary", style: "position: absolute; top: 8px; right: 8px; padding: 4px 8px; font-size: 12px;", events: {click: "code-assistant.handleWorkflowDelete"}, title: "Delete workflow" } });
// ============ MIC & SPEECH RECOGNITION ============
let userPrompt = '';
const injectSpecSuggestion = async () => {
	try {
		lastSuggestion = await generateSpecSuggestion();
		pendingChanges.set(lastSuggestion.field, { current: workflowState.spec[lastSuggestion.field], proposed: lastSuggestion.content, type: lastSuggestion.type });
		await updateWorkflow({ transcriptHistory: [...workflowState.transcriptHistory, `AI: [${lastSuggestion.type}] ${lastSuggestion.field} → ${lastSuggestion.content}`] });
		await renderUI();
	} catch (error) { log.error('Failed to generate spec suggestion:', error); }
};
const generateSpecSuggestion = async () => {
	try {
		const query = `${JSON.stringify(workflowState.spec)}\n\n${workflowState.transcriptHistory.slice(-10).join(' ')}`;
		return JSON.parse(await runtime.call('inference.prompt', { query, model, systemPrompt: getSpecSystemPrompt(), responseFormat: 'JSON' }));
	} catch (e) { log.error('Spec suggestion parse error:', e); return { type: 'modify', field: 'what', content: 'Error parsing AI response' }; }
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
let pendingChanges = new Map(), isListening = false, lastSpeechTime = 0, lastSuggestion = null, historyVisible = true, userPromptVisible = true;
phases.spec.start = async () => { pendingChanges.clear(); isListening = true; lastSpeechTime = Date.now(); };
phases.spec.stop = async () => { await runtime.call('web-speech-stt.stopListening'); isListening = false; };
phases.spec.canComplete = () => !!(workflowState.spec.what && workflowState.spec.why);
export const toggleUserPrompt = async () => { userPromptVisible = !userPromptVisible; await renderUI(); };
export const toggleHistory = async () => (historyVisible = !historyVisible, await renderUI());
export const toggleListening = async () => {
	isListening = !isListening;
	if (!isListening) userPrompt = '';
	else isManuallyEditing = false;
	await runtime.call('web-speech-stt.toggleListening', handleTranscript, 8000);
	renderUI();
};
const handleTranscript = async (chunk) => {
	if (isManuallyEditing) return; // Ignore speech when manually editing
	if (chunk.finalizedAt) {
		userPrompt = ''; log.info('finalized:', chunk.text);
		await saveTranscripts(chunk.text);
		await injectSpecSuggestion();
		await renderUI();
	} else { 
		userPrompt = chunk.text;
		if (/what do you think/i.test(chunk.text)) await injectSpecSuggestion();
		await renderUI();
	}
};
const saveTranscripts = async (text) => await updateWorkflow({ transcriptHistory: [...workflowState.transcriptHistory, text] });
// todo: standardize all style using css classes
const specFields = () => Object.fromEntries(['what', 'why', 'architecture'].map(field => {
	const change = pendingChanges.get(field);
	const value = field === 'architecture' ? JSON.stringify(workflowState.spec[field], null, 2) : workflowState.spec[field];
	return [`${field}-section`, { tag: "div", style: "padding: 15px; background: var(--bg-tertiary); border-radius: 8px;",
		"label": { tag: "h3", text: field.toUpperCase(), style: "margin: 0 0 10px 0; color: var(--text-primary);" },
		...(change ? changeDiffer(field, change) : fieldTextArea(field, value))
	}];
}));
const changeDiffer = (field, change) => ({"diff": { tag: "div",
	"current": { tag: "div", text: change.current || '(empty)', style: "text-decoration: line-through; color: #ff6b6b; margin-bottom: 8px;" },
	"proposed": { tag: "div", text: change.proposed, style: "background: #4CAF5020; color: #4CAF50; padding: 8px; border-radius: 4px;" }
}, "actions": { tag: "div", style: "display: flex; gap: 8px; margin-top: 12px;", ...acceptBtn(field), ...rejectBtn(field), ...wrongTimingBtn() } });
const fieldTextArea = (field, value) => ({ "value": { tag: "textarea", value: value || '', placeholder: `(speak or type ${field})`, class: `cognition-input cognition-textarea-${field === 'architecture' ? 'md' : 'sm'}`, events: { change: "code-assistant.updateSpecField" }, "data-field": field } });
const transcriptContent = () => ({ "content": { tag: "textarea", value: userPrompt, placeholder: "Type or speak your prompt...", class: "cognition-input cognition-textarea-md",  events: { input: "code-assistant.updateUserPrompt", focus: "code-assistant.handleUserPromptFocus", } } });
const historyEntries = () => Object.fromEntries(workflowState.transcriptHistory.slice(-20).map((text, i) => [ `entry-${i}`, { tag: "div", style: "margin-bottom: 8px; padding: 8px; background: var(--bg-input); border-radius: 4px; position: relative;", "data-entry-index": i, ...historyTextarea(text), ...historyDeleteBtn() } ]) );
const historyTextarea = (text) => ({ "textarea": { tag: "textarea", value: text, class: "cognition-input cognition-textarea-sm", events: { change: "code-assistant.updateTranscriptEntry" } } });
const historyDeleteBtn = () => ({ "delete": { tag: "button", text: "🗑️", class: "cognition-button-secondary", style: "position: absolute; top: 4px; right: 4px; padding: 2px 6px; font-size: 10px;", events: { click: "code-assistant.deleteTranscriptEntry" } } });
const micToggle = () => ({ "mic-toggle": { tag: "button", text: isListening ? "⏸ Pause Listening" : "🎤 Start Listening", class: isListening ? "cognition-button-secondary" : "cognition-button-primary", style: isListening ? "background: #4CAF50;" : "", events: { click: "code-assistant.toggleListening" } } });
const transcriptBtn = () => ({ "toggle": { tag: "button", text: userPromptVisible ? "Hide Transcript" : "Show Transcript", class: "cognition-button-secondary", events: { click: "code-assistant.toggleUserPrompt" } } });
const historyBtn = () => ({ "history-btn": { tag: "button", text: historyVisible ? "Hide History" : "Show History", class: "cognition-button-secondary", events: { click: "code-assistant.toggleHistory" } } });
const acceptBtn = (field) => ({ "accept": { tag: "button", text: "✓ Accept", class: "cognition-button-primary", style: "padding: 6px 12px;", events: { click: "code-assistant.acceptSpecChange" }, "data-field": field, title: "Ctrl+Y" } });
const rejectBtn = (field) => ({ "reject": { tag: "button", text: "✗ Reject", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "code-assistant.rejectSpecChange" }, "data-field": field, title: "Ctrl+N" } });
const wrongTimingBtn = () => ({ "timing": { tag: "button", text: "⏰ Too Early", class: "cognition-button-secondary", style: "padding: 6px 12px;", events: { click: "code-assistant.markWrongTiming" }, title: "Valid suggestion, wrong moment" } });
const historyPanel = () => ({"history": {
	tag: "div", style: "flex: 0 0 200px; border-top: 1px solid var(--border-primary); padding-top: 15px; overflow-y: auto;",
	"history-title": { tag: "h4", text: "Transcript History", style: "margin: 0 0 10px 0;" },
	"entries": { tag: "div", style: "font-size: 12px; color: var(--text-muted);", ...historyEntries() }
}});
const userPromptPanel = () => ({ "live-transcript": {
	tag: "div", style: "flex: 0 0 200px; border-top: 1px solid var(--border-primary); padding-top: 15px;",
	"transcript-title": { tag: "h4", text: "User Prompt", style: "margin: 0;" },
	...(userPromptVisible && transcriptContent())
}});
phases.spec.additionalHeader = () => ({ ...micToggle() });
phases.spec.body = () => ({ ...specFields(), ...(historyVisible && historyPanel()), ...(userPromptVisible && userPromptPanel()) });
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
		// await runE2ESimulation({ what: "Training data collection system that captures user accept/reject decisions on AI suggestions", why: "Enable automated learning from user feedback to improve suggestion accuracy over time", architecture: { dependencies: ["graph-db", "inference", "chrome-sync"], persistence: "indexeddb", context: ["extension-page"] } }, "I want to build a system to help train my AI from user feedback" ),
		// await runUnitTest("Workflow persistence roundtrip", async () => {
			// 	let actual = {};
		// 	await initializeTrainingModuleTest();
		// 	await updateWorkflow();
		// 	const savedId = workflowState.id;
		// 	actual.workflowSaved = !!savedId;
		// 	workflowState = getBlankWorkflowState(); renderUI();
		// 	actual.workflowCleared = !workflowState.id;
		// 	await loadWorkflow(savedId); renderUI();
		// 	actual.workflowLoaded = workflowState.id == savedId;
		// 	await deleteWorkflow(savedId); renderUI();
		// 	actual.recordNotInDB = !(await db('getRecord', savedId));
		// 	actual.workflowClearedAfterDelete = !workflowState.id;
		// 	return { actual, assert: deepEqual, expected: Object.keys(actual).reduce((obj, key) => ({ ...obj, [key]: true }), {}) };
		// })
		// await runUnitTest("LLM suggestion quality validation", async () => {
			// 	initializeTrainingModuleTest();
		// 	const suggestion = await generateSpecSuggestion();
		// 	const systemPrompt = `You are an expert evaluator of AI-generated software specifications.\n\nScore each suggestion 0-10 on:\n- Relevance: Does it address the user's transcripts?\n- Actionability: Is it specific and implementable?\n- Clarity: Is it well-articulated?\n\nOutput JSON: {"relevance": 0-10, "actionability": 0-10, "clarity": 0-10, "reasoning": "brief explanation"}`;
		// 	const query = `Spec State: ${JSON.stringify(workflowState.spec)}\nTranscripts: "${transcriptHistory.map(t => t.text).join(' ')}"\nSuggestion: ${JSON.stringify(suggestion)}`;
		// 	const evaluation = JSON.parse(await runtime.call('inference.prompt', { query, systemPrompt, model: { id: "openai/gpt-oss-20b" }, responseFormat: 'JSON' }));
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

const cleanupTest = () => async () => { workflowState = getBlankWorkflowState(); pendingChanges.clear(); workflowState.transcriptHistory = []; };
const initializeTrainingModuleTest = async () => {
	workflowState.transcriptHistory = [
		{ text: "I want to build a training module", timestamp: Date.now(), isFinal: true },
		{ text: "um maybe to collect user feedback on automatically taken actions by systems", timestamp: Date.now() + 10000, isFinal: true },
		{ text: " the real goal here is to collect training data so it can be a source of training these statistical and conditional and potentially even neural automation models to eventually run how I would run autonomously.", timestamp: Date.now() + 20000, isFinal: true }
	];
	workflowState.spec.what = "build a training module";
	renderUI();
}


export const runE2ESimulation = async (targetSpec, initialPrompt) => {
	const originalModel = model, originalWorkflow = JSON.parse(JSON.stringify(workflowState));
	const judgeModel = "meta-llama/llama-4-maverick-17b-128e-instruct";
	model = "llama-3.1-8b-instant";
	workflowState.spec = specDefault(); workflowState.transcriptHistory = [];
	await saveTranscripts(initialPrompt); await renderUI();
	
	const simulationLog = [], maxIterations = 15;
	let iterations = 0;
	
	try {
		while (iterations++ < maxIterations) {
			const suggestion = await generateSpecSuggestion();
			lastSuggestion = suggestion;
			pendingChanges.set(suggestion.field, { current: workflowState.spec[suggestion.field], proposed: suggestion.content, type: suggestion.type });
			await renderUI();
			
			const decision = await evaluateAgainstTarget(judgeModel, targetSpec, suggestion, workflowState.spec, workflowState.transcriptHistory);
			simulationLog.push({ iteration: iterations, suggestion, decision });
			log.info(`Iteration ${iterations}: ${decision.action} - ${decision.reasoning}`);
			
			if (decision.action === 'complete') break;
			decision.action === 'accept' ? await acceptSpecChange({ target: { dataset: { field: suggestion.field } } }) :
			decision.action === 'reject' ? await rejectSpecChange({ target: { dataset: { field: suggestion.field } } }) : (() => { throw new Error('Invalid action'); })();
			
			decision.nextUserInput && (await saveTranscripts(decision.nextUserInput), await renderUI());
			await wait(2000);
		}
		
		const matchResult = await calculateSpecSimilarity(targetSpec, workflowState.spec, judgeModel);
		model = originalModel;
		return { targetSpec, finalSpec: JSON.parse(JSON.stringify(workflowState.spec)), matchScore: matchResult.score, breakdown: matchResult, iterations, transcript: [...workflowState.transcriptHistory], simulationLog };
	} catch (error) {
		model = originalModel; workflowState = originalWorkflow; pendingChanges.clear(); await renderUI();
		log.error('E2E Simulation failed:', error);
		throw error;
	}
};

const evaluateAgainstTarget = async (model, target, suggestion, current, history) => {
	const systemPrompt = `You're a product owner working with an AI to detail a software spec through conversation.\n\nTARGET SPEC (your internal goal - what you ultimately want):\n${JSON.stringify(target, null, 2)}\n\nBEHAVIOR:\n- Accept AI suggestions that move the spec CLOSER to your target\n- Reject suggestions that are wrong/irrelevant\n- Provide next conversational input guiding toward missing pieces\n- Say "complete" when current spec captures 90%+ of target\n- Respond naturally as a product owner would, not robotically\n\nOUTPUT FORMAT (strict JSON):\n{\n  "action": "accept|reject|complete",\n  "reasoning": "brief explanation comparing to target",\n  "nextUserInput": "your next natural statement (omit if complete)"\n}`;
	const query = `CONVERSATION HISTORY:\n${history.slice(-10).join('\n')}\n\nCURRENT SPEC STATE:\n${JSON.stringify(current, null, 2)}\n\nAI JUST SUGGESTED:\n${JSON.stringify(suggestion, null, 2)}\n\nEvaluate this suggestion against your target and decide next step.`;
	return JSON.parse(await runtime.call('inference.prompt', { query, systemPrompt, model: { id: model }, responseFormat: 'JSON' }));
};

const calculateSpecSimilarity = async (target, current, judgeModel) => {
	const systemPrompt = `You grade how well a generated spec matches a target spec.\n\nScore 0-100 based on:\n- WHAT: Does it capture the same capability/feature?\n- WHY: Does it express the same user need/goal?\n- ARCHITECTURE: Are technical choices compatible?\n\nBe generous with wording differences, strict on missing concepts.\n\nOutput JSON:\n{\n  "score": 0-100,\n  "whatMatch": 0-100,\n  "whyMatch": 0-100,\n  "architectureMatch": 0-100,\n  "reasoning": "brief explanation of score"\n}`;
	const userPrompt = `TARGET SPEC:\n${JSON.stringify(target, null, 2)}\n\nGENERATED SPEC:\n${JSON.stringify(current, null, 2)}\n\nGrade how well the generated spec matches the target.`;
	return JSON.parse(await runtime.call('inference.prompt', { query: userPrompt, systemPrompt, model: { id: judgeModel }, responseFormat: 'JSON' }));
};