import { getId } from './helpers.js';
export const manifest = {
	name: "whiteboard",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Event-sourced whiteboard for ambient thought collection",
	dependencies: ["indexed-db", "graph-db"],
	actions: ["handleGlobalSelection", "handleWhiteboardClick", "updateItem", "markAtomic", "archiveWhiteboard", "createWhiteboard", "loadWhiteboard", "searchWhiteboards", "handleItemEdit", "toggleItemExpanded"],
	uiComponents: [{ name: "whiteboard-ui", getTree: "buildWhiteboardUI" }, { name: "whiteboard-picker", getTree: "buildWhiteboardPicker" }],
	commands: [{ name: "open whiteboard", keyword: "whiteboard", method: "openWhiteboard" }],
	indexeddb: {
		name: 'WhiteboardDB', version: 1,
		storeConfigs: [
			{ name: 'events', options: { keyPath: 'id' }, indexes: [{ name: 'by-whiteboard', keyPath: 'whiteboardId' }, { name: 'by-timestamp', keyPath: 'timestamp' }] },
			{ name: 'whiteboards', options: { keyPath: 'id' }, indexes: [{ name: 'by-timestamp', keyPath: 'lastModified' }] }
		]
	}
};

let runtime, log, currentBoard, pendingSelection, expandedItems = new Set(), allWhiteboards = [];
export const initialize = async (rt, l) => {
	runtime = rt; log = l;
	await loadRecentWhiteboard();
};

// === CORE STATE ===
const createEmptyBoard = () => ({ id: getId('wb-'), name: '', context: [], goals: [], solutions: [], atomic: new Set(), events: [], createdAt: Date.now(), lastModified: Date.now() });
const applyEvent = (state, event) => ({ ...state, ...eventHandlers[event.type](state, event.payload), lastModified: Date.now() });
const rebuildState = (events) => events.reduce(applyEvent, createEmptyBoard());

// === EVENT HANDLERS ===
const eventHandlers = {
	createContext: (state, { item }) => ({ context: [...state.context, item] }),
	appendToContext: (state, { itemId, text }) => ({ context: state.context.map(c => c.id === itemId ? { ...c, text: c.text + ' ' + text } : c) }),
	updateContext: (state, { itemId, text }) => ({ context: state.context.map(c => c.id === itemId ? { ...c, text } : c) }),
	deleteContext: (state, { itemId }) => ({ context: state.context.filter(c => c.id !== itemId) }),
	createGoal: (state, { item }) => ({ goals: [...state.goals, item] }),
	appendToGoal: (state, { itemId, text }) => ({ goals: state.goals.map(g => g.id === itemId ? { ...g, text: g.text + ' ' + text } : g) }),
	updateGoal: (state, { itemId, text }) => ({ goals: state.goals.map(g => g.id === itemId ? { ...g, text } : g) }),
	deleteGoal: (state, { itemId }) => ({ goals: state.goals.filter(g => g.id !== itemId) }),
	createSolution: (state, { item }) => ({ solutions: [...state.solutions, item] }),
	appendToSolution: (state, { itemId, text }) => ({ solutions: state.solutions.map(s => s.id === itemId ? { ...s, text: s.text + ' ' + text } : s) }),
	updateSolution: (state, { itemId, text }) => ({ solutions: state.solutions.map(s => s.id === itemId ? { ...s, text } : s) }),
	deleteSolution: (state, { itemId }) => ({ solutions: state.solutions.filter(s => s.id !== itemId) }),
	markAtomic: (state, { itemId, isAtomic }) => ({ atomic: isAtomic ? new Set([...state.atomic, itemId]) : new Set([...state.atomic].filter(id => id !== itemId)) }),
	updateName: (state, { name }) => ({ name })
};

// === EVENT OPERATIONS ===
const recordEvent = async (type, payload) => {
	const event = { id: getId('evt-'), type, payload, whiteboardId: currentBoard.id, timestamp: Date.now() };
	currentBoard = applyEvent(currentBoard, event);
	await runtime.call('indexed-db.addRecord', 'WhiteboardDB', 'events', event);
	await saveWhiteboardMeta();
	await refreshUI();
	return event;
};

