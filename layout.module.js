import { configProxy } from './config.module.js';

export const manifest = {
	name: "layout",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Component layout system with keyboard navigation and expansion - DOM persistent",
	permissions: ["storage"],
	dependencies: ["chrome-sync", "tree-to-dom", "config"],
	actions: ["renderComponent", "addComponentFromPicker", "enterLayoutMode", "exitLayoutMode", "cycleMode", "contractComponent"],
	commands: [
		{ name: "layout mode", keyword: "layout", method: "enterLayoutMode" }
	],
	config: {
		gridSize: { type: 'number', min: 1, max: 20, value: 5, label: 'Grid Snap Size (%)' },
		defaultComponentWidth: { type: 'number', min: 10, max: 90, value: 30, label: 'Default Component Width (%)' },
		defaultComponentHeight: { type: 'number', min: 10, max: 90, value: 20, label: 'Default Component Height (%)' },
		keySequenceTimeout: { type: 'number', min: 500, max: 5000, value: 2000, label: 'Key Sequence Timeout (ms)' }
	}
};

let runtime, componentStates = new Map(), registrations = new Map(), layoutContainer = null, renderedComponents = new Set(), keySequence = [];

// Layout mode state
let layoutModeActive = false;
const modes = [
	{ name: 'move', icon: '📱', description: 'Move component' },
	{ name: 'expand', icon: '➕', description: 'Expand component' },
	{ name: 'contract', icon: '➖', description: 'Contract component' }
];
let currentModeIndex = 0;

const config = configProxy(manifest);
const defaultState = { x: 0, y: 0, width: 30, height: 20, savedPosition: null, isSelected: false, isMaximized: false, isLoading: false, moduleName: null, zIndex: 1 };

export const initialize = async (rt) => {
	runtime = rt;
	runtime.moduleState.addListener(handleModuleStateChange);
	await discoverComponents();
	await loadComponentStates();
	await initializeLayoutContainer();
	await refreshUI('initialization');
	setupKeyboardHandlers();
};

// === LAYOUT MODE SYSTEM ===
export const enterLayoutMode = async () => {
	layoutModeActive = true;
	currentModeIndex = 0; // Start with move mode
	await addModeSelector();
	runtime.log('[Layout] Entered layout mode');
};

export const exitLayoutMode = async () => {
	layoutModeActive = false;
	await removeModeSelector();
	runtime.log('[Layout] Exited layout mode');
};

export const cycleMode = async () => {
	if (!layoutModeActive) return;
	currentModeIndex = (currentModeIndex + 1) % modes.length;
	await updateModeSelector();
	runtime.log(`[Layout] Mode: ${modes[currentModeIndex].name}`);
};

const addModeSelector = async () => {
	if (!componentStates.has('_mode-selector')) {
		componentStates.set('_mode-selector', {
			...defaultState,
			x: 85, y: 5, width: 12, height: 15,
			isTemporary: true,
			zIndex: 9999
		});
		await refreshUI('component-added');
	}
};

const removeModeSelector = async () => {
	if (componentStates.has('_mode-selector')) {
		componentStates.delete('_mode-selector');
		await refreshUI('component-removed');
	}
};

const updateModeSelector = async () => {
	if (componentStates.has('_mode-selector')) {
		await renderComponent('_mode-selector');
	}
};

// === CONTRACT FUNCTIONALITY ===
export const contractComponent = async (direction) => {
	const selected = getSelectedComponent();
	if (!selected) return;

	const contractAmount = config.gridSize;
	let newPos = { ...selected };

	switch (direction) {
		case 'ArrowUp':
			newPos.height = Math.max(config.gridSize, newPos.height - contractAmount);
			break;
		case 'ArrowDown':
			newPos.height = Math.max(config.gridSize, newPos.height - contractAmount);
			newPos.y = Math.min(100 - newPos.height, newPos.y + contractAmount);
			break;
		case 'ArrowLeft':
			newPos.width = Math.max(config.gridSize, newPos.width - contractAmount);
			break;
		case 'ArrowRight':
			newPos.width = Math.max(config.gridSize, newPos.width - contractAmount);
			newPos.x = Math.min(100 - newPos.width, newPos.x + contractAmount);
			break;
	}

	await updateComponent(selected.name, normalizePosition(newPos));
	runtime.log(`[Layout] Contracted ${selected.name} ${direction}`);
};

