import { configProxy } from "./config.module.js";
import { Recording } from "./audio-recording.module.js";

export const manifest = {
	name: "thought-partner",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Voice-activated conversational turns with task logging and trigger word detection",
	permissions: ["idle"],
	dependencies: ["chrome-local", "indexed-db", "inference", "audio-recording", "tts"],
	actions: ["togglePower", "buildButton", "addTask", "getTasks", "deleteTask", "startTask", "pauseTask", "resumeTask", "completeTask", "cancelTask", "switchTask", "getActiveTask", "getCurrentSessionDuration"],
	uiComponents: [
		{ name: "thought-partner-button", getTree: "buildButton", zLayer: "SYSTEM" },
		{ name: "task-list", getTree: "buildTaskList" }
	],
	config: {
		model: { type: 'select', value: 'groq/llama-3.1-8b-instant', label: 'Model', options: [], onChange: 'populateModelOptions' },
		systemPrompt: { type: 'textarea', value: `You are a conversational assistant. Respond with JSON:\n{\n  "shouldRespond": true/false,\n  "intention": "clarifying|suggesting|connecting|questioning",\n  "response": "actual response text under 30 words",\n  "reasoning": "why you chose this approach"\n}`, label: 'System Prompt', rows: 6 },
		queryTemplate: { type: 'textarea', value: "Context: {{transcript}}\n\nRespond:", label: 'Query Template (use {{transcript}})', rows: 3 },
		toggleKey: { type: 'globalKey', value: 'Ctrl+Shift+X', label: 'Toggle Listening', action: 'togglePower' },
		
	},
	indexeddb: {
		name: 'ThoughtPartnerDB',
		version: 2,
		storeConfigs: [
			{ name: 'turns', options: { keyPath: 'id', autoIncrement: true }, indexes: [{ name: 'by-timestamp', keyPath: 'timestamp' }] },
			{ name: 'tasks', options: { keyPath: 'id', autoIncrement: true }, indexes: [{ name: 'by-timestamp', keyPath: 'createdAt' }, { name: 'by-status', keyPath: 'status' }] }
		]
	}
};

let runtime, log, state = null, currentTurn = {}, turns = [], audioContext = null;
let currentTask = null, currentTaskText = '';
const triggers = ['what do you think', 'any ideas', 'your turn', 'go time', 'lets hear it'];
const config = configProxy(manifest);

export const initialize = async (rt, l) => {
	runtime = rt; log = l;
	turns = await loadTurns();
	await populateModelOptions();
	setupAudio();
};

export const populateModelOptions = async () => manifest.config.model.options = await runtime.call('inference.getAllAvailableModels');

// === TASK CLASS ===
export class Task {
	id; text; status; sessions; createdAt; completedAt;
	constructor(data) { Object.assign(this, data); this.sessions = this.sessions || []; }
	get totalDuration() { return this.sessions.reduce((sum, s) => sum + (s.end ? s.end - s.start : Date.now() - s.start), 0) / 1000; }
	get activeSession() { return this.sessions.find(s => !s.end); }
	startSession(note) { this.sessions.push({ start: Date.now(), note }); this.status = 'active'; }
	endSession() { const session = this.activeSession; if (session) session.end = Date.now(); }
}

