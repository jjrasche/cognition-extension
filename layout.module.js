import { configProxy } from './config.module.js';

export const manifest = {
	name: "layout",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Component layout system with z-layers, mode overlays, and window snapping",
	permissions: ["storage"],
	dependencies: ["chrome-sync", "tree-to-dom", "config"],
	actions: ["renderComponent", "updateComponent", "cycleMode", "showComponentPicker", "addComponentFromPicker", "togglePin", "snapToHalf"],
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

let runtime, componentStates = new Map(), layoutContainer = null, modeOverlay = null, currentModeIndex = 0;

const Z_LAYERS = {
	SYSTEM: 9999,     // Mode indicator, pickers, system UI
	PINNED: 3000,     // Always-on-top modules  
	ACTIVE: 2000,     // Currently selected component
	NORMAL: 1000      // Regular components
};
const modes = [
	{ name: 'select', icon: '👆', description: 'Select components', pattern: '👆'.repeat(200) },
	{ name: 'move', icon: '📱', description: 'Move component', pattern: '↕️↔️'.repeat(500) },
	{ name: 'expand', icon: '➕', description: 'Expand component', pattern: '➕'.repeat(300) },
	{ name: 'contract', icon: '➖', description: 'Contract component', pattern: '➖'.repeat(300) }
];
const config = configProxy(manifest);
const defaultState = { x: 0, y: 0, width: 30, height: 20, savedPosition: null, isSelected: false, isMaximized: false, isRendered: false, isLoading: false, moduleName: null, getTree: null, zIndex: Z_LAYERS.NORMAL, isPinned: false };
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
	const loadingEl = document.getElementById('cognition-loading');
	if (loadingEl) {
		loadingEl.style.opacity = '0';
		loadingEl.style.transition = 'opacity 0.5s';
		setTimeout(() => loadingEl.remove(), 500)
	}
};

// === UNIFIED COMPONENT API ===
export const updateComponent = async (name, stateChanges) => {
	// TODO: Add validation for external state updates if needed
	const state = getComponentState(name);
	Object.assign(state, normalizeStateChanges(stateChanges));
	updateComponentZIndex(name);
	await saveComponentStates();
	await refreshUI('state-change', [name]);
	runtime.log(`[Layout] Updated ${name}:`, stateChanges);
};

const normalizeStateChanges = (changes) => {
	const normalized = { ...changes };
	if ('x' in changes || 'y' in changes || 'width' in changes || 'height' in changes) {
		const position = {
			x: normalized.x ?? 0,
			y: normalized.y ?? 0,
			width: normalized.width ?? 30,
			height: normalized.height ?? 20
		};
		Object.assign(normalized, normalizePosition(position));
	}
	return normalized;
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
		isRendered: true, zIndex: Z_LAYERS.SYSTEM,
		moduleName: 'layout', getTree: '_mode-indicator'
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
	if (state.zIndex === Z_LAYERS.SYSTEM) {
		// Keep system layer as-is
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
	if (state.zIndex !== Z_LAYERS.SYSTEM && !state.isPinned) {
		state.zIndex = Z_LAYERS.ACTIVE;
	}
};

export const togglePin = async (componentName) => {
	const state = getComponentState(componentName || getSelectedComponent()?.name);
	if (!state || state.zIndex === Z_LAYERS.SYSTEM) return;

	await updateComponent(componentName, { isPinned: !state.isPinned });
	runtime.log(`[Layout] ${state.isPinned ? 'Pinned' : 'Unpinned'} ${componentName}`);
};

// === DISCOVERY & REGISTRATION ===
const discoverComponents = async () => runtime.getModulesWithProperty('uiComponents').forEach(module =>
	module.manifest.uiComponents.forEach(comp => {
		const name = comp.name;
		if (!componentStates.has(name)) {
			componentStates.set(name, {
				...defaultState,
				moduleName: module.manifest.name,
				getTree: comp.getTree
			});
		} else {
			// Update discovery data for existing components
			const existing = componentStates.get(name);
			existing.moduleName = module.manifest.name;
			existing.getTree = comp.getTree;
		}
		runtime.actions.set(`${module.manifest.name}.${comp.getTree}`, module[comp.getTree]);
	})
);

const handleModuleStateChange = async (moduleName, newState) => {
	const changedComponents = [];
	for (const [name, state] of componentStates) {
		if (state.moduleName === moduleName) {
			const wasLoading = state.isLoading;
			state.isLoading = (newState !== 'ready');
			if (wasLoading !== state.isLoading) {
				changedComponents.push(name);
			}
		}
	}

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
	if (e.altKey && e.key === 'ArrowRight') {
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
	if (componentStates.has('_component-picker')) {
		if (e.key === 'Escape') {
			e.preventDefault();
			componentStates.delete('_component-picker');
			return await refreshUI('component-removed');
		}
	}
};

const handleComponentKeys = async (name, event) => {
	const state = getComponentState(name);
	const keyMap = state.keyMap;
	const handler = keyMap?.[event.code] || keyMap?.[event.key];
	if (handler) {
		event.preventDefault();
		const [action, param] = handler.split(':');
		await runtime.call(action, param);
		return true;
	}
	return false;
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
		}
	});
	elementsToRemove.forEach(el => el.remove());
};

