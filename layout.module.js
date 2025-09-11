import { configProxy } from './config.module.js';

export const manifest = {
	name: "layout",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Component layout system with z-layers, mode overlays, and window snapping",
	permissions: ["storage"],
	dependencies: ["chrome-sync", "tree-to-dom", "config"],
	actions: ["renderComponent", "addComponentFromPicker", "cycleMode", "contractComponent", "showComponentPicker", "addComponent", "togglePin", "snapToHalf"],
	commands: [
		{ name: "add component", keyword: "add", method: "showComponentPicker" }
	],
	config: {
		gridSize: { type: 'number', min: 1, max: 20, value: 5, label: 'Grid Snap Size (%)' },
		defaultComponentWidth: { type: 'number', min: 10, max: 90, value: 30, label: 'Default Component Width (%)' },
		defaultComponentHeight: { type: 'number', min: 10, max: 90, value: 20, label: 'Default Component Height (%)' },
		keySequenceTimeout: { type: 'number', min: 500, max: 5000, value: 2000, label: 'Key Sequence Timeout (ms)' },
		overlayOpacity: { type: 'number', min: 0.05, max: 0.3, value: 0.15, label: 'Mode Overlay Opacity' }
	}
};

let runtime, componentStates = new Map(), registrations = new Map(), layoutContainer = null, renderedComponents = new Set(), keySequence = [], modeOverlay = null;

// Z-Index layer system
const Z_LAYERS = {
	SYSTEM: 9999,     // Mode indicator, pickers, system UI
	PINNED: 3000,     // Always-on-top modules  
	ACTIVE: 2000,     // Currently selected component
	NORMAL: 1000      // Regular components
};

// Mode system
const modes = [
	{ name: 'select', icon: '👆', description: 'Select components', pattern: '👆'.repeat(200) },
	{ name: 'move', icon: '📱', description: 'Move component', pattern: '↕️↔️'.repeat(500) },
	{ name: 'expand', icon: '➕', description: 'Expand component', pattern: '➕'.repeat(300) },
	{ name: 'contract', icon: '➖', description: 'Contract component', pattern: '➖'.repeat(300) }
];
let currentModeIndex = 0;

const config = configProxy(manifest);
const defaultState = {
	x: 0, y: 0, width: 30, height: 20,
	savedPosition: null, isSelected: false, isMaximized: false, isLoading: false,
	moduleName: null, zLayer: 'normal', isPinned: false, zIndex: Z_LAYERS.NORMAL
};

export const initialize = async (rt) => {
	runtime = rt;

	// Reset browser defaults - fix the overflow issue
	document.body.style.margin = '0';
	document.body.style.padding = '0';
	document.documentElement.style.margin = '0';
	document.documentElement.style.padding = '0';

	runtime.moduleState.addListener(handleModuleStateChange);
	await discoverComponents();
	await loadComponentStates();
	await initializeLayoutContainer();
	await addPersistentModeIndicator();
	await refreshUI('initialization');
	setupKeyboardHandlers();
};

// === MODE SYSTEM ===
export const cycleMode = async () => {
	currentModeIndex = (currentModeIndex + 1) % modes.length;
	await updateModeIndicator();
	await showModeOverlay();
	runtime.log(`[Layout] Mode: ${modes[currentModeIndex].name}`);
};

const addPersistentModeIndicator = async () => {
	componentStates.set('_mode-indicator', {
		...defaultState,
		x: 85, y: 2, width: 12, height: 8,
		isTemporary: true, zLayer: 'system', zIndex: Z_LAYERS.SYSTEM
	});
};

const updateModeIndicator = async () => {
	if (componentStates.has('_mode-indicator')) {
		await renderComponent('_mode-indicator');
	}
};

// === MODE OVERLAY SYSTEM ===
const showModeOverlay = async () => {
	removeModeOverlay();
	const mode = modes[currentModeIndex];

	modeOverlay = document.createElement('div');
	modeOverlay.className = 'mode-overlay';
	modeOverlay.style.cssText = `
		position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
		background: rgba(0,0,0,${config.overlayOpacity}); 
		color: rgba(255,255,255,0.1);
		font-size: 24px; line-height: 1; word-break: break-all;
		pointer-events: none; z-index: ${Z_LAYERS.SYSTEM + 1}; 
		font-family: monospace; overflow: hidden;
	`;
	modeOverlay.textContent = mode.pattern;
	document.body.appendChild(modeOverlay);

	// Auto-hide after 2 seconds
	setTimeout(removeModeOverlay, 2000);
};

const removeModeOverlay = () => {
	if (modeOverlay) {
		modeOverlay.remove();
		modeOverlay = null;
	}
};

