import { configProxy } from './config.module.js';
export const manifest = {
	name: "layout",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Component layout system with z-layers, mode overlays, and window snapping",
	permissions: ["storage"],
	dependencies: ["chrome-sync", "tree-to-dom", "config"],
	actions: ["renderComponent", "updateComponent", "removeComponent", "removeSelected", "cycleMode", "showComponentPicker", "addComponentFromPicker", "togglePin", "snapToHalf"],
	commands: [
		{ name: "add component", keyword: "add", method: "showComponentPicker" }
	],
	config: {
		gridSize: { type: 'number', min: 1, max: 20, value: 5, label: 'Grid Snap Size (%)' },
		defaultComponentWidth: { type: 'number', min: 10, max: 90, value: 30, label: 'Default Component Width (%)' },
		defaultComponentHeight: { type: 'number', min: 10, max: 90, value: 20, label: 'Default Component Height (%)' },
		keySequenceTimeout: { type: 'number', min: 500, max: 5000, value: 2000, label: 'Key Sequence Timeout (ms)' },
		overlayOpacity: { type: 'number', min: 0.05, max: 0.3, value: 0.05, label: 'Mode Overlay Opacity' }
	}
};
let runtime, componentStates = new Map(), layoutContainer = null, globalKeyMap = new Map();
const Z_LAYERS = {
	SYSTEM: 10000, PINNED: 9999, ACTIVE: 2000, NORMAL: 1000
};
const config = configProxy(manifest);
let defaultState = { name: '', x: 0, y: 0, width: 30, height: 20, savedPosition: null, isSelected: false, isMaximized: false, isRendered: false, isLoading: false, moduleName: null, getTree: null, zIndex: Z_LAYERS.NORMAL, isPinned: false };
export const initialize = async (rt) => {
	runtime = rt;
	document.body.style.cssText = document.documentElement.style.cssText = 'margin: 0; padding: 0;';
	await discoverComponents();
	await loadComponentStates();
	await initializeLayoutContainer();
	await refreshUI('initialization');
	setupKeyboardHandlers();
	const loadingEl = document.getElementById('cognition-loading');
	loadingEl && (loadingEl.style.opacity = '0', loadingEl.style.transition = 'opacity 0.5s', setTimeout(() => loadingEl.remove(), 500));
	runtime.moduleState.addListener(handleModuleStateChange);
};
// === STATE MANAGEMENT ===
const getComponentState = (name) => componentStates.has(name) ? componentStates.get(name) : componentStates.set(name, { ...defaultState, name }).get(name);
const getSelectedComponent = () => [...componentStates.values()].find(state => state.isSelected);
const getMaximizedComponent = () => [...componentStates.values()].find(state => state.isMaximized);
export const updateComponent = async (name, stateChanges) => {
	const state = getComponentState(name);
	Object.assign(state, normalizeStateChanges(stateChanges));
	updateComponentZIndex(name);
	await saveComponentStates();
	await refreshUI('state-change', [name]);
	runtime.log(`[Layout] Updated ${name}:`, stateChanges);
};
const normalizeStateChanges = (changes) => {
	if (!changes) return {};
	const normalized = { ...changes };
	if ('x' in changes || 'y' in changes || 'width' in changes || 'height' in changes) {
		const position = { x: normalized.x ?? 0, y: normalized.y ?? 0, width: normalized.width ?? 30, height: normalized.height ?? 20 };
		Object.assign(normalized, normalizePosition(position));
	}
	return normalized;
};
// === DISCOVERY & REGISTRATION ===
const discoverComponents = async () => runtime.getModulesWithProperty('uiComponents').forEach(module =>
	module.manifest.uiComponents.forEach(comp => {
		const name = comp.name;
		if (!componentStates.has(name)) {
			componentStates.set(name, {
				...defaultState, name,
				moduleName: module.manifest.name,
				getTree: comp.getTree,
				zIndex: comp.zLayer ? Z_LAYERS[comp.zLayer] : Z_LAYERS.NORMAL
			});
		} else {
			const existing = componentStates.get(name);
			Object.assign(existing, { moduleName: module.manifest.name, getTree: comp.getTree });
		}
		runtime.log(`[Layout] Discovered component: ${name} from module ${module.manifest.name}`);
		runtime.actions.set(`${module.manifest.name}.${comp.getTree}`, { func: module[comp.getTree], context: runtime.runtimeName, moduleName: module.manifest.name });
	})
);
const handleModuleStateChange = async (moduleName, newState) => {
	const changedComponents = [];
	runtime.log(`[Layout] Module state changed: ${moduleName} is now ${newState}`);
	for (const [name, state] of componentStates) {
		if (state.moduleName === moduleName) {
			const wasLoading = state.isLoading;
			state.isLoading = (newState !== 'ready');
			wasLoading !== state.isLoading && changedComponents.push(name);
		}
	}
	changedComponents.length > 0 && await refreshUI('state-change', changedComponents);
};
// === MODE SYSTEM ===
const selectMode = { name: 'select', description: 'Select component' };
const moveMode = { name: 'move', description: 'Move component', pattern: ' ✥ '.repeat(10000) };
const expandMode = { name: 'expand', description: 'Expand component', pattern: ' + '.repeat(10000) };
const contractMode = { name: 'contract', description: 'Contract component', pattern: ' - '.repeat(10000) };
let modeOverlay = null, currentModeIndex = 0, modes = [selectMode, moveMode, expandMode, contractMode];
export const cycleMode = async () => {
	currentModeIndex = (currentModeIndex + 1) % modes.length;
	await showModeOverlay();
	runtime.log(`[Layout] Mode: ${modes[currentModeIndex].name}`);
};
const showModeOverlay = async () => {
	removeModeOverlay();
	if (currentModeIndex === modes.findIndex(m => m.name === "select")) return;
	const mode = modes[currentModeIndex];
	modeOverlay = Object.assign(document.createElement('div'), {
		className: 'mode-overlay',
		textContent: mode.pattern
	});
	modeOverlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,${config.overlayOpacity}); color: rgba(255,255,255,${config.overlayOpacity}); font-size: 24px; line-height: 1; word-break: break-all; pointer-events: none; z-index: ${Z_LAYERS.SYSTEM + 1}; font-family: monospace; overflow: hidden;`;
	document.body.appendChild(modeOverlay);
};
const removeModeOverlay = () => modeOverlay && (modeOverlay.remove(), modeOverlay = null);
// === COMPONENT OPERATIONS ===
export const snapToHalf = async (key) => {
	const selected = getSelectedComponent(), direction = key.key;
	if (!selected) return;
	const positions = { 'ArrowLeft': { x: 0, y: 0, width: 50, height: 100 }, 'ArrowRight': { x: 50, y: 0, width: 50, height: 100 }, 'ArrowUp': { x: 0, y: 0, width: 100, height: 50 }, 'ArrowDown': { x: 0, y: 50, width: 100, height: 50 } };
	await updateComponent(selected.name, positions[direction]);
	runtime.log(`[Layout] Snapped ${selected.name} to ${direction.replace('Arrow', '').toLowerCase()} half`);
};
export const contractComponent = async (key) => {
	const selected = getSelectedComponent(), direction = key.key;
	if (!selected) return;
	const contractAmount = config.gridSize;
	let newPos = { ...selected };
	switch (direction) {
		case 'ArrowUp': newPos.height = Math.max(config.gridSize, newPos.height - contractAmount); break;
		case 'ArrowDown': newPos.height = Math.max(config.gridSize, newPos.height - contractAmount); newPos.y = Math.min(100 - newPos.height, newPos.y + contractAmount); break;
		case 'ArrowLeft': newPos.width = Math.max(config.gridSize, newPos.width - contractAmount); break;
		case 'ArrowRight': newPos.width = Math.max(config.gridSize, newPos.width - contractAmount); newPos.x = Math.min(100 - newPos.width, newPos.x + contractAmount); break;
	}
	await updateComponent(selected.name, normalizePosition(newPos));
	runtime.log(`[Layout] Contracted ${selected.name} ${direction}`);
};
const moveSelectedComponent = async (key) => {
	const selected = getSelectedComponent(), direction = key.key;
	if (!selected) return;
	const moveAmount = config.gridSize;
	let newPos = { ...selected };
	switch (direction) {
		case 'ArrowUp': newPos.y = Math.max(0, newPos.y - moveAmount); break;
		case 'ArrowDown': newPos.y = Math.min(100 - newPos.height, newPos.y + moveAmount); break;
		case 'ArrowLeft': newPos.x = Math.max(0, newPos.x - moveAmount); break;
		case 'ArrowRight': newPos.x = Math.min(100 - newPos.width, newPos.x + moveAmount); break;
	}
	await updateComponent(selected.name, normalizePosition(newPos));
};
const expandSelectedComponent = async (key) => {
	const selected = getSelectedComponent(), direction = key.key;
	if (!selected) return;
	const expandAmount = config.gridSize;
	let newPos = { ...selected };
	switch (direction) {
		case 'ArrowUp': newPos.height += expandAmount; newPos.y = Math.max(0, newPos.y - expandAmount); break;
		case 'ArrowDown': newPos.height += expandAmount; break;
		case 'ArrowLeft': newPos.width += expandAmount; newPos.x = Math.max(0, newPos.x - expandAmount); break;
		case 'ArrowRight': newPos.width += expandAmount; break;
	}
	await updateComponent(selected.name, normalizePosition(newPos));
};
// === MAXIMIZE/RESTORE ===
const maximizedState = { x: 0, y: 0, width: 100, height: 100, isMaximized: true };
const maximizeSelected = async () => {
	const selected = getSelectedComponent();
	if (!selected || selected.isMaximized) return;
	selected.savedPosition = { x: selected.x, y: selected.y, width: selected.width, height: selected.height };
	await updateComponent(selected.name, maximizedState);
};
const restoreMaximized = async () => {
	const maximized = getMaximizedComponent();
	if (maximized?.savedPosition) {
		await updateComponent(maximized.name, { ...maximized.savedPosition, isMaximized: false, savedPosition: null });
	}
};
// === Z-INDEX MANAGEMENT ===
const updateComponentZIndex = (componentName) => {
	const state = getComponentState(componentName);
	if (state.zIndex === Z_LAYERS.SYSTEM) return;
	state.zIndex = state.isPinned ? Z_LAYERS.PINNED : state.isSelected ? Z_LAYERS.ACTIVE : Z_LAYERS.NORMAL;
};
const bringToFront = (componentName) => {
	for (const [name] of componentStates) updateComponentZIndex(name);
	const state = getComponentState(componentName);
	if (state.zIndex !== Z_LAYERS.SYSTEM && !state.isPinned) state.zIndex = Z_LAYERS.ACTIVE;
};
export const togglePin = async (componentName) => {
	const state = getComponentState(componentName || getSelectedComponent()?.name);
	if (!state || state.zIndex === Z_LAYERS.SYSTEM) return;
	await updateComponent(componentName, { isPinned: !state.isPinned });
	runtime.log(`[Layout] ${state.isPinned ? 'Pinned' : 'Unpinned'} ${componentName}`);
};
// === KEYBOARD HANDLER ===
const setupKeyboardHandlers = () => { document.addEventListener('keydown', handleKeyboard); registerGlobalKeys(); };
const handleKeyboard = async (e) => {
	if (e.key === 'Escape') {
		runtime.log('[Layout Debug] Escape pressed:', {
			activeElement: document.activeElement?.tagName,
			hasComponentPicker: componentStates.has('_component-picker'),
			willEarlyReturn: document.activeElement?.tagName && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
		});
	}
	if (document.activeElement?.tagName && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
	if (await handleGlobalKeys(e)) return;
	const maximized = getMaximizedComponent(), selected = getSelectedComponent(), mode = modes[currentModeIndex].name;
	if (handleLayoutKeys(e, mode, maximized, selected)) return;
	if (maximized && (await handleComponentKeys(maximized.name, e))) return;
	// componentStates.has('_component-picker') && e.key === 'Escape' ? (e.preventDefault(), componentStates.delete('_component-picker'), refreshUI('component-removed')) : null;
	if (componentStates.has('_component-picker') && e.key === 'Escape') {
		runtime.log('[Layout Debug] Component picker deletion:', { reason: 'escape pressed' });
		e.preventDefault();
		componentStates.delete('_component-picker');
		refreshUI('component-removed');
	}
};
const handleGlobalKeys = async (e) => {
	const keyCombo = buildKeyCombo(e);
	if (!keyCombo) return false;
	const action = globalKeyMap.get(keyCombo);
	return action ? (e.preventDefault(), await runtime.call(action), true) : false;
}
const handleLayoutKeys = (e, mode, maximized, selected) => {
	if (e.altKey && e.key === 'Enter') return preventDefaultReturnTrue(e, cycleMode);
	if (e.altKey && isArrowKey(e)) return preventDefaultReturnTrue(e, snapToHalf);
	if (e.key === 'Tab') return preventDefaultReturnTrue(e, cycleSelection);
	if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !maximized) return preventDefaultReturnTrue(e, removeSelected);
	if (e.key === 'Enter' && selected && !maximized) return preventDefaultReturnTrue(e, maximizeSelected);
	if (e.key === 'Enter' && maximized) return preventDefaultReturnTrue(e, restoreMaximized);
	if (e.key === 'Escape' && selected) return preventDefaultReturnTrue(e, clearSelections);
	if (mode === 'move' && isArrowKey(e)) return preventDefaultReturnTrue(e, moveSelectedComponent);
	if (mode === 'expand' && isArrowKey(e)) return preventDefaultReturnTrue(e, expandSelectedComponent);
	if (mode === 'contract' && isArrowKey(e)) return preventDefaultReturnTrue(e, contractComponent);
	return false;
};
const preventDefaultReturnTrue = async (e, method) => (e.preventDefault(), method(e), true);
const registerGlobalKeys = () => runtime.getModulesWithProperty('config')
	.filter(m => Object.values(m.manifest.config || {}).some(cfg => cfg.type === 'globalKey'))
	.forEach(module => Object.entries(module.manifest.config)
		.filter(([, schema]) => schema.type === 'globalKey' && schema.value)
		.forEach(([, schema]) => globalKeyMap.set(schema.value, `${module.manifest.name}.${schema.action}`)));
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
const isArrowKey = (e) => ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
const buildKeyCombo = (e) => {
	if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
	const parts = [];
	if (e.ctrlKey) parts.push('Ctrl');
	if (e.altKey) parts.push('Alt');
	if (e.shiftKey) parts.push('Shift');
	if (e.metaKey) parts.push('Meta');
	if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) parts.push(e.key === ' ' ? 'Space' : e.key);
	return parts.join('+');
};
// === COMPONENT MANAGEMENT ===
export const addComponent = async (name, position = {}) => {
	const state = getComponentState(name);
	if (!state.moduleName) throw new Error(`Component ${name} not registered`);
	await updateComponent(name, { x: position.x ?? 10 + (componentStates.size * 5), y: position.y ?? 20 + (componentStates.size * 5), width: position.width ?? config.defaultComponentWidth, height: position.height ?? config.defaultComponentHeight, isRendered: true });
};
export const removeComponent = async (name) => {
	const state = getComponentState(name);
	if (!state || name.startsWith('_')) return;
	state.isRendered = false;
	if (state.isSelected) { state.isSelected = false; updateComponentZIndex(name); }
	await saveComponentStates();
	await refreshUI('component-removed');
	runtime.log(`[Layout] Removed component: ${name}`);
};
export const removeSelected = async () => {
	const selected = getSelectedComponent();
	selected && !selected.name.startsWith('_') && await removeComponent(selected.name);
};
const getAllActiveComponents = () => [...componentStates.entries()].map(([name, state]) => ({ name, ...state }));
// === SELECTION ===
const cycleSelection = async () => {
	const active = getAllActiveComponents().filter(comp => !comp.name.startsWith('_') && comp.isRendered);
	if (active.length === 0) return;
	const currentIndex = active.findIndex(comp => comp.isSelected);
	const nextName = active[(currentIndex + 1) % active.length].name;
	for (const [name, state] of componentStates) {
		const wasSelected = state.isSelected;
		state.isSelected = (name === nextName);
		wasSelected !== state.isSelected && updateComponentZIndex(name);
	}
	nextName && bringToFront(nextName);
	await saveComponentStates();
	await refreshUI('selection-change');
};
const clearSelections = async () => {
	let hasChanges = false;
	for (const [name, state] of componentStates) {
		if (state.isSelected) { state.isSelected = false; updateComponentZIndex(name); hasChanges = true; }
	}
	hasChanges && (await saveComponentStates(), await refreshUI('selection-change'));
};
// === LAYOUT CONTAINER ===
const initializeLayoutContainer = async () => {
	layoutContainer = Object.assign(document.createElement('div'), { className: 'cognition-layout-container' });
	layoutContainer.style.cssText = 'position: relative; width: 100vw; height: 100vh; overflow: hidden; background: var(--bg-primary, #000);';
	document.body.appendChild(layoutContainer);
};
const cleanupRemovedComponents = async () => {
	const elementsToRemove = [];
	layoutContainer.querySelectorAll('[data-component]').forEach(element => {
		const name = element.dataset.component;
		const state = componentStates.get(name);
		(!state || !state.isRendered) && elementsToRemove.push(element);
	});
	elementsToRemove.forEach(el => el.remove());
};
// === RENDERING ===
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
	const state = getComponentState(name);
	if (!state.getTree) return { tag: "div", text: `Component ${name} not found` };
	try { return await runtime.call(`${state.moduleName}.${state.getTree}`); }
	catch (error) { return { tag: "div", text: `Error loading ${name}: ${error.message}` }; }
};
const getComponentElementContainer = (name) => layoutContainer.querySelector(`[data-component="${name}"]`);
const getOrCreateComponentElementContainer = (name) => {
	const state = getComponentState(name);
	let element = getComponentElementContainer(name);
	if (!element) { element = document.createElement('div'); element.dataset.component = name; layoutContainer.appendChild(element); }
	element.className = `layout-component ${state.isSelected ? 'selected' : ''} ${state.isMaximized ? 'maximized' : ''} ${state.isPinned ? 'pinned' : ''}`;
	setElementStyles(element, state);
	return element;
}
const setElementStyles = (element, state) => {
	const borderColor = state.isPinned ? 'var(--accent-secondary, #ff6b6b)' : state.isSelected ? 'var(--accent-primary, #007acc)' : 'var(--border-primary, #333)';
	element.style.cssText = `position: absolute; left: ${state.x}%; top: ${state.y}%; width: ${state.width}%; height: ${state.height}%; border: ${state.isSelected || state.isPinned ? '2px' : '1px'} solid ${borderColor}; background: var(--bg-secondary, #1a1a1a); border-radius: 4px; overflow: hidden; z-index: ${state.zIndex}; ${state.isLoading ? 'opacity: 0.5;' : ''} box-sizing: border-box;`;
};
const getOrCreateComponentContentContainer = (element) => {
	let contentEl = element.querySelector('.component-content');
	if (!contentEl) { contentEl = Object.assign(document.createElement('div'), { className: 'component-content' }); contentEl.style.cssText = 'width: 100%; height: 100%; overflow: hidden;'; element.appendChild(contentEl); }
	return contentEl;
}
const renderAllComponents = async () => { await cleanupRemovedComponents(); getAllActiveComponents().filter(comp => comp.isRendered).forEach(comp => renderComponent(comp.name)); };
const renderChangedComponents = (changedComponents) => getAllActiveComponents().filter(comp => changedComponents ? changedComponents.includes(comp.name) : true).forEach((comp) => { const element = getComponentElementContainer(comp.name); element && setElementStyles(element, comp); });
const refreshUI = async (reason, changedComponents) => {
	if (['initialization', 'component-added', 'component-removed'].includes(reason)) await renderAllComponents();
	else if (['position-change', 'selection-change', 'state-change'].includes(reason)) await renderChangedComponents(changedComponents);
	else await renderAllComponents();
};
// === PERSISTENCE ===
const loadComponentStates = async () => {
	const saved = await runtime.call('chrome-sync.get', 'layout.componentStates');
	saved ? Object.entries(saved).forEach(([name, savedState]) => {
		const existing = componentStates.get(name);
		existing ? Object.assign(existing, savedState) : componentStates.set(name, { ...defaultState, name, ...savedState });
	}) : applyDefaultLayout();
	for (const [name, state] of componentStates) {
		state.moduleName && (state.isLoading = runtime.getState(state.moduleName) !== 'ready');
		updateComponentZIndex(name);
	}
};
const saveComponentStates = async () => {
	const stateToSave = Object.fromEntries([...componentStates].filter(([name]) => !name.startsWith('_')).map(([name, state]) => [name, { x: state.x, y: state.y, width: state.width, height: state.height, isSelected: state.isSelected, isMaximized: state.isMaximized, isRendered: state.isRendered, isPinned: state.isPinned, savedPosition: state.savedPosition }]));
	await runtime.call('chrome-sync.set', { 'layout.componentStates': stateToSave });
};
const applyDefaultLayout = () => { const commandInputExists = [...componentStates.values()].some(state => state.getTree === 'commandTree'); commandInputExists && updateComponent('command-input', { x: 0, y: 0, width: 100, height: 20, isRendered: true }); };
// === GRID & POSITIONING ===
const snapToGrid = (value) => Math.round(value / config.gridSize) * config.gridSize;
const normalizePosition = ({ x, y, width, height }) => ({ x: snapToGrid(Math.max(0, Math.min(x, 100 - width))), y: snapToGrid(Math.max(0, Math.min(y, 100 - height))), width: snapToGrid(Math.max(config.gridSize, Math.min(width, 100 - x))), height: snapToGrid(Math.max(config.gridSize, Math.min(height, 100 - y))) });
// === COMPONENT PICKER ===
export const showComponentPicker = async () => {
	const available = getAllActiveComponents().filter(comp => !comp.isRendered && comp.moduleName);
	if (available.length === 0) return runtime.log('[Layout] No components available');
	componentStates.set('_component-picker', { ...defaultState, name: '_component-picker', x: 20, y: 20, width: 60, height: 60, isRendered: true, zIndex: Z_LAYERS.SYSTEM, moduleName: 'layout', getTree: '_component-picker' });
	await refreshUI('component-added');
};
const buildComponentPickerTree = () => ({ tag: "div", style: "display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.9); color: white; padding: 20px;", "picker-title": { tag: "h2", text: "Add Component", style: "margin-bottom: 30px;" }, "picker-grid": { tag: "div", style: "display: grid; grid-template-columns: repeat(3, 200px); gap: 15px;", ...Object.fromEntries(getAllActiveComponents().filter(comp => !comp.isRendered && comp.moduleName).map(comp => [`add-${comp.name}`, { tag: "button", text: comp.name, class: "cognition-button-primary", style: "padding: 20px; font-size: 16px;", events: { click: "layout.addComponentFromPicker" }, "data-component": comp.name }])) }, "picker-hint": { tag: "div", text: "Press Escape to cancel", style: "margin-top: 20px; color: #888; font-size: 14px;" } });
export const addComponentFromPicker = async (eventData) => {
	runtime.log('[Layout Debug] Component picker deletion:', {
		reason: 'component selected',
		component: eventData.target.dataset.component,
		hasPickerBefore: componentStates.has('_component-picker')
	});
	const componentName = eventData.target.dataset.component;
	componentStates.delete('_component-picker');
	await addComponent(componentName);
};// === TESTING ===
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	const originalStates = new Map([...componentStates]), originalMode = currentModeIndex, originalDefaultState = defaultState;
	defaultState = { ...defaultState, isRendered: true, moduleName: 'test-module', getTree: 'testTree' };
	const results = [];
	results.push(await runUnitTest("addComponent creates with correct defaults", async () => {
		componentStates.set('test-component', { ...defaultState, name: 'test-component' });
		await addComponent('test-component', { x: 25, y: 35, width: 40, height: 30 });
		const state = getComponentState('test-component');
		const actual = { x: state.x, y: state.y, width: state.width, height: state.height, isRendered: state.isRendered };
		const expected = { x: 25, y: 35, width: 40, height: 30, isRendered: true };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("maximize saves position and restores", async () => {
		componentStates.set('test-maximize', { ...defaultState, name: 'test-maximize', x: 10, y: 20, width: 30, height: 40, isSelected: true, isRendered: true });
		await maximizeSelected();
		const maxState = getComponentState('test-maximize');
		const actualMax = { x: maxState.x, y: maxState.y, width: maxState.width, height: maxState.height, isMaximized: maxState.isMaximized };
		const expectedMax = { x: 0, y: 0, width: 100, height: 100, isMaximized: true };
		await restoreMaximized();
		const restoreState = getComponentState('test-maximize');
		const actualRestore = { x: restoreState.x, y: restoreState.y, width: restoreState.width, height: restoreState.height, isMaximized: restoreState.isMaximized };
		const expectedRestore = { x: 10, y: 20, width: 30, height: 40, isMaximized: false };
		return { actual: { max: actualMax, restore: actualRestore }, assert: deepEqual, expected: { max: expectedMax, restore: expectedRestore } };
	}, cleanupTestComponents));
	results.push(await runUnitTest("cycleSelection works correctly", async () => {
		componentStates.set('test-cycle1', { ...defaultState, name: 'test-cycle1', isSelected: false });
		componentStates.set('test-cycle2', { ...defaultState, name: 'test-cycle2', isSelected: true });
		componentStates.set('test-cycle3', { ...defaultState, name: 'test-cycle3', isSelected: false });
		await cycleSelection();
		const actual = { cycle1: getComponentState('test-cycle1').isSelected, cycle2: getComponentState('test-cycle2').isSelected, cycle3: getComponentState('test-cycle3').isSelected };
		const expected = { cycle1: false, cycle2: false, cycle3: true };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("clearSelections clears all selections", async () => {
		componentStates.set('test-clear1', { ...defaultState, name: 'test-clear1', isSelected: true });
		componentStates.set('test-clear2', { ...defaultState, name: 'test-clear2', isSelected: true });
		await clearSelections();
		const actual = { clear1: getComponentState('test-clear1').isSelected, clear2: getComponentState('test-clear2').isSelected };
		const expected = { clear1: false, clear2: false };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("cycleMode changes mode index", async () => {
		const initialMode = currentModeIndex;
		await cycleMode();
		const newMode = currentModeIndex;
		await cycleMode(); // cycle back for cleanup
		const actual = newMode !== initialMode;
		return { actual, assert: strictEqual, expected: true };
	}, cleanupTestComponents));
	results.push(await runUnitTest("snapToHalf positions correctly", async () => {
		componentStates.set('test-snap', { ...defaultState, name: 'test-snap', x: 25, y: 25, width: 50, height: 50, isSelected: true });
		await snapToHalf({ key: 'ArrowLeft' });
		const state = getComponentState('test-snap');
		const actual = { x: state.x, y: state.y, width: state.width, height: state.height };
		const expected = { x: 0, y: 0, width: 50, height: 100 };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("togglePin changes pin state", async () => {
		componentStates.set('test-pin', { ...defaultState, name: 'test-pin', isPinned: false });
		await togglePin('test-pin');
		const actualPinned = getComponentState('test-pin').isPinned;
		await togglePin('test-pin');
		const actualUnpinned = getComponentState('test-pin').isPinned;
		const actual = { pinned: actualPinned, unpinned: actualUnpinned };
		const expected = { pinned: true, unpinned: false };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("z-index management works correctly", async () => {
		componentStates.set('test-z1', { ...defaultState, name: 'test-z1', zIndex: Z_LAYERS.NORMAL, isPinned: false });
		componentStates.set('test-z2', { ...defaultState, name: 'test-z2', zIndex: Z_LAYERS.NORMAL, isPinned: true });
		componentStates.set('test-z3', { ...defaultState, name: 'test-z3', zIndex: Z_LAYERS.SYSTEM });
		updateComponentZIndex('test-z1');
		updateComponentZIndex('test-z2');
		updateComponentZIndex('test-z3');
		const actual = { normal: getComponentState('test-z1').zIndex, pinned: getComponentState('test-z2').zIndex, system: getComponentState('test-z3').zIndex };
		const expected = { normal: Z_LAYERS.NORMAL, pinned: Z_LAYERS.PINNED, system: Z_LAYERS.SYSTEM };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("moveSelectedComponent respects boundaries", async () => {
		componentStates.set('test-move', { ...defaultState, name: 'test-move', x: 0, y: 0, width: 20, height: 20, isSelected: true });
		await moveSelectedComponent({ key: 'ArrowLeft' }); // should not move past 0
		await moveSelectedComponent({ key: 'ArrowUp' }); // should not move past 0
		const state = getComponentState('test-move');
		const actual = { x: state.x, y: state.y };
		const expected = { x: 0, y: 0 };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("removeComponent sets isRendered false and clears selection", async () => {
		componentStates.set('test-remove', { ...defaultState, name: 'test-remove', isSelected: true });
		await removeComponent('test-remove');
		const state = getComponentState('test-remove');
		const actual = { isRendered: state.isRendered, isSelected: state.isSelected };
		const expected = { isRendered: false, isSelected: false };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("snapToGrid works with different grid sizes", async () => {
		const originalGridSize = config.gridSize;
		manifest.config.gridSize.value = 5;
		const withGrid5 = normalizePosition({ x: 7, y: 8, width: 32, height: 17 });
		manifest.config.gridSize.value = 10;
		const withGrid10 = normalizePosition({ x: 14, y: 16, width: 32, height: 17 });
		manifest.config.gridSize.value = originalGridSize;
		const actual = { grid5: withGrid5, grid10: withGrid10 };
		const expected = { grid5: { x: 5, y: 10, width: 30, height: 15 }, grid10: { x: 10, y: 20, width: 30, height: 20 } };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("expandSelectedComponent increases size correctly", async () => {
		componentStates.set('test-expand', { ...defaultState, name: 'test-expand', x: 20, y: 20, width: 30, height: 30, isSelected: true });
		await expandSelectedComponent({ key: 'ArrowRight' });
		const state = getComponentState('test-expand');
		const actual = { width: state.width, x: state.x }; // width should increase, x should stay same
		const expected = { width: 35, x: 20 }; // assuming gridSize=5
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	results.push(await runUnitTest("component picker adds component and self-removes", async () => {
		componentStates.set('test-available-comp', { ...defaultState, name: 'test-available-comp', moduleName: 'test', isRendered: false });
		await showComponentPicker();
		const hasPickerBefore = componentStates.has('_component-picker');
		await addComponentFromPicker({ target: { dataset: { component: 'test-available-comp' } } });
		const actual = {
			hadPicker: hasPickerBefore,
			noPicker: !componentStates.has('_component-picker'),
			compAdded: getComponentState('test-available-comp').isRendered
		};
		return { actual, assert: deepEqual, expected: { hadPicker: true, noPicker: true, compAdded: true } };
	}, cleanupTestComponents));
	results.push(await runUnitTest("component picker full workflow: show, select, render, and escape", async () => {
		componentStates.set('test-picker-component', { ...defaultState, name: 'test-picker-component', moduleName: 'test-module', isRendered: false });
		await showComponentPicker();
		const pickerInitiallyShown = componentStates.has('_component-picker') && getComponentState('_component-picker').isRendered;
		await addComponentFromPicker({ target: { dataset: { component: 'test-picker-component' } } });
		const componentRendered = getComponentState('test-picker-component')?.isRendered;
		const pickerClosedAfterSelection = !componentStates.has('_component-picker');
		await showComponentPicker();
		const pickerShownAgain = componentStates.has('_component-picker');
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		await new Promise(resolve => setTimeout(resolve, 0));
		const pickerClosedAfterEscape = !componentStates.has('_component-picker');
		const actual = { pickerInitiallyShown, componentRendered, pickerClosedAfterSelection, pickerShownAgain, pickerClosedAfterEscape };
		const expected = { pickerInitiallyShown: true, componentRendered: true, pickerClosedAfterSelection: true, pickerShownAgain: true, pickerClosedAfterEscape: true };
		return { actual, assert: deepEqual, expected };
	}, cleanupTestComponents));
	await cleanup(originalStates, originalMode, originalDefaultState);
	return results;
};
const cleanupTestComponents = () => [...componentStates.keys()].filter(name => name.startsWith('test-') || name.startsWith('_') || name === '').forEach(name => componentStates.delete(name));
const cleanup = async (originalStates, originalMode, originalDefaultState) => {
	cleanupTestComponents();
	componentStates.clear();
	originalStates.forEach((state, name) => componentStates.set(name, { ...state }));
	currentModeIndex = originalMode;
	defaultState = originalDefaultState;
	showModeOverlay();
	await refreshUI('test-cleanup');
};