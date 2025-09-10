import { configProxy } from './config.module.js';
export const manifest = {
	name: "layout",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Component layout system with keyboard navigation and expansion",
	permissions: ["storage"],
	dependencies: ["chrome-sync", "tree-to-dom", "config"],
	actions: ["replaceComponent"],
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
	await refreshUI();
	config.enableKeyboardNav && setupKeyboardHandlers();
};
// discovery & registration
const discoverComponents = async () => runtime.getModulesWithProperty('uiComponents').forEach(module =>
	(module.manifest.uiComponents || []).forEach(comp => registrations.set(comp.name, { ...comp, moduleName: module.manifest.name })));
const getComponentTree = async (componentName) => {
	const reg = registrations.get(componentName);
	if (!reg) return { tag: "div", text: `Component ${componentName} not found` };
	try { return await runtime.call(`${reg.moduleName}.${reg.getTree}`); }
	catch (error) { return { tag: "div", text: `Error loading ${componentName}: ${error.message}` }; }
};
// reactive state
const handleModuleStateChange = async (moduleName, newState) => {
	let needsRerender = false;
	for (const [name, state] of componentStates) {
		if (state.moduleName === moduleName) {
			const wasLoading = state.isLoading;
			state.isLoading = (newState !== 'ready');
			if (wasLoading !== state.isLoading) needsRerender = true;
		}
	}
	needsRerender && await refreshUI();
};
// state management
const getComponentState = (name) => componentStates.has(name) ? componentStates.get(name) : componentStates.set(name, { ...defaultState, moduleName: registrations.get(name)?.moduleName || null }).get(name);
const updateComponent = async (name, changes) => (Object.assign(getComponentState(name), changes), await saveComponentStates(), await refreshUI());
const getAllActiveComponents = () => [...componentStates.entries()].map(([name, state]) => ({ name, ...state }));
// persistence
const loadComponentStates = async () => {
	const saved = await runtime.call('chrome-sync.get', 'layout.componentStates');
	saved ? Object.entries(saved).forEach(([name, state]) => componentStates.set(name, { ...defaultState, ...state })) : applyDefaultLayout();
	for (const [name, state] of componentStates) state.moduleName && (state.isLoading = runtime.getState(state.moduleName) !== 'ready');
};
const saveComponentStates = async () => await runtime.call('chrome-sync.set', { 'layout.componentStates': Object.fromEntries([...componentStates].map(([name, state]) => [name, state])) });
const applyDefaultLayout = () => registrations.has('command-input') && componentStates.set('command-input', { ...defaultState, x: 10, y: 5, width: 80, height: 10, moduleName: registrations.get('command-input').moduleName });
// grid & positioning
const snapToGrid = (value) => Math.round(value / config.gridSize) * config.gridSize;
const normalizePosition = ({ x, y, width, height }) => ({ x: snapToGrid(Math.max(0, Math.min(x, 100 - width))), y: snapToGrid(Math.max(0, Math.min(y, 100 - height))), width: snapToGrid(Math.max(config.gridSize, Math.min(width, 100 - x))), height: snapToGrid(Math.max(config.gridSize, Math.min(height, 100 - y))) });
const hasCollision = (pos1, pos2) => !(pos1.x + pos1.width <= pos2.x || pos2.x + pos2.width <= pos1.x || pos1.y + pos1.height <= pos2.y || pos2.y + pos2.height <= pos1.y);
const isValidPosition = (position, excludeName) => !getAllActiveComponents().filter(comp => comp.name !== excludeName).some(comp => hasCollision(position, comp));
// push logic
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
// component selection
const cycleSelection = async () => {
	const active = getAllActiveComponents();
	if (active.length === 0) return;
	const currentIndex = active.findIndex(comp => comp.isSelected);
	const nextName = active[(currentIndex + 1) % active.length].name;
	for (const [name, state] of componentStates) state.isSelected = (name === nextName);
	await saveComponentStates();
	await refreshUI();
};
const clearSelections = async () => {
	let hasChanges = false;
	for (const [name, state] of componentStates) state.isSelected && (state.isSelected = false, hasChanges = true);
	hasChanges && (await saveComponentStates(), await refreshUI());
};
const expandSelectedComponent = async (direction) => {
	const selected = getAllActiveComponents().find(comp => comp.isSelected);
	selected && await updateComponent(selected.name, pushComponents(selected.name, direction, config.gridSize));
};
// maximize/restore
const maximizeSelected = async () => {
	const selected = getAllActiveComponents().find(comp => comp.isSelected);
	if (!selected || selected.isMaximized) return;
	const state = getComponentState(selected.name);
	state.savedPosition = { x: state.x, y: state.y, width: state.width, height: state.height };
	await updateComponent(selected.name, { x: 0, y: 0, width: 100, height: 100, isMaximized: true });
};
const restoreMaximized = async () => {
	const maximized = getAllActiveComponents().find(comp => comp.isMaximized);
	maximized?.savedPosition && await updateComponent(maximized.name, { ...maximized.savedPosition, isMaximized: false, savedPosition: null });
};
// rendering
const refreshUI = async () => await renderTree(await buildLayoutTree());
const buildLayoutTree = async () => {
	const active = getAllActiveComponents();
	const componentNodes = {};
	for (const comp of active) {
		const tree = await getComponentTree(comp.name);
		componentNodes[`component-${comp.name}`] = {
			tag: "div", class: `layout-component ${comp.isSelected ? 'selected' : ''} ${comp.isMaximized ? 'maximized' : ''}`,
			style: `position: absolute; left: ${comp.x}%; top: ${comp.y}%; width: ${comp.width}%; height: ${comp.height}%; border: ${comp.isSelected ? '2px solid var(--accent-primary)' : '1px solid var(--border-primary)'}; background: var(--bg-secondary); border-radius: 4px; overflow: hidden; ${comp.isLoading ? 'opacity: 0.5;' : ''}`,
			"data-component": comp.name,
			"component-content": { tag: "div", style: "width: 100%; height: 100%; overflow: auto;", ...tree }
		};
	}
	return { "layout-container": { tag: "div", style: "position: relative; width: 100vw; height: 100vh; overflow: hidden;", ...componentNodes } };
};
// keyboard navigation
const setupKeyboardHandlers = () => document.addEventListener('keydown', async (e) => {
	const maximized = getAllActiveComponents().find(comp => comp.isMaximized);
	const hasSelection = getAllActiveComponents().some(comp => comp.isSelected);
	if (e.key === 'Escape') return (e.preventDefault(), maximized ? await restoreMaximized() : hasSelection && await clearSelections());
	if (e.key === 'Tab') return (e.preventDefault(), await cycleSelection());
	if (e.key === 'Enter' && hasSelection && !maximized) return (e.preventDefault(), await maximizeSelected());
	if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && hasSelection && !maximized) return (e.preventDefault(), await expandSelectedComponent(e.key));
});
// public api
export const replaceComponent = async (name, newTree) => {
	const element = document.querySelector(`[data-component="${name}"] .component-content`);
	element && await runtime.call('tree-to-dom.transform', getComponentTree(name), element);
};
// testing
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
		})
	];
};