// === SNAP TO HALF FUNCTIONALITY ===
export const snapToHalf = async (direction) => {
	const selected = getSelectedComponent();
	if (!selected) return;

	const positions = {
		'ArrowLeft': { x: 0, y: 0, width: 50, height: 100 },
		'ArrowRight': { x: 50, y: 0, width: 50, height: 100 },
		'ArrowUp': { x: 0, y: 0, width: 100, height: 50 },
		'ArrowDown': { x: 0, y: 50, width: 100, height: 50 }
	};

	await updateComponent(selected.name, positions[direction]);
	runtime.log(`[Layout] Snapped ${selected.name} to ${direction.replace('Arrow', '').toLowerCase()} half`);
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
const updateComponentZIndex = (componentName) => {
	const state = getComponentState(componentName);

	// Set z-index based on layer and selection
	if (state.zLayer === 'system') {
		state.zIndex = Z_LAYERS.SYSTEM;
	} else if (state.isPinned) {
		state.zIndex = Z_LAYERS.PINNED;
	} else if (state.isSelected) {
		state.zIndex = Z_LAYERS.ACTIVE;
	} else {
		state.zIndex = Z_LAYERS.NORMAL;
	}
};

const bringToFront = (componentName) => {
	// Update all components' z-indexes
	for (const [name] of componentStates) {
		updateComponentZIndex(name);
	}

	// Selected component gets active layer
	const state = getComponentState(componentName);
	if (!state.isPinned && state.zLayer !== 'system') {
		state.zIndex = Z_LAYERS.ACTIVE;
	}
};

export const togglePin = async (componentName) => {
	const state = getComponentState(componentName || getSelectedComponent()?.name);
	if (!state || state.zLayer === 'system') return;

	state.isPinned = !state.isPinned;
	updateComponentZIndex(state.name);
	await saveComponentStates();
	await refreshUI('position-change', [componentName]);
	runtime.log(`[Layout] ${state.isPinned ? 'Pinned' : 'Unpinned'} ${componentName}`);
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

	const maximized = getMaximizedComponent();
	const selected = getSelectedComponent();
	const currentMode = modes[currentModeIndex].name;

	// Global shortcuts
	if (e.altKey && e.shiftKey && e.key === ' ') {
		e.preventDefault();
		return await cycleMode();
	}

	// Shift+Direction = Snap to half screen
	if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
		e.preventDefault();
		return await snapToHalf(e.key);
	}

	// Component-specific shortcuts for maximized components
	if (maximized && (await handleComponentKeys(maximized.name, e))) return;

	// Mode-specific handling
	if (currentMode === 'select') {
		if (e.key === 'Tab') {
			e.preventDefault();
			return await cycleSelection();
		}
		if (e.key === 'Enter' && selected && !maximized) {
			e.preventDefault();
			return await maximizeSelected();
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			return maximized ? await restoreMaximized() : await clearSelections();
		}
		if (e.key === 'p' && selected) {
			e.preventDefault();
			return await togglePin(selected.name);
		}
		return;
	}

	// Move/Expand/Contract modes - arrows do layout actions
	if (['move', 'expand', 'contract'].includes(currentMode)) {
		if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selected) {
			e.preventDefault();
			if (currentMode === 'move') {
				await moveSelectedComponent(e.key);
			} else if (currentMode === 'expand') {
				await expandSelectedComponent(e.key);
			} else if (currentMode === 'contract') {
				await contractComponent(e.key);
			}
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			return maximized ? await restoreMaximized() : await clearSelections();
		}
	}

	// Handle component picker
	if (componentStates.has('_component-picker')) {
		if (e.key === 'Escape') {
			e.preventDefault();
			componentStates.delete('_component-picker');
			return await refreshUI('component-removed');
		}
	}

	// Compound key detection for component picker
	return handleCompoundKeys(e);
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

const handleCompoundKeys = async (e) => {
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
	if (name === '_mode-indicator') return buildModeIndicatorTree();
	const reg = registrations.get(name);
	if (!reg) return { tag: "div", text: `Component ${name} not found` };
	try { return await runtime.call(`${reg.moduleName}.${reg.getTree}`); }
	catch (error) { return { tag: "div", text: `Error loading ${name}: ${error.message}` }; }
};