// === Z-INDEX MANAGEMENT ===
const bringToFront = (componentName) => {
	const state = getComponentState(componentName);
	state.zIndex = 1000; // Selected components come to front

	// Reset others to background
	for (const [name, otherState] of componentStates) {
		if (name !== componentName && !name.startsWith('_')) {
			otherState.zIndex = 1;
		}
	}
};

// === DISCOVERY & REGISTRATION ===
const discoverComponents = async () => runtime.getModulesWithProperty('uiComponents').forEach(module => module.manifest.uiComponents.forEach(comp => {
	registrations.set(comp.name, { ...comp, moduleName: module.manifest.name });
	runtime.actions.set(`${module.manifest.name}.${comp.getTree}`, module[comp.getTree]);
}));

const handleModuleStateChange = async (moduleName, newState) => {
	const changedComponents = Array.from(componentStates)
		.filter(([, state]) => {
			const wasLoading = state.isLoading;
			state.isLoading = (newState !== 'ready');
			return state.moduleName === moduleName && wasLoading !== state.isLoading;
		})
		.map(([name]) => name);

	if (changedComponents.length > 0) await refreshUI('state-change', changedComponents);
};

// === KEYBOARD HANDLER ===
const setupKeyboardHandlers = () => document.addEventListener('keydown', handleKeyboard);

const handleKeyboard = async (e) => {
	const activeElement = document.activeElement;
	if (activeElement && ['INPUT', 'TEXTAREA'].includes(activeElement.tagName)) return;

	const maximized = getMaximizedComponent(), selected = getSelectedComponent();

	// Layout mode specific handling
	if (layoutModeActive) {
		if (e.key === 'Escape') {
			e.preventDefault();
			return await exitLayoutMode();
		}

		if (e.key === 'Tab') {
			e.preventDefault();
			if (e.shiftKey) {
				return await cycleMode();
			} else {
				return await cycleSelection();
			}
		}

		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selected) {
			e.preventDefault();
			const currentMode = modes[currentModeIndex].name;

			if (currentMode === 'move') {
				await moveSelectedComponent(e.key);
			} else if (currentMode === 'expand') {
				await expandSelectedComponent(e.key);
			} else if (currentMode === 'contract') {
				await contractComponent(e.key);
			}
			return;
		}
		return; // In layout mode, consume all other keys
	}

	// Normal mode handling
	if (maximized && (await handleComponentKeys(maximized.name, e))) return;
	return handleLayoutKeys(e);
};

const handleComponentKeys = async (name, event) => {
	const keyMap = registrations.get(name)?.keyMap;
	const handler = keyMap?.[event.code] || keyMap?.[event.key];
	if (handler) {
		event.preventDefault();
		const [action, param] = handler.split(':');
		await runtime.call(action, param);
		return true;
	}
	return false;
};

const handleLayoutKeys = async (e) => {
	const maximized = getMaximizedComponent(), selected = getSelectedComponent();

	// Compound key detection 
	if (e.ctrlKey && e.key === 'a') {
		e.preventDefault();
		keySequence = ['ctrl+a'];
		setTimeout(() => keySequence = [], config.keySequenceTimeout);
		return;
	}
	if (keySequence.includes('ctrl+a') && e.ctrlKey && e.key === 'c') {
		e.preventDefault();
		await showComponentPicker();
		keySequence = [];
		return;
	}

	// Basic navigation
	if (e.key === 'Escape') {
		e.preventDefault()
		if (componentStates.has('_component-picker')) {
			componentStates.delete('_component-picker');
			return await refreshUI('component-removed');
		}
		return maximized ? await restoreMaximized() : selected && await clearSelections();
	}
	if (e.key === 'Tab') return (e.preventDefault(), await cycleSelection());
	if (e.key === 'Enter' && selected && !maximized) return (e.preventDefault(), await maximizeSelected());
};

// === MOVEMENT METHODS ===
const moveSelectedComponent = async (direction) => {
	const selected = getSelectedComponent();
	if (!selected) return;

	const moveAmount = config.gridSize;
	let newPos = { ...selected };

	switch (direction) {
		case 'ArrowUp':
			newPos.y = Math.max(0, newPos.y - moveAmount);
			break;
		case 'ArrowDown':
			newPos.y = Math.min(100 - newPos.height, newPos.y + moveAmount);
			break;
		case 'ArrowLeft':
			newPos.x = Math.max(0, newPos.x - moveAmount);
			break;
		case 'ArrowRight':
			newPos.x = Math.min(100 - newPos.width, newPos.x + moveAmount);
			break;
	}

	await updateComponent(selected.name, normalizePosition(newPos));
};

