import { getId } from './helpers.js';

export const manifest = {
	name: "whiteboard",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Ambient AI thought collection with event-sourced whiteboard",
	dependencies: ["indexed-db", "graph-db", "web-speech-stt", "inference"],
	actions: ["handleSelection", "handleKeypress", "addContext", "addGoal", "createSolutionThread",
		"markAtomic", "archiveWhiteboard", "loadWhiteboard", "searchGraph", "triggerAI",
		"getState", "getEvents", "createWhiteboard"],
	uiComponents: [{ name: "whiteboard-ui", getTree: "buildWhiteboardUI" }],
	commands: [
		{ name: "open whiteboard", keyword: "whiteboard", method: "openWhiteboard" }
	],
	indexeddb: {
		name: 'WhiteboardDB',
		version: 1,
		storeConfigs: [
			{
				name: 'events', options: { keyPath: 'id' },
				indexes: [
					{ name: 'by-whiteboard', keyPath: 'whiteboardId' },
					{ name: 'by-timestamp', keyPath: 'timestamp' }
				]
			},
			{
				name: 'sources', options: { keyPath: 'id' },
				indexes: [{ name: 'by-whiteboard', keyPath: 'whiteboardId' }]
			},
			{
				name: 'training', options: { keyPath: 'id' },
				indexes: [{ name: 'by-type', keyPath: 'type' }]
			}
		]
	},
	config: {
		autoSearch: { type: 'checkbox', value: true, label: 'Auto-search graph on new transcript' },
		aiTriggerWords: { type: 'string', value: 'AI,assistant,help', label: 'AI trigger words (comma-separated)' }
	}
};

let runtime, log, currentWhiteboardId, currentState, pendingExtraction;

export const initialize = async (rt, l) => {
	runtime = rt;
	log = l;
	await createWhiteboard(); // Start with empty whiteboard
	listenForTranscripts();
};

// === WHITEBOARD MANAGEMENT ===
export const createWhiteboard = async (parentId = null) => {
	currentWhiteboardId = getId('wb-');
	currentState = {
		id: currentWhiteboardId,
		parentId,
		context: [],
		goals: [],
		solutionThreads: [],
		sources: [],
		atomicIds: new Set(), // Track which items are marked atomic
		createdAt: Date.now()
	};
	log.log(` Created whiteboard: ${currentWhiteboardId}`);
	return currentWhiteboardId;
};

export const loadWhiteboard = async (whiteboardId) => {
	const events = await runtime.call('indexed-db.getByIndex', 'WhiteboardDB', 'events', 'by-whiteboard', whiteboardId);
	currentWhiteboardId = whiteboardId;
	currentState = rebuildState(events);
	await refreshUI();
	log.log(` Loaded whiteboard: ${whiteboardId} with ${events.length} events`);
};

// === EVENT HANDLING ===
const applyEvent = async (event) => {
	event.id = getId('evt-');
	event.timestamp = Date.now();
	event.whiteboardId = currentWhiteboardId;

	updateState(event);
	await runtime.call('indexed-db.addRecord', 'WhiteboardDB', 'events', event);

	// Record training data for AI suggestions
	if (event.type === 'aiSuggestion') {
		await recordTraining({
			type: 'suggestion',
			whiteboardState: getStateText(),
			suggestion: event.payload.suggestion,
			wasAccepted: event.payload.accepted,
			timestamp: Date.now()
		});
	}

	await refreshUI();
};

const updateState = (event) => {
	switch (event.type) {
		case 'addContext':
			currentState.context.push(event.payload.item);
			break;
		case 'addGoal':
			currentState.goals.push(event.payload.item);
			break;
		case 'createSolutionThread':
			currentState.solutionThreads.push(event.payload.thread);
			break;
		case 'markAtomic':
			if (event.payload.isAtomic) {
				currentState.atomicIds.add(event.payload.itemId);
			} else {
				currentState.atomicIds.delete(event.payload.itemId);
			}
			break;
		case 'editItem':
			const item = findItemById(event.payload.itemId);
			if (item) {
				item.text = event.payload.newText;
				recordTraining({
					type: 'extraction',
					originalText: event.payload.originalText,
					editedText: event.payload.newText,
					wasEdited: true
				});
			}
			break;
	}
};

const rebuildState = (events) => {
	// const state = createEmptyState();
	// events.forEach(event => updateState.call({ currentState: state }, event));
	// return state;
};

// === EXTRACTION FLOW ===
export const handleSelection = async (selection) => {
	pendingExtraction = {
		text: selection.text,
		sourceId: selection.sourceId,
		sourceType: selection.sourceType
	};
	log.log(` Selection pending: "${selection.text.substring(0, 50)}..."`);
};

