import { configProxy } from './config.module.js';
export const manifest = {
	name: "layout",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Component layout system with keyboard navigation and expansion - DOM persistent",
	permissions: ["storage"],
	dependencies: ["chrome-sync", "tree-to-dom", "config"],
	actions: ["renderComponent", "addComponentFromPicker"],
	config: {
		gridSize: { type: 'number', min: 1, max: 20, value: 5, label: 'Grid Snap Size (%)' },
		defaultComponentWidth: { type: 'number', min: 10, max: 90, value: 30, label: 'Default Component Width (%)' },
		defaultComponentHeight: { type: 'number', min: 10, max: 90, value: 20, label: 'Default Component Height (%)' },
		keySequenceTimeout: { type: 'number', min: 500, max: 5000, value: 2000, label: 'Key Sequence Timeout (ms)' }
	}
};
let runtime, componentStates = new Map(), registrations = new Map(), layoutContainer = null, renderedComponents = new Set(), keySequence = [];
const config = configProxy(manifest);
const defaultState = { x: 0, y: 0, width: 30, height: 20, savedPosition: null, isSelected: false, isMaximized: false, isLoading: false, moduleName: null };
export const initialize = async (rt) => {
	runtime = rt;
	runtime.moduleState.addListener(handleModuleStateChange);
	await discoverComponents();
	await loadComponentStates();
	await initializeLayoutContainer();
	await refreshUI('initialization');
	setupKeyboardHandlers();
};

// === DISCOVERY & REGISTRATION ===
const discoverComponents = async () => runtime.getModulesWithProperty('uiComponents').forEach(module => module.manifest.uiComponents.forEach(comp => {
	registrations.set(comp.name, { ...comp, moduleName: module.manifest.name });
	runtime.actions.set(`${module.manifest.name}.${comp.getTree}`, module[comp.getTree]); // register action available from runtime.call
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
// === KEYMAP HANDLER ===
const setupKeyboardHandlers = () => document.addEventListener('keydown', handleKeyboard);
// selected components don't handle keys for now
const handleKeyboard = async (e) => {
	console.log('Key pressed:', e.key, 'Ctrl:', e.ctrlKey, 'Alt:', e.altKey, 'sequence:', keySequence);
	const activeElement = document.activeElement;
	if (activeElement && ['INPUT', 'TEXTAREA'].includes(activeElement.tagName)) return; // Let the user type
	const maximized = getMaximizedComponent(), selected = getSelectedComponent();
	if (maximized && (await handleComponentKeys(maximized.name, e))) return;
	// if (selected && (await handleComponentKeys(selected.name, e))) return;
	return handleLayoutKeys(e);
};
const handleComponentKeys = async (name, event) => {
	const keyMap = registrations.get(name)?.keyMap;
	const handler = keyMap?.[event.code] || keyMap?.[event.key];
	if (handler) {
		event.preventDefault();
		const [action, param] = handler.split(':'); // Parse action:parameter format
		await runtime.call(action, param);
		return true;
	}
	return false;
};
// In layout.module.js, update handleLayoutKeys to support movement:

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

	// Arrow key behavior for selected, non-maximized components
	if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selected && !maximized) {
		e.preventDefault();

		if (e.shiftKey) {
			// Shift+Arrow = Move without expanding
			await moveSelectedComponent(e.key);
		} else {
			// Arrow = Expand (current behavior)
			await expandSelectedComponent(e.key);
		}
		return;
	}
};

// New function: Move component without changing size
const moveSelectedComponent = async (direction) => {
	const selected = getSelectedComponent();
	if (!selected) return;

	console.log(`🚀 Moving: ${selected.name} ${direction}`);

	const moveAmount = config.gridSize;
	let newPos = { ...selected };

	// Move in the specified direction
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

	// Apply grid snapping and bounds checking
	newPos = normalizePosition(newPos);

	// Check for collisions - if collision, don't move
	if (!isValidPosition(newPos, selected.name)) {
		console.log(`❌ Move blocked by collision`);
		return;
	}

	await updateComponent(selected.name, newPos);
	console.log(`✅ Moved to:`, newPos);
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
	const reg = registrations.get(name);
	if (!reg) return { tag: "div", text: `Component ${name} not found` };
	try { return await runtime.call(`${reg.moduleName}.${reg.getTree}`); }
	catch (error) { return { tag: "div", text: `Error loading ${name}: ${error.message}` }; }
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
	setElementStyles(element, state), setElementClass(element, state);
	return element;
}
const setElementStyles = (element, state) => element.style.cssText = `position: absolute; left: ${state.x}%; top: ${state.y}%; width: ${state.width}%; height: ${state.height}%; border: ${state.isSelected ? '2px solid var(--accent-primary, #007acc)' : '1px solid var(--border-primary, #333)'}; background: var(--bg-secondary, #1a1a1a); border-radius: 4px; overflow: hidden; ${state.isLoading ? 'opacity: 0.5;' : ''}box-sizing: border-box;`;
const setElementClass = (element, state) => element.className = `layout-component ${state.isSelected ? 'selected' : ''} ${state.isMaximized ? 'maximized' : ''}`;
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
		setElementStyles(element, comp), setElementClass(element, comp);
	});