const saveWhiteboardMeta = async () => await runtime.call('indexed-db.updateRecord', 'WhiteboardDB', 'whiteboards', { 
	id: currentBoard.id, name: currentBoard.name || 'Untitled', 
	summary: [...currentBoard.context, ...currentBoard.goals, ...currentBoard.solutions].map(i => i.text).join(' ').substring(0, 200),
	itemCount: currentBoard.context.length + currentBoard.goals.length + currentBoard.solutions.length,
	atomicCount: currentBoard.atomic.size, lastModified: currentBoard.lastModified, createdAt: currentBoard.createdAt 
});

// === WHITEBOARD MANAGEMENT ===
const loadRecentWhiteboard = async () => {
	const recent = await runtime.call('indexed-db.getByIndexCursor', 'WhiteboardDB', 'whiteboards', 'by-timestamp', 'prev', 1);
	recent.length > 0 ? await loadWhiteboard({ whiteboardId: recent[0].id }) : await createWhiteboard();
};

export const loadWhiteboard = async ({ whiteboardId }) => {
	const events = await runtime.call('indexed-db.getByIndex', 'WhiteboardDB', 'events', 'by-whiteboard', whiteboardId);
	currentBoard = events.length > 0 ? rebuildState(events.sort((a, b) => a.timestamp - b.timestamp)) : createEmptyBoard();
	currentBoard.id = whiteboardId;
	expandedItems.clear();
	pendingSelection = null;
	await refreshUI();
	log.log(` Loaded whiteboard ${whiteboardId} with ${events.length} events`);
};

export const searchWhiteboards = async ({ query }) => {
	allWhiteboards = await runtime.call('indexed-db.getByIndexCursor', 'WhiteboardDB', 'whiteboards', 'by-timestamp', 'prev', 50);
	const timeMatch = parseTimeQuery(query);
	return allWhiteboards.filter(wb => 
		(timeMatch ? wb.lastModified >= timeMatch : true) &&
		(query ? wb.name.toLowerCase().includes(query.toLowerCase()) || wb.summary.toLowerCase().includes(query.toLowerCase()) : true)
	);
};

const parseTimeQuery = (query) => {
	const now = Date.now(), patterns = {
		'yesterday': now - (24 * 60 * 60 * 1000), 'last week': now - (7 * 24 * 60 * 60 * 1000), 
		'this week': now - (7 * 24 * 60 * 60 * 1000), 'this month': new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime(),
		'this year': new Date(new Date().getFullYear(), 0, 1).getTime()
	};
	return Object.keys(patterns).find(p => query.toLowerCase().includes(p)) ? patterns[Object.keys(patterns).find(p => query.toLowerCase().includes(p))] : null;
};

// === EXPORTED ACTIONS ===
export const handleGlobalSelection = async ({ selectedText, sourceId, sourceType, fullSourceText }) => {
	pendingSelection = { text: selectedText, sourceId, sourceType, fullSourceText, timestamp: Date.now() };
	log.log(` Selection pending: "${selectedText.substring(0, 50)}..."`);
};

export const handleWhiteboardClick = async ({ target }) => {
	if (!pendingSelection) return;
	const { sectionType, itemId } = target.dataset;
	if (!sectionType) return;

	const item = { id: itemId || getId('item-'), text: pendingSelection.text, sourceId: pendingSelection.sourceId, sourceType: pendingSelection.sourceType, createdAt: Date.now() };
	const eventType = itemId ? `appendTo${sectionType.charAt(0).toUpperCase() + sectionType.slice(1)}` : `create${sectionType.charAt(0).toUpperCase() + sectionType.slice(1)}`;
	
	await recordEvent(eventType, itemId ? { itemId, text: pendingSelection.text } : { item });
	pendingSelection = null;
};

export const updateItem = async ({ target }) => {
	const { itemId, sectionType } = target.dataset;
	if (!itemId || !sectionType) return;
	await recordEvent(`update${sectionType.charAt(0).toUpperCase() + sectionType.slice(1)}`, { itemId, text: target.value });
};