export const handleKeypress = async (event) => {
	if (!pendingExtraction) return;

	const keyMap = {
		'c': 'context',
		'g': 'goals',
		's': 'solution'
	};

	const target = keyMap[event.key.toLowerCase()];
	if (!target) return;

	const item = {
		id: getId('item-'),
		text: pendingExtraction.text,
		sourceId: pendingExtraction.sourceId,
		sourceType: pendingExtraction.sourceType,
		extractedAt: Date.now()
	};

	if (target === 'context') {
		await applyEvent({ type: 'addContext', payload: { item } });
	} else if (target === 'goals') {
		await applyEvent({ type: 'addGoal', payload: { item } });
	} else if (target === 'solution') {
		// Create new thread or add to active one
		const activeThread = currentState.solutionThreads.find(t => t.status === 'active');
		if (activeThread) {
			activeThread.steps.push({
				id: getId('step-'),
				text: item.text,
				order: activeThread.steps.length,
				completed: false
			});
		} else {
			await applyEvent({
				type: 'createSolutionThread',
				payload: {
					thread: {
						id: getId('thread-'),
						name: 'New Solution',
						steps: [{ id: getId('step-'), text: item.text, order: 0 }],
						status: 'active'
					}
				}
			});
		}
	}

	pendingExtraction = null;
	await recordTraining({
		type: 'extraction',
		sourceText: item.text,
		targetArea: target,
		wasEdited: false
	});
};

// === TRANSCRIPT INTEGRATION ===
const listenForTranscripts = () => {
	runtime.moduleState.addListener(async (module, state, data) => {
		if (module !== 'web-speech-stt' || !data?.chunk?.isFinal) return;

		const chunk = data.chunk;
		await addSource({
			type: 'transcript',
			text: chunk.text,
			startTime: chunk.startTime,
			endTime: chunk.endTime
		});

		// Check for AI triggers
		const triggers = manifest.config.aiTriggerWords.value.split(',').map(t => t.trim());
		if (triggers.some(trigger => chunk.text.toLowerCase().includes(trigger.toLowerCase()))) {
			await triggerAI(chunk.text);
		}

		// Auto-search graph
		if (manifest.config.autoSearch.value) {
			await searchGraph(chunk.text);
		}
	});
};

// === AI INTEGRATION ===
export const triggerAI = async (input) => {
	const stateText = getStateText();
	const prompt = `Given whiteboard state and input, suggest ONE most relevant action:
    State: ${stateText}
    Input: "${input}"
    
    Respond with JSON: { action: "context"|"goal"|"solution", text: "suggested text", reasoning: "why" }`;

	const response = await runtime.call('inference.prompt', { query: prompt });
	const suggestion = JSON.parse(response);

	await applyEvent({
		type: 'aiSuggestion',
		payload: {
			suggestion: suggestion.text,
			action: suggestion.action,
			reasoning: suggestion.reasoning,
			accepted: false // Will be updated if user accepts
		}
	});

	// Show in UI for acceptance
	// await showAISuggestion(suggestion);
};

export const searchGraph = async (text) => {
	const related = await runtime.call('graph-db.searchByText', text, 0.7);
	if (related.length > 0) {
		log.log(` Found ${related.length} related ideas`);
		// Add as sources for user to extract from
		for (const node of related.slice(0, 3)) { // Top 3
			await addSource({
				type: 'graph',
				graphNodeId: node.id,
				text: node.text || node.content
			});
		}
	}
};

// === MARKING & ARCHIVING ===
export const markAtomic = async (itemId, isAtomic = true) => {
	await applyEvent({
		type: 'markAtomic',
		payload: { itemId, isAtomic }
	});
};

export const archiveWhiteboard = async () => {
	const atomicItems = [
		...currentState.context.filter(c => currentState.atomicIds.has(c.id)),
		...currentState.goals.filter(g => currentState.atomicIds.has(g.id)),
		...currentState.solutionThreads.flatMap(t =>
			t.steps.filter(s => currentState.atomicIds.has(s.id))
		)
	];

	log.log(` Archiving ${atomicItems.length} atomic ideas from ${currentState.atomicIds.size} marked`);

	const nodeIds = [];
	for (const item of atomicItems) {
		const nodeId = await runtime.call('graph-db.addNode', {
			type: 'atomic-idea',
			text: item.text,
			sourceWhiteboardId: currentWhiteboardId,
			embedding: await runtime.call('embedding.embedText', item.text)
		});
		nodeIds.push(nodeId);
	}

	log.log(` Created ${nodeIds.length} graph nodes`);
	return nodeIds;
};

// === UTILITIES ===
const addSource = async (source) => {
	source.id = getId('src-');
	source.whiteboardId = currentWhiteboardId;
	currentState.sources.push(source);
	await runtime.call('indexed-db.addRecord', 'WhiteboardDB', 'sources', source);
	await refreshUI();
};