// === COMPONENT RENDERING ===
export const renderComponent = async (name) => {
	const state = getComponentState(name);
	if (!state.isRendered) return;

	const element = getOrCreateComponentElementContainer(name);
	let contentEl = getOrCreateComponentContentContainer(element);
	try {
		const tree = await getComponentTree(name);
		await runtime.call('tree-to-dom.transform', tree, contentEl);
		runtime.log(`[Layout] Rendered ${name}`);
	} catch (error) {
		contentEl.innerHTML = `<div style="padding: 10px; color: var(--danger, #ff6b6b);">Error loading ${name}: ${error.message}</div>`;
	}
};

const getComponentTree = async (name) => {
	if (name === '_component-picker') return buildComponentPickerTree();
	if (name === '_mode-indicator') return buildModeIndicatorTree();

	const state = getComponentState(name);
	if (!state.getTree) return { tag: "div", text: `Component ${name} not found` };

	try {
		return await runtime.call(`${state.moduleName}.${state.getTree}`);
	} catch (error) {
		return { tag: "div", text: `Error loading ${name}: ${error.message}` };
	}
};

const buildModeIndicatorTree = () => {
	const currentMode = modes[currentModeIndex];
	return {
		"mode-display": {
			tag: "div",
			style: "display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); color: white; border: 1px solid var(--border-primary); border-radius: 4px; font-size: 16px; cursor: pointer; width: 100%; height: 100%;",
			events: { click: "layout.cycleMode" },
			text: currentMode.icon,
			title: `${currentMode.description} (Alt+Space: cycle modes)`
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
	getAllActiveComponents().filter(comp => comp.isRendered).forEach(comp => renderComponent(comp.name));
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
const getComponentState = (name) => componentStates.has(name) ? componentStates.get(name) : componentStates.set(name, { ...defaultState }).get(name);

export const addComponent = async (name, position = {}) => {
	const state = getComponentState(name);
	if (!state.moduleName) throw new Error(`Component ${name} not registered`);

	await updateComponent(name, {
		x: position.x ?? 10 + (componentStates.size * 5),
		y: position.y ?? 20 + (componentStates.size * 5),
		width: position.width ?? config.defaultComponentWidth,
		height: position.height ?? config.defaultComponentHeight,
		isRendered: true
	});
};

const getAllActiveComponents = () => [...componentStates.entries()].map(([name, state]) => ({ name, ...state }));

// === PERSISTENCE ===
const loadComponentStates = async () => {
	const saved = await runtime.call('chrome-sync.get', 'layout.componentStates');

	if (saved) {
		Object.entries(saved).forEach(([name, savedState]) => {
			const existing = componentStates.get(name);
			if (existing) {
				// Merge saved state with existing discovery data
				Object.assign(existing, savedState);
			} else {
				// Create new state from saved data
				componentStates.set(name, { ...defaultState, ...savedState });
			}
		});
	} else {
		applyDefaultLayout();
	}

	// Update loading states and z-indexes
	for (const [name, state] of componentStates) {
		if (state.moduleName) {
			state.isLoading = runtime.getState(state.moduleName) !== 'ready';
		}
		updateComponentZIndex(name);
	}
};

const saveComponentStates = async () => {
	const stateToSave = Object.fromEntries(
		[...componentStates].filter(([name]) => !name.startsWith('_')).map(([name, state]) => [name, {
			// Save position and status data, but not discovery data
			x: state.x, y: state.y, width: state.width, height: state.height,
			isSelected: state.isSelected, isMaximized: state.isMaximized, isRendered: state.isRendered,
			isPinned: state.isPinned, savedPosition: state.savedPosition
		}])
	);
	await runtime.call('chrome-sync.set', { 'layout.componentStates': stateToSave });
};

const applyDefaultLayout = () => {
	// Add command-input as default component if it exists
	const commandInputExists = [...componentStates.values()].some(state => state.getTree === 'commandTree');
	if (commandInputExists) {
		updateComponent('command-input', {
			x: 0, y: 0, width: 100, height: 20, isRendered: true
		});
	}
};

// === GRID & POSITIONING ===
const snapToGrid = (value) => Math.round(value / config.gridSize) * config.gridSize;
const normalizePosition = ({ x, y, width, height }) => ({
	x: snapToGrid(Math.max(0, Math.min(x, 100 - width))),
	y: snapToGrid(Math.max(0, Math.min(y, 100 - height))),
	width: snapToGrid(Math.max(config.gridSize, Math.min(width, 100 - x))),
	height: snapToGrid(Math.max(config.gridSize, Math.min(height, 100 - y)))
});

// === COMPONENT PICKER ===
export const showComponentPicker = async () => {
	const available = getAllActiveComponents().filter(comp => !comp.isRendered && comp.moduleName);
	if (available.length === 0) return runtime.log('[Layout] No components available');

	componentStates.set('_component-picker', {
		...defaultState,
		x: 20, y: 20, width: 60, height: 60, isRendered: true,
		zIndex: Z_LAYERS.SYSTEM, moduleName: 'layout', getTree: '_component-picker'
	});
	await refreshUI('component-added');
};

const buildComponentPickerTree = () => ({
	tag: "div",
	style: "display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.9); color: white; padding: 20px;",
	"picker-title": { tag: "h2", text: "Add Component", style: "margin-bottom: 30px;" },
	"picker-grid": {
		tag: "div",
		style: "display: grid; grid-template-columns: repeat(3, 200px); gap: 15px;",
		...Object.fromEntries(getAllActiveComponents().filter(comp => !comp.isRendered && comp.moduleName)
			.map(comp => [`add-${comp.name}`, {
				tag: "button", text: comp.name, class: "cognition-button-primary",
				style: "padding: 20px; font-size: 16px;",
				events: { click: "layout.addComponentFromPicker" },
				"data-component": comp.name
			}])
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
	const active = getAllActiveComponents().filter(comp => !comp.name.startsWith('_') && comp.isRendered);
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
	if (maximized?.savedPosition) {
		await updateComponent(maximized.name, { ...maximized.savedPosition, isMaximized: false, savedPosition: null });
	}
};

const getMaximizedComponent = () => getAllActiveComponents().find(comp => comp.isMaximized);

// === TESTING ===
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Unified updateComponent API works", async () => {
			componentStates.set('test-unified', { ...defaultState, x: 10, y: 20 });
			await updateComponent('test-unified', { x: 30, isSelected: true });
			const actual = { x: getComponentState('test-unified').x, isSelected: getComponentState('test-unified').isSelected };
			componentStates.delete('test-unified');
			return { actual, assert: deepEqual, expected: { x: 30, isSelected: true } };
		}),
		await runUnitTest("Z-layer system works", async () => {
			componentStates.set('test1', { ...defaultState });
			componentStates.set('test2', { ...defaultState, isPinned: true });
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
		})
	];
};