export const handleItemEdit = async ({ target }) => await updateItem({ target });

export const markAtomic = async ({ target }) => {
	const itemId = target.closest('[data-item-id]')?.dataset.itemId;
	if (!itemId) return;
	await recordEvent('markAtomic', { itemId, isAtomic: target.checked });
};

export const toggleItemExpanded = async ({ target }) => {
	const itemId = target.dataset.itemId;
	expandedItems.has(itemId) ? expandedItems.delete(itemId) : expandedItems.add(itemId);
	await refreshUI();
};

export const createWhiteboard = async () => {
	currentBoard = createEmptyBoard();
	expandedItems.clear();
	pendingSelection = null;
	await runtime.call('indexed-db.addRecord', 'WhiteboardDB', 'whiteboards', { id: currentBoard.id, name: 'Untitled', summary: '', itemCount: 0, atomicCount: 0, lastModified: currentBoard.lastModified, createdAt: currentBoard.createdAt });
	await refreshUI();
	log.log(` Created whiteboard: ${currentBoard.id}`);
};

export const archiveWhiteboard = async () => {
	const atomicItems = [...currentBoard.context, ...currentBoard.goals, ...currentBoard.solutions].filter(item => currentBoard.atomic.has(item.id));
	
	// Create whiteboard summary node
	const summaryNodeId = await runtime.call('graph-db.addNode', {
		type: 'whiteboard', name: currentBoard.name || 'Untitled', 
		summary: atomicItems.map(i => i.text).join('. '), whiteboardId: currentBoard.id,
		itemCount: atomicItems.length, createdAt: currentBoard.createdAt
	});
	
	// Create atomic idea nodes and connect to whiteboard
	const nodeIds = [];
	for (const item of atomicItems) {
		const nodeId = await runtime.call('graph-db.addNode', {
			type: 'atomic-idea', text: item.text, 
			embedding: await runtime.call('embedding.embedText', item.text),
			metadata: { extractedAt: item.createdAt, sourceId: item.sourceId, sourceType: item.sourceType }
		});
		await runtime.call('graph-db.addEdge', { from: summaryNodeId, to: nodeId, type: 'contains' });
		nodeIds.push(nodeId);
	}
	
	log.log(` Archived ${atomicItems.length} atomic ideas from whiteboard ${currentBoard.id}`);
	return { summaryNodeId, nodeIds };
};

export const openWhiteboard = async () => await runtime.call('layout.addComponent', 'whiteboard-ui');

// === UI ===
const refreshUI = () => runtime.call('layout.renderComponent', 'whiteboard-ui');

export const buildWhiteboardUI = () => ({
	"whiteboard": {
		tag: "div", style: "display: flex; flex-direction: column; height: 100%; padding: 20px; gap: 20px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg-primary);",
		...buildWhiteboardHeader(),
		...buildWhiteboardSections()
	}
});

const buildWhiteboardHeader = () => ({
	"whiteboard-header": {
		tag: "div", style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;",
		"title-section": {
			tag: "div", style: "display: flex; align-items: center; gap: 10px;",
			"title-input": { tag: "input", type: "text", value: currentBoard.name || '', placeholder: "Whiteboard name...", style: "font-size: 18px; font-weight: 600; border: none; background: transparent; color: var(--text-primary); padding: 4px;", events: { blur: "whiteboard.updateName" } },
			"picker-btn": { tag: "button", text: "📋", class: "cognition-button-secondary", style: "padding: 4px 8px;", events: { click: "whiteboard.showPicker" }, title: "Switch whiteboard" }
		},
		"actions": {
			tag: "div", style: "display: flex; gap: 10px;",
			"archive-btn": { tag: "button", text: `Archive (${currentBoard.atomic.size})`, class: "cognition-button-primary", events: { click: "whiteboard.archiveWhiteboard" }, disabled: currentBoard.atomic.size === 0 },
			"new-btn": { tag: "button", text: "New", class: "cognition-button-secondary", events: { click: "whiteboard.createWhiteboard" } }
		}
	}
});