const expandSelectedComponent = async (direction) => {
	const selected = getSelectedComponent();
	if (!selected) return;

	const expandAmount = config.gridSize;
	let newPos = { ...selected };

	switch (direction) {
		case 'ArrowUp':
			newPos.height += expandAmount;
			newPos.y = Math.max(0, newPos.y - expandAmount);
			break;
		case 'ArrowDown':
			newPos.height += expandAmount;
			break;
		case 'ArrowLeft':
			newPos.width += expandAmount;
			newPos.x = Math.max(0, newPos.x - expandAmount);
			break;
		case 'ArrowRight':
			newPos.width += expandAmount;
			break;
	}

	await updateComponent(selected.name, normalizePosition(newPos));
};

// === LAYOUT CONTAINER ===
const initializeLayoutContainer = async () => {
	layoutContainer = document.createElement('div');
	layoutContainer.className = 'cognition-layout-container';
	layoutContainer.style.cssText = 'position: relative; width: 100vw; height: 100vh; overflow: hidden; background: var(--bg-primary, #000);';
	document.body.appendChild(layoutContainer);
};

const cleanupRemovedComponents = async () => {
	const activeNames = new Set([...componentStates.keys()]);
	const elementsToRemove = [];
	layoutContainer.querySelectorAll('[data-component]').forEach(element => {
		const name = element.dataset.component;
		if (!activeNames.has(name)) {
			elementsToRemove.push(element);
			renderedComponents.delete(name);
		}
	});
	elementsToRemove.forEach(el => el.remove());
};

// === COMPONENT RENDERING ===
export const renderComponent = async (name) => {
	const element = getOrCreateComponentElementContainer(name);
	let contentEl = getOrCreateComponentContentContainer(element);
	try {
		const tree = await getComponentTree(name);
		await runtime.call('tree-to-dom.transform', tree, contentEl);
		renderedComponents.add(name);
	} catch (error) {
		contentEl.innerHTML = `<div style="padding: 10px; color: var(--danger, #ff6b6b);">Error loading ${name}: ${error.message}</div>`;
	}
};

const getComponentTree = async (name) => {
	if (name === '_component-picker') return buildComponentPickerTree();
	if (name === '_mode-selector') return buildModeSelectorTree();
	const reg = registrations.get(name);
	if (!reg) return { tag: "div", text: `Component ${name} not found` };
	try { return await runtime.call(`${reg.moduleName}.${reg.getTree}`); }
	catch (error) { return { tag: "div", text: `Error loading ${name}: ${error.message}` }; }
};

const buildModeSelectorTree = () => {
	const currentMode = modes[currentModeIndex];
	return {
		tag: "div",
		style: "display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.9); color: white; border: 2px solid var(--accent-primary); border-radius: 8px; cursor: pointer;",
		events: { click: "layout.cycleMode" },
		"mode-icon": {
			tag: "div",
			style: "font-size: 24px; margin-bottom: 4px;",
			text: currentMode.icon
		},
		"mode-name": {
			tag: "div",
			style: "font-size: 10px; text-align: center; text-transform: uppercase; font-weight: bold;",
			text: currentMode.name
		},
		"mode-hint": {
			tag: "div",
			style: "font-size: 8px; text-align: center; color: #888; margin-top: 2px;",
			text: "Tab: cycle"
		}
	};
};

const getComponentElementContainer = (name) => layoutContainer.querySelector(`[data-component="${name}"]`);

const getOrCreateComponentElementContainer = (name) => {
	const state = getComponentState(name);
	let element = getComponentElementContainer(name);
	if (!element) {
		element = document.createElement('div');
		element.dataset.component = name;
		layoutContainer.appendChild(element);
	}
	element.className = `layout-component ${state.isSelected ? 'selected' : ''} ${state.isMaximized ? 'maximized' : ''}`;
	setElementStyles(element, state);
	return element;
}