// === TASK PERSISTENCE ===
const taskDb = async (method, ...args) => await runtime.call(`indexed-db.${method}`, 'ThoughtPartnerDB', 'tasks', ...args);
const toPlain = (t) => {
	const plain = { text: t.text, status: t.status, sessions: t.sessions, createdAt: t.createdAt };
	if (t.id !== undefined) plain.id = t.id;
	if (t.completedAt !== undefined) plain.completedAt = t.completedAt;
	return plain;
};
const saveTask = async (task) => task.id ? (await taskDb('updateRecord', toPlain(task)), task) : new Task({ ...task, id: await taskDb('addRecord', toPlain(task)) });
const loadTasks = async (limit = 50) => (await taskDb('getByIndexCursor', 'by-timestamp', 'prev', limit).catch(() => [])).map(t => new Task(t));
const findTaskByQuery = async (query) => {
	const tasks = await loadTasks();
	if (!tasks.length) return null;
	try {
		const numbered = tasks.map((t, i) => `${i + 1}. ${t.text} (${t.status})`).join('\n');
		const prompt = `User query: "${query}"\n\nTasks:\n${numbered}\n\nWhich task number matches best? Respond ONLY with valid JSON: {"taskNumber": N} where N is 1-${tasks.length}, or {"taskNumber": null} if no match.`;
		const systemPrompt = 'You return JSON with a single field "taskNumber" containing an integer or null. Example: {"taskNumber": 3}';
		
		log.log('Task selection query:', prompt);
		const response = await runtime.call('inference.prompt', { query: prompt, systemPrompt, responseFormat: 'JSON' });
		log.log('Task selection response:', response);
		
		const parsed = JSON.parse(response);
		return parsed.taskNumber ? tasks[parsed.taskNumber - 1] : null;
	} catch (e) { log.error('Task selection failed:', e); return null; }
};

// === TASK CRUD ===
export const addTask = async (text) => await saveTask(new Task({ text, status: 'paused', createdAt: Date.now() }));
export const getTasks = async (limit) => await loadTasks(limit);
export const deleteTask = async (id) => {
	if (!currentTask) return;
	await taskDb('removeRecord', id).then(() => true).catch(() => false);
	await speak(`Deleted ${currentTask.text}`);
	currentTask = null;
	await refreshTaskList();
}

// === TASK WORK MANAGEMENT ===
export const startTask = async (description) => {
	if (currentTask) await pauseTask();
	const task = await addTask(description);
	task.startSession();
	currentTask = await saveTask(task);
	await speak(`Starting ${task.text}`);
	await refreshTaskList();
	return currentTask;
};
export const pauseTask = async () => {
	if (!currentTask) return null;
	currentTask.endSession();
	currentTask.status = 'paused';
	await saveTask(currentTask);
	await speak(`Pausing ${currentTask.text}`);
	const paused = currentTask;
	currentTask = null;
	await refreshTaskList();
	return paused;
};
export const resumeTask = async () => {
	const tasks = await loadTasks();
	const lastPaused = tasks.filter(t => t.status === 'paused').sort((a, b) => (b.sessions[b.sessions.length - 1]?.end || 0) - (a.sessions[a.sessions.length - 1]?.end || 0))[0];
	if (!lastPaused) return null;
	if (currentTask) await pauseTask();
	lastPaused.startSession();
	currentTask = await saveTask(lastPaused);
	await speak(`Resuming ${currentTask.text}`);
	await refreshTaskList();
	return currentTask;
};
export const completeTask = async () => {
	if (!currentTask) return false;
	currentTask.endSession();
	currentTask.status = 'completed';
	currentTask.completedAt = Date.now();
	await saveTask(currentTask);
	await speak(`Completed ${currentTask.text}`);
	currentTask = null;
	await refreshTaskList();
	return true;
};
export const cancelTask = async () => {
	if (!currentTask) return false;
	currentTask.endSession();
	currentTask.status = 'cancelled';
	await saveTask(currentTask);
	await speak(`Cancelled ${currentTask.text}`);
	currentTask = null;
	await refreshTaskList();
	return true;
};
export const switchTask = async (description) => {
	(await loadTasks()).find(t => t.text === description);
	const found = (await loadTasks()).find(t => t.text === description) ?? await findTaskByQuery(description);
	if (found) {
		if (currentTask) await pauseTask();
		found.startSession();
		currentTask = await saveTask(found);
		await speak(`Switching to ${currentTask.text}`);
		await refreshTaskList();
		return currentTask;
	}
	return await startTask(description);
};

// === TASK ANALYTICS ===
export const getActiveTask = () => currentTask;
export const getCurrentSessionDuration = () => currentTask?.activeSession ? Math.round((Date.now() - currentTask.activeSession.start) / 1000 / 60) : 0;
export const getCurrentTaskName = () => currentTask ? currentTask.text : 'no active task';