const buildWhiteboardSections = () => ({
	"whiteboard-sections": {
		tag: "div", style: "display: flex; flex-direction: column; gap: 20px; flex: 1; min-height: 0;",
		...buildSection('Context', 'context', currentBoard.context),
		...buildSection('Goals', 'goals', currentBoard.goals),
		...buildSection('Solutions', 'solutions', currentBoard.solutions)
	}
});

const buildSection = (title, sectionType, items) => ({
	[`${sectionType}-section`]: {
		tag: "div", 
		style: "border: 1px solid var(--border-primary); border-radius: 8px; background: var(--bg-secondary); min-height: 120px;",
		"data-section-type": sectionType,
		events: { click: "whiteboard.handleWhiteboardClick" },
		"section-header": { tag: "div", style: "padding: 12px 15px; border-bottom: 1px solid var(--border-primary); background: var(--bg-tertiary);", "section-title": { tag: "h4", text: `${title} (${items.length})`, style: "margin: 0; font-size: 14px; color: var(--text-primary);" } },
		"section-content": { tag: "div", style: "padding: 15px; min-height: 80px;", ...buildSectionItems(sectionType, items) }
	}
});

const buildSectionItems = (sectionType, items) => items.length === 0 ? { "empty-hint": { tag: "div", style: "color: var(--text-muted); font-style: italic; text-align: center; padding: 20px 0;", text: `Select text from any source and click here to add ${sectionType}` } } : Object.fromEntries(
	items.map((item, i) => [`${sectionType}-item-${i}`, {
		tag: "div", 
		style: `margin: 8px 0; padding: 12px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid ${currentBoard.atomic.has(item.id) ? 'var(--accent-primary)' : 'transparent'};`,
		"data-item-id": item.id, "data-section-type": sectionType,
		...buildItemControls(item, i),
		...buildItemText(item, sectionType, expandedItems.has(item.id))
	}])
);

const buildItemControls = (item, index) => ({
	"item-controls": {
		tag: "div", style: "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;",
		"atomic-checkbox": { tag: "input", type: "checkbox", checked: currentBoard.atomic.has(item.id), events: { change: "whiteboard.markAtomic" }, title: "Mark as atomic for archiving" },
		"expand-btn": { tag: "button", text: expandedItems.has(item.id) ? "↑" : "↓", class: "cognition-button-secondary", style: "padding: 2px 6px; font-size: 10px;", events: { click: "whiteboard.toggleItemExpanded" }, "data-item-id": item.id },
		"item-meta": { tag: "div", style: "flex: 1; font-size: 10px; color: var(--text-muted);", text: `${new Date(item.createdAt).toLocaleTimeString()} • ${item.sourceType || 'manual'}` }
	}
});

const buildItemText = (item, sectionType, isExpanded) => ({
	"item-text": isExpanded ? {
		tag: "textarea", value: item.text, 
		style: "width: 100%; min-height: 80px; padding: 8px; border: 1px solid var(--border-primary); border-radius: 4px; background: var(--bg-input); resize: vertical; font-family: inherit;",
		"data-item-id": item.id, "data-section-type": sectionType,
		events: { blur: "whiteboard.handleItemEdit" }
	} : {
		tag: "div", style: "line-height: 1.4; color: var(--text-primary); cursor: pointer;", 
		text: item.text.length > 100 ? item.text.substring(0, 100) + '...' : item.text,
		events: { click: "whiteboard.toggleItemExpanded" }, "data-item-id": item.id
	}
});

export const buildWhiteboardPicker = async () => {
	const whiteboards = await searchWhiteboards({ query: '' });
	return {
		"whiteboard-picker": {
			tag: "div", style: "padding: 20px; height: 100%; display: flex; flex-direction: column; background: var(--bg-secondary);",
			"picker-header": { tag: "h3", text: "Select Whiteboard", style: "margin: 0 0 15px 0;" },
			"search-input": { tag: "input", type: "text", placeholder: "Search whiteboards or try 'last week', 'yesterday'...", style: "width: 100%; padding: 8px; margin-bottom: 15px; border: 1px solid var(--border-primary); border-radius: 4px;", events: { input: "whiteboard.searchWhiteboards" } },
			"whiteboard-list": { tag: "div", style: "flex: 1; overflow-y: auto;", ...buildWhiteboardList(whiteboards) }
		}
	};
};