const setElementStyles = (element, state) => {
	element.style.cssText = `
		position: absolute; 
		left: ${state.x}%; 
		top: ${state.y}%; 
		width: ${state.width}%; 
		height: ${state.height}%; 
		border: ${state.isSelected ? '2px solid var(--accent-primary, #007acc)' : '1px solid var(--border-primary, #333)'}; 
		background: var(--bg-secondary, #1a1a1a); 
		border-radius: 4px; 
		overflow: hidden; 
		z-index: ${state.zIndex || 1};
		${state.isLoading ? 'opacity: 0.5;' : ''}
		box-sizing: border-box;
	`;
};

const getOrCreateComponentContentContainer = (element) => {
	let contentEl = element.querySelector('.component-content');
	if (!contentEl) {
		contentEl = document.createElement('div');
		contentEl.className = 'component-content';
		contentEl.style.cssText = 'width: 100%; height: 100%; overflow: hidden;';
		element.appendChild(contentEl);
	}
	return contentEl;
}

const renderAllComponents = async () => {
	await cleanupRemovedComponents();
	getAllActiveComponents().forEach(comp => renderComponent(comp.name));
};

const renderChangedComponents = (changedComponents) => getAllActiveComponents()
	.filter(comp => changedComponents ? changedComponents.includes(comp.name) : true)
	.forEach((comp) => {
		const element = getComponentElementContainer(comp.name);
		if (element) setElementStyles(element, comp);
	});

const refreshUI = async (reason, changedComponents) => {
	if (['initialization', 'component-added', 'component-removed'].includes(reason)) await renderAllComponents();
	else if (['position-change', 'selection-change', 'state-change'].includes(reason)) await renderChangedComponents(changedComponents);
	else await renderAllComponents();
};

// === STATE MANAGEMENT ===
const getComponentState = (name) => componentStates.has(name) ? componentStates.get(name) : componentStates.set(name, { ...defaultState, moduleName: registrations.get(name)?.moduleName || null }).get(name);

const updateComponent = async (name, changes) => {
	const normalized = normalizePosition({ ...getComponentState(name), ...changes });
	Object.assign(getComponentState(name), normalized);
	await saveComponentStates();
	await refreshUI('position-change', [name]);
};

export const addComponent = async (name, position = {}) => {
	if (!registrations.has(name)) throw new Error(`Component ${name} not registered`);
	if (componentStates.has(name)) throw new Error(`Component ${name} already added`);
	componentStates.set(name, {
		...defaultState,
		x: position.x ?? 10 + (componentStates.size * 5),
		y: position.y ?? 20 + (componentStates.size * 5),
		width: position.width ?? config.defaultComponentWidth,
		height: position.height ?? config.defaultComponentHeight,
		moduleName: registrations.get(name).moduleName
	});
	await saveComponentStates();
	await refreshUI('component-added');
};

const getAllActiveComponents = () => [...componentStates.entries()].map(([name, state]) => ({ name, ...state }));

// === PERSISTENCE ===
const loadComponentStates = async () => {
	const saved = await runtime.call('chrome-sync.get', 'layout.componentStates');
	saved ? Object.entries(saved).forEach(([name, state]) => componentStates.set(name, { ...defaultState, ...state })) : applyDefaultLayout();
	for (const [name, state] of componentStates) state.moduleName && (state.isLoading = runtime.getState(state.moduleName) !== 'ready');
};

const saveComponentStates = async () => await runtime.call('chrome-sync.set', { 'layout.componentStates': Object.fromEntries([...componentStates].map(([name, state]) => [name, state])) });

const applyDefaultLayout = () => registrations.has('command-input') && componentStates.set('command-input', { ...defaultState, x: 0, y: 0, width: 100, height: 20, moduleName: registrations.get('command-input').moduleName });

// === GRID & POSITIONING ===
const snapToGrid = (value) => Math.round(value / config.gridSize) * config.gridSize;
const normalizePosition = ({ x, y, width, height }) => ({ x: snapToGrid(Math.max(0, Math.min(x, 100 - width))), y: snapToGrid(Math.max(0, Math.min(y, 100 - height))), width: snapToGrid(Math.max(config.gridSize, Math.min(width, 100 - x))), height: snapToGrid(Math.max(config.gridSize, Math.min(height, 100 - y))) });

// === COMPONENT PICKER ===
export const showComponentPicker = async () => {
	const available = [...registrations.keys()].filter(name => !componentStates.has(name));
	if (available.length === 0) return runtime.log('[Layout] No components available');
	componentStates.set('_component-picker', { ...defaultState, ...maximizedState, isTemporary: true, zIndex: 9999 });
	await refreshUI('component-added');
};