const refreshUI = async (reason, changedComponents) => {
	if (['initialization', 'component-added', 'component-removed'].includes(reason)) await renderAllComponents();
	else if (['position-change', 'selection-change', 'state-change'].includes(reason)) await renderChangedComponents(changedComponents);
	else await renderAllComponents();
};
// === STATE MANAGEMENT ===
const getComponentState = (name) => componentStates.has(name) ? componentStates.get(name) : componentStates.set(name, { ...defaultState, moduleName: registrations.get(name)?.moduleName || null }).get(name);
const updateComponent = async (name, changes) => {
	console.log('🔄 Before:', { name, changes, current: getComponentState(name) });

	const beforeState = { ...getComponentState(name), ...changes };
	console.log('📏 Pre-normalize:', beforeState);
	validateComponentState(name, beforeState);

	const normalized = normalizePosition(beforeState);
	console.log('✅ Post-normalize:', normalized);
	validateComponentState(name, normalized);

	Object.assign(getComponentState(name), normalized);
	await saveComponentStates();
	await refreshUI('position-change', [name]);
};

// Debug expansion path
const expandSelectedComponent = async (direction) => {
	const selected = getSelectedComponent();
	if (selected) {
		console.log(`🎯 Starting expansion: ${selected.name} ${direction}`);
		console.log('📊 Pre-expand state:', componentStates);

		const newPos = pushComponents(selected.name, direction, config.gridSize);
		console.log('🔧 Push result:', newPos);

		await updateComponent(selected.name, newPos);
		console.log('📊 Post-expand state:', componentStates);
	}
};
// Validate state integrity 
const validateComponentState = (name, state) => {
	const errors = [];
	if (state.x < 0 || state.x > 100) errors.push(`x out of bounds: ${state.x}`);
	if (state.y < 0 || state.y > 100) errors.push(`y out of bounds: ${state.y}`);
	if (state.width <= 0 || state.width > 100) errors.push(`width invalid: ${state.width}`);
	if (state.height <= 0 || state.height > 100) errors.push(`height invalid: ${state.height}`);
	if (state.x + state.width > 100) errors.push(`x+width overflow: ${state.x + state.width}`);
	if (state.y + state.height > 100) errors.push(`y+height overflow: ${state.y + state.height}`);

	if (errors.length > 0) {
		console.error(`❌ Invalid state for ${name}:`, errors, state);
	}
	return errors.length === 0;
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
const hasCollision = (pos1, pos2) => !(pos1.x + pos1.width <= pos2.x || pos2.x + pos2.width <= pos1.x || pos1.y + pos1.height <= pos2.y || pos2.y + pos2.height <= pos1.y);
const isValidPosition = (position, excludeName) => !getAllActiveComponents().filter(comp => comp.name !== excludeName).some(comp => hasCollision(position, comp));
// === PUSH LOGIC ===
const pushComponents = (expandingName, direction, expandAmount) => {
	const expanding = getComponentState(expandingName);
	let newPos = { ...expanding };
	direction === 'ArrowUp' ? (newPos.height += expandAmount, newPos.y -= expandAmount) :
		direction === 'ArrowDown' ? (newPos.height += expandAmount) :
			direction === 'ArrowLeft' ? (newPos.width += expandAmount, newPos.x -= expandAmount) :
				direction === 'ArrowRight' && (newPos.width += expandAmount);
	newPos = normalizePosition(newPos);
	getAllActiveComponents().filter(comp => comp.name !== expandingName && hasCollision(newPos, comp)).forEach(comp => {
		const pushedPos = { ...comp };
		direction === 'ArrowUp' ? (pushedPos.y -= expandAmount) :
			direction === 'ArrowDown' ? (pushedPos.y += expandAmount) :
				direction === 'ArrowLeft' ? (pushedPos.x -= expandAmount) :
					direction === 'ArrowRight' && (pushedPos.x += expandAmount);
		updateComponent(comp.name, normalizePosition(pushedPos));
	});
	return newPos;
};
// === COMPONENT PICKER ===
export const showComponentPicker = async () => {
	const available = [...registrations.keys()].filter(name => !componentStates.has(name));
	if (available.length === 0) return runtime.log('[Layout] No components available');
	componentStates.set('_component-picker', { ...defaultState, ...maximizedState, isTemporary: true });
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
	componentStates.delete('_component-picker'); // Remove overlay
	await addComponent(componentName);
};
// === COMPONENT SELECTION ===
const cycleSelection = async () => {
	const active = getAllActiveComponents();
	if (active.length === 0) return;
	const currentIndex = active.findIndex(comp => comp.isSelected);
	const nextName = active[(currentIndex + 1) % active.length].name;
	for (const [name, state] of componentStates) state.isSelected = (name === nextName);
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
		await runUnitTest("Component state management", async () => {
			const testComp = 'test-component';
			registrations.set(testComp, { name: testComp, moduleName: 'test-module' });
			const state = getComponentState(testComp);
			const actual = { hasDefaultState: state.x === 0 && state.y === 0, hasModuleName: state.moduleName === 'test-module', isLoadingByDefault: state.isLoading === false };
			registrations.delete(testComp), componentStates.delete(testComp);
			return { actual, assert: deepEqual, expected: { hasDefaultState: true, hasModuleName: true, isLoadingByDefault: false } };
		}),
		await runUnitTest("Grid snapping and position normalization", async () => {
			const actual = { snap5: snapToGrid(23), snap20: snapToGrid(87), normalized: normalizePosition({ x: 7, y: 3, width: 103, height: 97 }) };
			const expected = { snap5: 25, snap20: 85, normalized: { x: 5, y: 5, width: 95, height: 95 } };
			return { actual, assert: deepEqual, expected };
		}),
		await runUnitTest("Collision detection", async () => {
			componentStates.set('existing', { x: 10, y: 10, width: 30, height: 20 });
			const actual = { validIsValid: isValidPosition({ x: 50, y: 10, width: 30, height: 20 }, 'test'), invalidIsInvalid: !isValidPosition({ x: 15, y: 15, width: 30, height: 20 }, 'test') };
			componentStates.delete('existing');
			return { actual, assert: deepEqual, expected: { validIsValid: true, invalidIsInvalid: true } };
		}),
		await runUnitTest("Layout container persistence", async () => {
			await initializeLayoutContainer();
			const actual = { containerExists: !!layoutContainer, isInDOM: document.body.contains(layoutContainer), hasCorrectClass: layoutContainer?.className === 'cognition-layout-container' };
			return { actual, assert: deepEqual, expected: { containerExists: true, isInDOM: true, hasCorrectClass: true } };
		})
	];
};