const buildWhiteboardList = (whiteboards) => whiteboards.length === 0 ? { "empty": { tag: "div", text: "No whiteboards found", style: "text-align: center; color: var(--text-muted); padding: 40px;" } } : Object.fromEntries(
	whiteboards.map(wb => [`wb-${wb.id}`, {
		tag: "div", 
		style: `padding: 12px; margin: 5px 0; border: 1px solid var(--border-primary); border-radius: 6px; cursor: pointer; ${wb.id === currentBoard.id ? 'background: var(--bg-tertiary);' : ''}`,
		events: { click: "whiteboard.loadWhiteboardFromPicker" }, "data-whiteboard-id": wb.id,
		"wb-name": { tag: "div", text: wb.name, style: "font-weight: 500; margin-bottom: 4px;" },
		"wb-summary": { tag: "div", text: wb.summary || 'Empty whiteboard', style: "font-size: 12px; color: var(--text-muted); margin-bottom: 4px;" },
		"wb-meta": { tag: "div", text: `${wb.itemCount} items • ${wb.atomicCount} atomic • ${new Date(wb.lastModified).toLocaleDateString()}`, style: "font-size: 10px; color: var(--text-muted);" }
	}])
);

// === TESTING ===
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	
	return [
		await runUnitTest("Create empty whiteboard", async () => {
			const board = createEmptyBoard();
			const actual = { hasId: !!board.id, context: board.context.length, goals: board.goals.length, solutions: board.solutions.length, hasAtomic: board.atomic instanceof Set };
			return { actual, assert: deepEqual, expected: { hasId: true, context: 0, goals: 0, solutions: 0, hasAtomic: true } };
		}),
		
		await runUnitTest("Event application creates context", async () => {
			const state = createEmptyBoard();
			const event = { type: 'createContext', payload: { item: { id: 'test-1', text: 'Test context', createdAt: Date.now() } } };
			const newState = applyEvent(state, event);
			const actual = { contextCount: newState.context.length, firstContextText: newState.context[0]?.text, lastModifiedUpdated: newState.lastModified > state.lastModified };
			return { actual, assert: deepEqual, expected: { contextCount: 1, firstContextText: 'Test context', lastModifiedUpdated: true } };
		}),
		
		await runUnitTest("Atomic marking toggles correctly", async () => {
			const state = { ...createEmptyBoard(), context: [{ id: 'item-1', text: 'Test' }] };
			const markEvent = { type: 'markAtomic', payload: { itemId: 'item-1', isAtomic: true } };
			const unmarkEvent = { type: 'markAtomic', payload: { itemId: 'item-1', isAtomic: false } };
			const marked = applyEvent(state, markEvent);
			const unmarked = applyEvent(marked, unmarkEvent);
			const actual = { marked: marked.atomic.has('item-1'), unmarked: unmarked.atomic.has('item-1') };
			return { actual, assert: deepEqual, expected: { marked: true, unmarked: false } };
		}),
		
		await runUnitTest("Append event adds text to existing item", async () => {
			const state = { ...createEmptyBoard(), goals: [{ id: 'goal-1', text: 'Original goal' }] };
			const appendEvent = { type: 'appendToGoal', payload: { itemId: 'goal-1', text: 'additional text' } };
			const updated = applyEvent(state, appendEvent);
			const actual = updated.goals[0].text;
			return { actual, assert: strictEqual, expected: 'Original goal additional text' };
		}),
		
		await runUnitTest("Time query parsing works correctly", async () => {
			const now = Date.now();
			const yesterday = parseTimeQuery('show me whiteboards from yesterday');
			const lastWeek = parseTimeQuery('last week stuff');
			const noMatch = parseTimeQuery('random query');
			const actual = { hasYesterday: yesterday && yesterday < now, hasLastWeek: lastWeek && lastWeek < now, noMatch: noMatch === null };
			return { actual, assert: deepEqual, expected: { hasYesterday: true, hasLastWeek: true, noMatch: true } };
		})
	];
};