// === TURN LOGIC ===
const getResponse = async () => {
	const llmRequest = { model: config.model.split('/')[1], systemPrompt: config.systemPrompt, query: inject(config.queryTemplate, { transcript: currentTurn.stt.transcript }), responseFormat: 'JSON' };
	const response = await runtime.call('inference.prompt', llmRequest);
	const parsed = JSON.parse(response);
	currentTurn.llm = { ...llmRequest, response, parsed };
	return parsed.response;
};
const inject = (template, vars) => Object.entries(vars).reduce((str, [k, v]) => str.replaceAll(`{{${k}}}`, v), template);
const createTurn = () => ({ timestamp: Date.now(), stt: null, llm: null, tts: null, feedback: null });
const startTurn = async () => { state = 'input'; currentTurn = createTurn(); await listen(); };
const completeTurn = async () => { await stopListening(); turns.push(currentTurn); await saveTurn(); await startTurn(); signal(); };

// === HANDLERS (TASKS FIRST, THEN THOUGHT PARTNER) ===
const handleChunk = async (chunk) => {
	if (!chunk.finalizedAt) return;
	log.log("Received chunk:", chunk);
	for (const h of [...taskHandlers, ...thoughtPartnerHandlers]) {
		if (h.condition(chunk)) {
			try { await h.func(chunk); log.log(`${h.name} triggered`); }
			catch (e) { log.error(`Handler "${h.name}" failed:`, e); }
			log.log(`handled by: ${h.name}`);
		}
	}
};

const taskHandlers = [
	{ name: "start task", condition: (c) => c.text.toLowerCase().startsWith('start task'), func: async (c) => await startTask(c.text.replace(/^start task\s*/i, '').trim()) },
	{ name: "pause task", condition: (c) => c.text.toLowerCase().startsWith('stop task'), func: async () => await pauseTask() },
	{ name: "resume task", condition: (c) => c.text.toLowerCase().startsWith('resume task'), func: async () => await resumeTask() },
	{ name: "delete task", condition: (c) => c.text.toLowerCase().startsWith('delete task'), func: async () => await deleteTask() },
	{ name: "complete task", condition: (c) => c.text.toLowerCase().startsWith('complete task'), func: async () => await completeTask() },
	{ name: "cancel task", condition: (c) => c.text.toLowerCase().startsWith('cancel task'), func: async () => await cancelTask() },
	{ name: "switch task", condition: (c) => c.text.toLowerCase().startsWith('switch task'), func: async (c) => await switchTask(c.text.replace(/^switch task\s*/i, '').trim()) },
	{ name: "how long", condition: (c) => c.text.toLowerCase().includes('how long'), func: async () => await speak(`${getCurrentSessionDuration()} minutes`) },
	{ name: "current task", condition: (c) => c.text.toLowerCase().startsWith('current task'), func: async () => await speak(!!currentTask ? `${getCurrentSessionDuration()} minutes on ${getCurrentTaskName()}` : 'no active task') },
];

const thoughtPartnerHandlers = [
	{ name: "start response", condition: (c) => state === 'input' && triggers.some(t => c.text.toLowerCase().includes(t)), func: async () => { state = 'response_done'; await stopListening(); const text = await getResponse(); currentTurn.tts = await runtime.call('tts.speak', text); await saveTurn(); await listen(); } },
	{ name: "start feedback", condition: (c) => state === 'response_done' && c.text.toLowerCase().startsWith('feedback'), func: async () => { state = 'feedback'; await saveTurn(); } },
	{ name: "non-feedback after response", condition: (c) => state === 'response_done' && !c.text.toLowerCase().startsWith('feedback'), func: async () => await completeTurn() },
	{ name: "new turn end feedback", condition: (c) => state === 'feedback' && c.text.toLowerCase().includes('end feedback'), func: async (c) => { currentTurn.feedback = (currentTurn.feedback || '') + ' ' + c.text.replace(/end feedback/i, '').trim(); await completeTurn(); } }
];

