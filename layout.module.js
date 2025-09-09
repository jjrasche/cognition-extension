import { configProxy } from './config.module.js';
export const manifest = {
	name: "layout",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Dynamic component positioning and layout management with grid snapping and reactive loading",
	permissions: ["storage"],
	dependencies: ["chrome-sync", "tree-to-dom", "config"],
	actions: ["selectComponent", "cycleSelection", "maximizeComponent", "restoreLayout", "addComponent", "removeComponent", "replaceComponent", "setComponentLoading", "withLoading", "showLayoutUI", "toggleGrid", "resetLayout"],
	config: {
		gridSize: { type: 'number', min: 1, max: 20, value: 5, label: 'Grid Snap Size (%)' },
		defaultComponentWidth: { type: 'number', min: 10, max: 90, value: 30, label: 'Default Component Width (%)' },
		defaultComponentHeight: { type: 'number', min: 10, max: 90, value: 20, label: 'Default Component Height (%)' },
		enableKeyboardNav: { type: 'checkbox', value: true, label: 'Enable Keyboard Navigation' },
	}
};
let runtime, componentStates = new Map(), registrations = new Map();
const config = configProxy(manifest);
const defaultState = { x: 0, y: 0, width: 30, height: 20, savedPosition: null, isSelected: false, isMaximized: false, isLoading: false, moduleName: null };
export const initialize = async (rt) => {
	runtime = rt;
	runtime.moduleState.addListener(handleModuleStateChange);
	await discoverComponents();
	await loadComponentStates();
	await renderLayout();
	config.enableKeyboardNav && setupKeyboardHandlers();
};

// === DISCOVERY & REGISTRATION ===
const discoverComponents = async () => runtime.getModulesWithProperty('uiComponents').forEach(module =>
	(module.manifest.uiComponents || []).forEach(comp => {
		runtime.registerAction(module, comp.getTree);
		registrations.set(comp.name, { ...comp, moduleName: module.manifest.name });
	}));
const getComponentTree = async (componentName) => {
	const reg = registrations.get(componentName);
	if (!reg) return null;
	try { return await runtime.call(`${reg.moduleName}.${reg.getTree}`); }
	catch (error) { return { tag: "div", text: `Error loading ${componentName}` }; }
};
// === REACTIVE STATE ===
const handleModuleStateChange = async (moduleName, newState) => {
	let needsRerender = false;
	for (const [name, state] of componentStates) {
		if (state.moduleName === moduleName) {
			const wasLoading = state.isLoading;
			state.isLoading = (newState !== 'ready');
			if (wasLoading !== state.isLoading) needsRerender = true;
		}
	}
	needsRerender && await renderLayout();
};
// === STATE MANAGEMENT ===
const getComponentState = (name) => componentStates.has(name) ? componentStates.get(name) :
	componentStates.set(name, { ...defaultState, moduleName: registrations.get(name)?.moduleName || null }).get(name);
const updateComponent = async (name, changes) => (Object.assign(getComponentState(name), changes), await saveComponentStates(), await renderLayout());
const getAllActiveComponents = () => [...componentStates.entries()].map(([name, state]) => ({ name, ...state }));
// === PERSISTENCE ===
const loadComponentStates = async () => {
	const saved = await runtime.call('chrome-sync.get', 'layout.componentStates');
	saved ? Object.entries(saved).forEach(([name, state]) => componentStates.set(name, { ...defaultState, ...state })) : await applyDefaultLayout();
	// Initialize loading states
	for (const [name, state] of componentStates) state.moduleName && (state.isLoading = runtime.getState(state.moduleName) !== 'ready');
};
const saveComponentStates = async () => await runtime.call('chrome-sync.set', { 'layout.componentStates': Object.fromEntries([...componentStates].map(([name, state]) => [name, state])) });
const applyDefaultLayout = async () => [{ name: 'command-input', x: 10, y: 5, width: 80, height: 10 }]
	.forEach(def => registrations.has(def.name) && componentStates.set(def.name, { ...defaultState, ...def, moduleName: registrations.get(def.name).moduleName }));