export const buildComponentPickerTree = () => ({
	tag: "div",
	style: "display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); color: white;",
	"picker-title": { tag: "h2", text: "Add Component", style: "margin-bottom: 30px;" },
	"picker-grid": {
		tag: "div",
		style: "display: grid; grid-template-columns: repeat(3, 200px); gap: 15px;",
		...Object.fromEntries([...registrations.keys()].filter(name => !componentStates.has(name))
			.map(name => [`add-${name}`, { tag: "button", text: name, class: "cognition-button-primary", style: "padding: 20px; font-size: 16px;", events: { click: "layout.addComponentFromPicker" }, "data-component": name }])
		)
	},
});

export const addComponentFromPicker = async (eventData) => {
	const componentName = eventData.target.dataset.component;
	componentStates.delete('_component-picker');
	await addComponent(componentName);
};

// === COMPONENT SELECTION ===
const cycleSelection = async () => {
	const active = getAllActiveComponents().filter(comp => !comp.name.startsWith('_')); // Exclude temp components
	if (active.length === 0) return;
	const currentIndex = active.findIndex(comp => comp.isSelected);
	const nextName = active[(currentIndex + 1) % active.length].name;

	for (const [name, state] of componentStates) {
		state.isSelected = (name === nextName);
	}

	if (nextName) bringToFront(nextName);
	await saveComponentStates();
	await refreshUI('selection-change');
};

const clearSelections = async () => {
	let hasChanges = false;
	for (const [, state] of componentStates) state.isSelected && (state.isSelected = false, hasChanges = true);
	if (hasChanges) {
		await saveComponentStates();
		await refreshUI('selection-change');
	}
};

const getSelectedComponent = () => getAllActiveComponents().find(comp => comp.isSelected);

// === MAXIMIZE/RESTORE ===
const maximizedState = { x: 0, y: 0, width: 100, height: 100, isMaximized: true };

const maximizeSelected = async () => {
	const selected = getAllActiveComponents().find(comp => comp.isSelected);
	if (!selected || selected.isMaximized) return;
	const state = getComponentState(selected.name);
	state.savedPosition = { x: state.x, y: state.y, width: state.width, height: state.height };
	await updateComponent(selected.name, maximizedState);
};

const restoreMaximized = async () => {
	const maximized = getMaximizedComponent();
	maximized?.savedPosition && await updateComponent(maximized.name, { ...maximized.savedPosition, isMaximized: false, savedPosition: null });
};

const getMaximizedComponent = () => getAllActiveComponents().find(comp => comp.isMaximized);

// === TESTING ===
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Layout mode state management", async () => {
			await enterLayoutMode();
			const actual = { modeActive: layoutModeActive, hasModeSelector: componentStates.has('_mode-selector') };
			await exitLayoutMode();
			const expected = { modeActive: true, hasModeSelector: true };
			return { actual, assert: deepEqual, expected };
		}),
		await runUnitTest("Mode cycling functionality", async () => {
			await enterLayoutMode();
			const initialMode = currentModeIndex;
			await cycleMode();
			const actual = { modeChanged: currentModeIndex !== initialMode, validIndex: currentModeIndex < modes.length };
			await exitLayoutMode();
			return { actual, assert: deepEqual, expected: { modeChanged: true, validIndex: true } };
		}),
		await runUnitTest("Z-index management", async () => {
			componentStates.set('test1', { ...defaultState, zIndex: 1 });
			componentStates.set('test2', { ...defaultState, zIndex: 1 });
			bringToFront('test1');
			const actual = { test1Front: getComponentState('test1').zIndex === 1000, test2Back: getComponentState('test2').zIndex === 1 };
			componentStates.delete('test1'), componentStates.delete('test2');
			return { actual, assert: deepEqual, expected: { test1Front: true, test2Back: true } };
		}),
		await runUnitTest("Contract functionality", async () => {
			const testComp = { x: 20, y: 20, width: 40, height: 30, isSelected: true };
			componentStates.set('test-contract', testComp);
			await contractComponent('ArrowRight');
			const actual = getComponentState('test-contract').width < 40;
			componentStates.delete('test-contract');
			return { actual, assert: strictEqual, expected: true };
		})
	];
};