// === AUDIO ===
const listen = async () => await runtime.call('audio-recording.startRecording', { onTranscript: handleChunk });
const stopListening = async () => { currentTurn.stt = await runtime.call('audio-recording.stopRecording'); };
const speak = async (text) => await runtime.call('tts.speak', text);
const setupAudio = () => audioContext = new (window.AudioContext || window["webkitAudioContext"])();
const signal = () => beep(440, 100);
const beep = (freq, duration) => { const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.frequency.value = freq; gain.gain.setValueAtTime(0.1, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000); osc.connect(gain).connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + duration / 1000); };

// === TURN PERSISTENCE ===
const turnDb = async (method, ...args) => await runtime.call(`indexed-db.${method}`, 'ThoughtPartnerDB', 'turns', ...args);
const saveState = async () => await runtime.call('chrome-local.set', { 'thought-partner.state': state });
const getState = async () => await runtime.call('chrome-local.get', 'thought-partner.state');
const loadTurns = async () => (await turnDb('getByIndexCursor', 'by-timestamp', 'prev', 50).catch(() => [])).map(t => ({ ...t, stt: t.stt ? new Recording(t.stt) : null }));
const saveTurn = async () => currentTurn.id ? await turnDb('updateRecord', currentTurn) : (currentTurn.id = await turnDb('addRecord', currentTurn));

// === UI ===
const refresh = async () => await runtime.call('layout.renderComponent', 'thought-partner-button');
export const buildButton = async () => ({ "power-button": { tag: "button", text: state === 'log_task' ? "🟡" : state === 'feedback' ? "🟠" : state === 'response_done' ? "🔵" : state === 'input' ? "🟢" : "⚫", class: "cognition-button", events: { click: "thought-partner.togglePower" } } });
const refreshTaskList = async () => {
	try { await runtime.call('layout.renderComponent', 'task-list'); }
	catch (e) { /* Component might not be added yet */ }
};
export const buildTaskList = async () => {
	const tasks = await loadTasks();
	return {
		"task-list": {
			tag: "div",
			style: "padding: 20px; overflow-y: auto; height: 100%;",
			"title": { tag: "h3", text: "Tasks", style: "margin-bottom: 15px;" },
			"table": {
				tag: "table",
				style: "width: 100%; border-collapse: collapse; font-size: 14px;",
				"thead": {
					tag: "thead",
					"header-row": {
						tag: "tr",
						style: "border-bottom: 2px solid var(--border-primary);",
						"th-status": { tag: "th", text: "Status", style: "text-align: left; padding: 8px;" },
						"th-task": { tag: "th", text: "Task", style: "text-align: left; padding: 8px;" },
						"th-duration": { tag: "th", text: "Duration", style: "text-align: right; padding: 8px;" },
						"th-sessions": { tag: "th", text: "Sessions", style: "text-align: right; padding: 8px;" },
						"th-created": { tag: "th", text: "Created", style: "text-align: right; padding: 8px;" }
					}
				},
				"tbody": {
					tag: "tbody",
					...Object.fromEntries(tasks.map((task, i) => [`row-${i}`, {
						tag: "tr",
						style: "border-bottom: 1px solid var(--border-primary);",
						"td-status": { tag: "td", text: currentTask?.id === task.id ? "current" : task.status, style: "padding: 8px;" },
						"td-task": { tag: "td", text: task.text, style: "padding: 8px;" },
						"td-duration": { tag: "td", text: `${Math.round(task.totalDuration / 60)}m`, style: "text-align: right; padding: 8px;" },
						"td-sessions": { tag: "td", text: task.sessions.length, style: "text-align: right; padding: 8px;" },
						"td-created": { tag: "td", text: new Date(task.createdAt).toLocaleDateString(), style: "text-align: right; padding: 8px;" }
					}]))
				}
			}
		}
	};
};
// === POWER ===
export const togglePower = async () => {
	if (state) { await stopListening(); state = null; currentTurn = null; }
	else { await startTurn(); }
	await saveState(); await refresh();
};