// === GRID & POSITIONING ===
const snapToGrid = (value) => Math.round(value / config.gridSize) * config.gridSize;
const normalizePosition = ({ x, y, width, height }) => ({ x: snapToGrid(Math.max(0, Math.min(x, 100 - width))), y: snapToGrid(Math.max(0, Math.min(y, 100 - height))), width: snapToGrid(Math.max(config.gridSize, Math.min(width, 100 - x))), height: snapToGrid(Math.max(config.gridSize, Math.min(height, 100 - y))) });
const hasCollision = (pos1, pos2) => !(pos1.x + pos1.width <= pos2.x || pos2.x + pos2.width <= pos1.x || pos1.y + pos1.height <= pos2.y || pos2.y + pos2.height <= pos1.y);
const isValidPosition = (position, excludeName) => !getAllActiveComponents().filter(comp => comp.name !== excludeName).some(comp => hasCollision(position, comp));
// === Rendering ===
export const renderLayout = async () => await runtime.call('ui.renderTree', buildLayoutManagementTree());
export const resetLayout = async () => (componentStates.clear(), await applyDefaultLayout(), await saveComponentStates(), await renderLayout());
const buildLayoutManagementTree = () => ({
	"layout-manager": {
		tag: "div", style: "height: 100vh; padding: 20px; overflow-y: auto;",
		"header": {
			tag: "div", style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;",
			"back-button": { tag: "button", text: "← Back", class: "cognition-button-secondary", events: { click: "ui.initializeLayout" } },
			"title": { tag: "h1", text: "Layout Manager", style: "margin: 0;" },
			"actions": {
				tag: "div", style: "display: flex; gap: 10px;",
				"toggle-grid": { tag: "button", text: config.showGridLines ? "Hide Grid" : "Show Grid", class: "cognition-button-secondary", events: { click: "layout.toggleGrid" } },
				"reset-layout": { tag: "button", text: "Reset", class: "cognition-button-primary", events: { click: "layout.resetLayout" } }
			}
		},
		"component-list": buildComponentsList(),
		"layout-preview": buildLayoutPreview()
	}
});
const buildComponentsList = () => {
	const activeNames = new Set([...componentStates.keys()]);
	return {
		tag: "div", style: "margin-bottom: 20px;",
		"list-title": { tag: "h3", text: "Available Components" },
		"components": {
			tag: "div", style: "display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;",
			...Object.fromEntries([...registrations.values()].map(comp => [`comp-${comp.name}`, {
				tag: "div",
				style: `padding: 10px; border: 1px solid var(--border-primary); border-radius: 4px; ${activeNames.has(comp.name) ? 'background: var(--bg-tertiary);' : 'cursor: pointer;'}`,
				events: activeNames.has(comp.name) ? {} : { click: "layout.addComponent" },
				"data-component": comp.name,
				"name": { tag: "div", text: comp.name, style: "font-weight: 500;" },
				"status": { tag: "div", text: activeNames.has(comp.name) ? "Active" : "Add", style: `font-size: 12px; color: ${activeNames.has(comp.name) ? 'var(--success)' : 'var(--accent-primary)'};` }
			}]))
		}
	};
};
const buildLayoutPreview = () => {
	const active = getAllActiveComponents();
	return {
		tag: "div",
		"preview-title": { tag: "h3", text: `Current Layout (${active.length} components)` },
		"preview-list": {
			tag: "div", style: "display: flex; flex-direction: column; gap: 8px;",
			...Object.fromEntries(active.map(comp => [`preview-${comp.name}`, {
				tag: "div",
				style: "display: flex; justify-content: space-between; align-items: center; padding: 8px; background: var(--bg-tertiary); border-radius: 4px;",
				"info": { tag: "div", text: `${comp.name} (${comp.x}%, ${comp.y}%, ${comp.width}×${comp.height})`, style: "flex: 1;" },
				"remove-btn": { tag: "button", text: "×", class: "cognition-button-secondary", style: "width: 24px; height: 24px; padding: 0;", events: { click: "layout.removeComponent" }, "data-component": comp.name }
			}]))
		}
	};
};
// === COMPONENT SELECTION ===
export const selectComponent = async (event) => {
	const name = event.target.closest('.layout-component')?.dataset.component;
	if (!name) return;
	for (const [compName, state] of componentStates) state.isSelected = (compName === name);
	await saveComponentStates(), await renderLayout();
};
export const cycleSelection = async () => {
	const active = getAllActiveComponents();
	if (active.length === 0) return;
	const currentIndex = active.findIndex(comp => comp.isSelected);
	const nextName = active[(currentIndex + 1) % active.length].name;
	for (const [name, state] of componentStates) state.isSelected = (name === nextName);
	await saveComponentStates(), await renderLayout();
};
const moveSelectedComponent = async (direction) => {
	const selected = getAllActiveComponents().find(comp => comp.isSelected);
	if (!selected) return;
	const deltaMap = { ArrowUp: { x: 0, y: -config.gridSize }, ArrowDown: { x: 0, y: config.gridSize }, ArrowLeft: { x: -config.gridSize, y: 0 }, ArrowRight: { x: config.gridSize, y: 0 } };
	const newPos = normalizePosition({ x: selected.x + deltaMap[direction].x, y: selected.y + deltaMap[direction].y, width: selected.width, height: selected.height });
	isValidPosition(newPos, selected.name) && await updateComponent(selected.name, newPos);
};
// === MAXIMIZE/RESTORE ===
export const maximizeComponent = async (event) => {
	const name = event?.target?.dataset?.component || event?.target?.closest('.layout-component')?.dataset?.component;
	if (!name) return;
	const state = getComponentState(name);
	if (state.isMaximized) return;
	state.savedPosition = { x: state.x, y: state.y, width: state.width, height: state.height };
	await updateComponent(name, { x: 0, y: 0, width: 100, height: 100, isMaximized: true });
};
export const restoreLayout = async () => {
	const maximized = getAllActiveComponents().find(comp => comp.isMaximized);
	maximized?.savedPosition && await updateComponent(maximized.name, { ...maximized.savedPosition, isMaximized: false, savedPosition: null });
};
// === COMPONENT MANAGEMENT ===
const findAvailableSpace = (width = config.defaultComponentWidth, height = config.defaultComponentHeight) => {
	for (let y = 0; y <= 100 - height; y += config.gridSize) {
		for (let x = 0; x <= 100 - width; x += config.gridSize) {
			const testPos = { x, y, width, height };
			if (isValidPosition(testPos)) return testPos;
		}
	}
	return null;
};
export const addComponent = async (event) => {
	const name = event?.target?.dataset?.component || event;
	if (typeof name !== 'string') return false;
	const reg = registrations.get(name);
	if (!reg) return false;
	const finalPos = normalizePosition(findAvailableSpace() || { x: 10, y: 10, width: config.defaultComponentWidth, height: config.defaultComponentHeight });
	componentStates.set(name, { ...defaultState, ...finalPos, moduleName: reg.moduleName, isLoading: runtime.getState(reg.moduleName) !== 'ready' });
	await saveComponentStates(), await renderLayout();
	return true;
};
export const removeComponent = async (event) => {
	const name = event?.target?.dataset?.component || event;
	if (typeof name !== 'string') return;
	componentStates.delete(name), await saveComponentStates(), await renderLayout();
};
export const replaceComponent = async (name, newTree) => {
	const element = document.querySelector(`[data-component="${name}"] .component-content`);
	element && await runtime.call('tree-to-dom.transform', { content: newTree }, element);
};
// === LOADING STATE ===
export const setComponentLoading = async (name, isLoading) => {
	const state = getComponentState(name);
	if (state.isLoading !== isLoading) (state.isLoading = isLoading, await renderLayout());
};
export const withLoading = async (name, asyncAction) => {
	try { await setComponentLoading(name, true); return await asyncAction(); }
	finally { await setComponentLoading(name, false); }
};
// === KEYBOARD NAVIGATION ===
const setupKeyboardHandlers = () => document.addEventListener('keydown', async (e) => {
	const maximized = getAllActiveComponents().find(comp => comp.isMaximized);
	const selected = getAllActiveComponents().find(comp => comp.isSelected);
	if (e.key === 'Escape' && maximized) await restoreLayout();
	if (e.key === 'Tab') (e.preventDefault(), await cycleSelection());
	if (e.key === 'Delete' && selected) await removeComponent(selected.name);
	if (e.key === 'Enter' && selected) await maximizeComponent({ target: { dataset: { component: selected.name } } });
	if (e.ctrlKey && e.key === 'r') (e.preventDefault(), await initialize(runtime));
	if (selected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) (e.preventDefault(), await moveSelectedComponent(e.key));
});
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
		await runUnitTest("Available space finding", async () => {
			componentStates.set('existing', { x: 10, y: 10, width: 30, height: 20 });
			const space = findAvailableSpace(25, 15);
			const actual = { findsSpace: space !== null, hasValidCoords: space && space.x >= 0 && space.y >= 0 };
			componentStates.delete('existing');
			return { actual, assert: deepEqual, expected: { findsSpace: true, hasValidCoords: true } };
		})
	];
};