const findItemById = (id) => {
	return currentState.context.find(c => c.id === id) ||
		currentState.goals.find(g => g.id === id) ||
		currentState.solutionThreads.flatMap(t => t.steps).find(s => s.id === id);
};

const getStateText = () => [
	...currentState.context.map(c => c.text),
	...currentState.goals.map(g => g.text),
	...currentState.solutionThreads.flatMap(t => t.steps.map(s => s.text))
].join(' ');

const recordTraining = async (data) => {
	data.id = getId('train-');
	await runtime.call('indexed-db.addRecord', 'WhiteboardDB', 'training', data);
};

const refreshUI = () => runtime.call('layout.renderComponent', 'whiteboard-ui');

// === UI ===
export const buildWhiteboardUI = () => ({
	"whiteboard": {
		tag: "div",
		style: "display: grid; grid-template-columns: 400px 1fr; height: 100%; gap: 10px;",

		"sources-panel": {
			tag: "div",
			style: "overflow-y: auto; padding: 10px; border-right: 1px solid var(--border-primary);",
			"sources-title": { tag: "h3", text: `Sources (${currentState.sources.length})` },
			...buildSources()
		},

		"board-panel": {
			tag: "div",
			style: "display: flex; flex-direction: column; padding: 20px; gap: 20px;",
			"context-section": buildSection('Context', currentState.context, 'context'),
			"goals-section": buildSection('Goals', currentState.goals, 'goals'),
			"solutions-section": buildSolutions(),
			"actions": {
				tag: "div",
				style: "display: flex; gap: 10px; padding-top: 20px;",
				"archive-btn": {
					tag: "button",
					text: `Archive (${currentState.atomicIds.size} atomic)`,
					class: "cognition-button-primary",
					events: { click: "whiteboard.archiveWhiteboard" }
				},
				"new-btn": {
					tag: "button",
					text: "New Whiteboard",
					class: "cognition-button-secondary",
					events: { click: "whiteboard.createWhiteboard" }
				}
			}
		}
	}
});

const buildSources = () => Object.fromEntries(
	currentState.sources.map((source, i) => [`source-${i}`, {
		tag: "div",
		style: `padding: 8px; margin: 5px 0; border-left: 3px solid ${source.type === 'transcript' ? '#4CAF50' :
			source.type === 'graph' ? '#2196F3' : '#FF9800'
			}; background: var(--bg-tertiary); cursor: text;`,
		"data-source-id": source.id,
		"data-source-type": source.type,
		text: source.text,
		events: { mouseup: "whiteboard.handleSelection" }
	}])
);

const buildSection = (title, items, type) => ({
	tag: "div",
	style: "border: 1px solid var(--border-primary); padding: 15px; border-radius: 8px;",
	"section-title": { tag: "h4", text: `${title} (${items.length})` },
	...Object.fromEntries(
		items.map((item, i) => [`${type}-${i}`, {
			tag: "div",
			style: `padding: 8px; margin: 5px 0; display: flex; align-items: center; gap: 10px; 
              ${currentState.atomicIds.has(item.id) ? 'background: rgba(76, 175, 80, 0.1);' : ''}`,
			"checkbox": {
				tag: "input",
				type: "checkbox",
				checked: currentState.atomicIds.has(item.id),
				events: {
					change: `whiteboard.markAtomic:${item.id}`
				}
			},
			"text": {
				tag: "div",
				text: item.text,
				style: "flex: 1;"
			}
		}])
	)
});

const buildSolutions = () => ({
	tag: "div",
	style: "border: 1px solid var(--border-primary); padding: 15px; border-radius: 8px;",
	"section-title": { tag: "h4", text: `Solutions (${currentState.solutionThreads.length})` },
	...Object.fromEntries(
		currentState.solutionThreads.map((thread, i) => [`thread-${i}`, {
			tag: "div",
			style: "margin: 10px 0;",
			"thread-name": { tag: "h5", text: thread.name },
			...Object.fromEntries(
				thread.steps.map((step, j) => [`step-${j}`, {
					tag: "div",
					style: `padding: 5px 0 5px 20px; ${step.completed ? 'text-decoration: line-through;' : ''}`,
					text: `${j + 1}. ${step.text}`
				}])
			)
		}])
	)
});

// === DEV EXPORTS ===
export const getState = () => currentState;
export const getEvents = async (whiteboardId = currentWhiteboardId) =>
	await runtime.call('indexed-db.getByIndex', 'WhiteboardDB', 'events', 'by-whiteboard', whiteboardId);
export const openWhiteboard = async () => {
	await runtime.call('layout.addComponent', 'whiteboard-ui');
};