const buildModeIndicatorTree = () => {
	const currentMode = modes[currentModeIndex];
	return {
		"mode-display": {
			tag: "div",
			style: "display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); color: white; border: 1px solid var(--border-primary); border-radius: 4px; font-size: 16px; cursor: pointer; width: 100%; height: 100%;",
			events: { click: "layout.cycleMode" },
			text: currentMode.icon,
			title: `${currentMode.description} (Alt+Shift+Space: cycle modes)`
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
	element.className = `layout-component ${state.isSelected ? 'selected' : ''} ${state.isMaximized ? 'maximized' : ''} ${state.isPinned ? 'pinned' : ''}`;
	setElementStyles(element, state);
	return element;
}

const setElementStyles = (element, state) => {
	const borderColor = state.isPinned ? 'var(--accent-secondary, #ff6b6b)' :
		state.isSelected ? 'var(--accent-primary, #007acc)' :
			'var(--border-primary, #333)';

	element.style.cssText = `
		position: absolute; 
		left: ${state.x}%; 
		top: ${state.y}%; 
		width: ${state.width}%; 
		height: ${state.height}%; 
		border: ${state.isSelected || state.isPinned ? '2px' : '1px'} solid ${borderColor}; 
		background: var(--bg-secondary, #1a1a1a); 
		border-radius: 4px; 
		overflow: hidden; 
		z-index: ${state.zIndex};
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
	updateComponentZIndex(name);
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
	for (const [name, state] of componentStates) {
		state.moduleName && (state.isLoading = runtime.getState(state.moduleName) !== 'ready');
		updateComponentZIndex(name);
	}
};

const saveComponentStates = async () => await runtime.call('chrome-sync.set', { 'layout.componentStates': Object.fromEntries([...componentStates].filter(([name]) => !name.startsWith('_')).map(([name, state]) => [name, state])) });

const applyDefaultLayout = () => registrations.has('command-input') && componentStates.set('command-input', { ...defaultState, x: 0, y: 0, width: 100, height: 20, moduleName: registrations.get('command-input').moduleName });

// === GRID & POSITIONING ===
const snapToGrid = (value) => Math.round(value / config.gridSize) * config.gridSize;
const normalizePosition = ({ x, y, width, height }) => ({ x: snapToGrid(Math.max(0, Math.min(x, 100 - width))), y: snapToGrid(Math.max(0, Math.min(y, 100 - height))), width: snapToGrid(Math.max(config.gridSize, Math.min(width, 100 - x))), height: snapToGrid(Math.max(config.gridSize, Math.min(height, 100 - y))) });

// === COMPONENT PICKER ===
export const showComponentPicker = async () => {
	const available = [...registrations.keys()].filter(name => !componentStates.has(name));
	if (available.length === 0) return runtime.log('[Layout] No components available');
	componentStates.set('_component-picker', { ...defaultState, x: 20, y: 20, width: 60, height: 60, isTemporary: true, zLayer: 'system', zIndex: Z_LAYERS.SYSTEM });
	await refreshUI('component-added');
};

export const buildComponentPickerTree = () => ({
	tag: "div",
	style: "display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.9); color: white; padding: 20px;",
	"picker-title": { tag: "h2", text: "Add Component", style: "margin-bottom: 30px;" },
	"picker-grid": {
		tag: "div",
		style: "display: grid; grid-template-columns: repeat(3, 200px); gap: 15px;",
		...Object.fromEntries([...registrations.keys()].filter(name => !componentStates.has(name))
			.map(name => [`add-${name}`, { tag: "button", text: name, class: "cognition-button-primary", style: "padding: 20px; font-size: 16px;", events: { click: "layout.addComponentFromPicker" }, "data-component": name }])
		)
	},
	"picker-hint": { tag: "div", text: "Press Escape to cancel", style: "margin-top: 20px; color: #888; font-size: 14px;" }
});

export const addComponentFromPicker = async (eventData) => {
	const componentName = eventData.target.dataset.component;
	componentStates.delete('_component-picker');
	await addComponent(componentName);
};

// === COMPONENT SELECTION ===
const cycleSelection = async () => {
	const active = getAllActiveComponents().filter(comp => !comp.name.startsWith('_'));
	if (active.length === 0) return;
	const currentIndex = active.findIndex(comp => comp.isSelected);
	const nextName = active[(currentIndex + 1) % active.length].name;

	for (const [name, state] of componentStates) {
		const wasSelected = state.isSelected;
		state.isSelected = (name === nextName);
		if (wasSelected !== state.isSelected) updateComponentZIndex(name);
	}

	if (nextName) bringToFront(nextName);
	await saveComponentStates();
	await refreshUI('selection-change');
};

const clearSelections = async () => {
	let hasChanges = false;
	for (const [name, state] of componentStates) {
		if (state.isSelected) {
			state.isSelected = false;
			updateComponentZIndex(name);
			hasChanges = true;
		}
	}
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
		await runUnitTest("Z-layer system works", async () => {
			componentStates.set('test1', { ...defaultState, zLayer: 'normal' });
			componentStates.set('test2', { ...defaultState, zLayer: 'pinned', isPinned: true });
			updateComponentZIndex('test1');
			updateComponentZIndex('test2');
			const actual = { normal: getComponentState('test1').zIndex, pinned: getComponentState('test2').zIndex };
			componentStates.delete('test1'), componentStates.delete('test2');
			return { actual, assert: deepEqual, expected: { normal: Z_LAYERS.NORMAL, pinned: Z_LAYERS.PINNED } };
		}),
		await runUnitTest("Snap to half functionality", async () => {
			const testComp = { x: 25, y: 25, width: 50, height: 50, isSelected: true };
			componentStates.set('test-snap', testComp);
			await snapToHalf('ArrowLeft');
			const actual = { x: getComponentState('test-snap').x, width: getComponentState('test-snap').width };
			componentStates.delete('test-snap');
			return { actual, assert: deepEqual, expected: { x: 0, width: 50 } };
		}),
		await runUnitTest("Pin toggle functionality", async () => {
			componentStates.set('test-pin', { ...defaultState, isPinned: false });
			await togglePin('test-pin');
			const actual = getComponentState('test-pin').isPinned;
			componentStates.delete('test-pin');
			return { actual, assert: strictEqual, expected: true };
		})
	];
};