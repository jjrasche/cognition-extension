import { configProxy } from './config.module.js';
export const manifest = {
	name: "layout",
	context: ["extension-page"],
	version: "1.0.0",
	description: "Dynamic component positioning and layout management with grid snapping",
	permissions: ["storage"],
	dependencies: ["chrome-sync", "tree-to-dom", "config"],
	config: {
		gridSize: { type: 'number', min: 1, max: 20, value: 5, label: 'Grid Snap Size (%)' },
		defaultComponentWidth: { type: 'number', min: 10, max: 90, value: 30, label: 'Default Component Width (%)' },
		defaultComponentHeight: { type: 'number', min: 10, max: 90, value: 20, label: 'Default Component Height (%)' },
		enableKeyboardNav: { type: 'checkbox', value: true, label: 'Enable Keyboard Navigation' },
		showGridLines: { type: 'checkbox', value: false, label: 'Show Grid Lines' }
	}
};
let runtime, currentLayout = [], savedLayout = [], maximizedComponent = null, selectedComponent = null, registeredComponents = null;
const config = configProxy(manifest);
export const initialize = async (rt) => (runtime = rt, await initializeLayout());

// Component Discovery
const getRegisteredComponents = () => registeredComponents ?? runtime.getModulesWithProperty('uiComponents')
	.flatMap(m => (m.manifest.uiComponents || [])
		.map(comp => {
			runtime.registerAction(m, comp.getTree)
			return { ...comp, moduleName: m.manifest.name };
		}));

const getComponentTree = async (component) => await runtime.call(`${component.moduleName}.${component.getTree}`);
// Layout Persistence 
const loadLayout = async () => await runtime.call('chrome-sync.get', 'layout.positions') || getDefaultLayout();
const saveLayout = async (layout) => await runtime.call('chrome-sync.set', { 'layout.positions': layout });
const getDefaultLayout = () => [
	{ name: 'command-input', x: 10, y: 5, width: 80, height: 10 },
	// { name: 'main-content', x: 10, y: 20, width: 80, height: 70 }
];
// Grid & Positioning
const snapToGrid = (value) => Math.round(value / config.gridSize) * config.gridSize;
const normalizePosition = ({ x, y, width, height }) => ({
	x: snapToGrid(Math.max(0, Math.min(x, 100 - width))),
	y: snapToGrid(Math.max(0, Math.min(y, 100 - height))),
	width: snapToGrid(Math.max(config.gridSize, Math.min(width, 100 - x))),
	height: snapToGrid(Math.max(config.gridSize, Math.min(height, 100 - y)))
});
// Collision Detection
const hasCollision = (pos1, pos2) => !(pos1.x + pos1.width <= pos2.x || pos2.x + pos2.width <= pos1.x || pos1.y + pos1.height <= pos2.y || pos2.y + pos2.height <= pos1.y);
const isValidPosition = (position, layout, excludeName) => layout.filter(comp => comp.name !== excludeName && hasCollision(position, comp)).length === 0;
// Component Rendering
const createComponentContainer = async (component, position) => {
	const tree = await getComponentTree(component);
	return {
		tag: "div",
		style: `position: absolute; left: ${position.x}%; top: ${position.y}%; width: ${position.width}%; height: ${position.height}%; 
		        border: ${selectedComponent === position.name ? '2px solid var(--accent-primary)' : '1px solid var(--border-primary)'}; 
		        background: var(--bg-secondary); overflow: auto; z-index: ${maximizedComponent === position.name ? 1000 : 1};`,
		class: "layout-component",
		"data-component": position.name,
		events: { click: "layout.selectComponent" },
		"component-content": tree
	};
};
const buildLayoutTree = async (layout = currentLayout) => {
	const components = getRegisteredComponents();
	const componentMap = components.reduce((map, comp) => (map[comp.name] = comp, map), {});
	const tree = { "layout-container": { tag: "div", style: "position: relative; width: 100%; height: 100vh; overflow: hidden;" } };
	if (config.showGridLines) tree["layout-container"]["grid-overlay"] = createGridOverlay();
	for (const position of layout) {
		if (componentMap[position.name]) {
			tree["layout-container"][`component-${position.name}`] = await createComponentContainer(componentMap[position.name], position);
		}
	}
	return tree;
};
const createGridOverlay = () => ({
	tag: "div",
	style: `position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0;
	        background-image: repeating-linear-gradient(0deg, rgba(0,0,0,0.1) 0px, transparent 1px, transparent ${config.gridSize}%, rgba(0,0,0,0.1) ${config.gridSize + 0.1}%),
	                          repeating-linear-gradient(90deg, rgba(0,0,0,0.1) 0px, transparent 1px, transparent ${config.gridSize}%, rgba(0,0,0,0.1) ${config.gridSize + 0.1}%);`
});
// Layout Management
export const initializeLayout = async () => {
	currentLayout = await loadLayout();
	await renderLayout();
	config.enableKeyboardNav && setupKeyboardHandlers();
};
const renderLayout = async (layout = currentLayout) => {
	const tree = await buildLayoutTree(layout);
	await runtime.call('ui.renderTree', tree);
	currentLayout = layout;
};
const setupKeyboardHandlers = () => document.addEventListener('keydown', async (e) => {
	if (e.key === 'Escape' && maximizedComponent) await restoreLayout();
	if (e.key === 'Tab') { e.preventDefault(); await cycleSelection(); }
	if (e.key === 'Delete' && selectedComponent) await removeComponent(selectedComponent);
	if (e.key === 'Enter' && selectedComponent) await maximizeComponent({ target: { dataset: { component: selectedComponent } } });
	if (e.ctrlKey && e.key === 'r') { e.preventDefault(); await initializeLayout(); }
	if (selectedComponent && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
		e.preventDefault();
		await moveSelectedComponent(e.key);
	}
});
// Component Selection & Navigation
export const selectComponent = async (event) => {
	selectedComponent = event.target.closest('.layout-component')?.dataset.component;
	await renderLayout();
};
export const cycleSelection = async () => {
	if (currentLayout.length === 0) return;
	const currentIndex = selectedComponent ? currentLayout.findIndex(c => c.name === selectedComponent) : -1;
	selectedComponent = currentLayout[(currentIndex + 1) % currentLayout.length].name;
	await renderLayout();
};
const moveSelectedComponent = async (direction) => {
	if (!selectedComponent) return;
	const component = currentLayout.find(c => c.name === selectedComponent);
	if (!component) return;
	const deltaMap = { ArrowUp: { x: 0, y: -config.gridSize }, ArrowDown: { x: 0, y: config.gridSize }, ArrowLeft: { x: -config.gridSize, y: 0 }, ArrowRight: { x: config.gridSize, y: 0 } };
	const delta = deltaMap[direction];
	const newPosition = normalizePosition({ x: component.x + delta.x, y: component.y + delta.y, width: component.width, height: component.height });
	if (isValidPosition(newPosition, currentLayout, selectedComponent)) {
		Object.assign(component, newPosition);
		await saveLayout(currentLayout);
		await renderLayout();
	}
};
// Maximize/Restore
export const maximizeComponent = async (event) => {
	const componentName = event?.target?.dataset?.component || event?.target?.closest('.layout-component')?.dataset?.component;
	if (!componentName || maximizedComponent) return;
	savedLayout = [...currentLayout];
	maximizedComponent = componentName;
	await renderLayout([{ name: componentName, x: 0, y: 0, width: 100, height: 100 }]);
};
export const restoreLayout = async () => {
	if (!maximizedComponent) return;
	maximizedComponent = null;
	await renderLayout(savedLayout);
	currentLayout = savedLayout;
};
// Component Management
const findAvailableSpace = (width = config.defaultComponentWidth, height = config.defaultComponentHeight) => {
	for (let y = 0; y <= 100 - height; y += config.gridSize) {
		for (let x = 0; x <= 100 - width; x += config.gridSize) {
			const testPos = { x, y, width, height };
			if (isValidPosition(testPos, currentLayout)) return testPos;
		}
	}
	return null;
};
export const addComponent = async (name, position) => {
	const finalPos = normalizePosition(position || findAvailableSpace() || { x: 10, y: 10, width: config.defaultComponentWidth, height: config.defaultComponentHeight });
	currentLayout = [...currentLayout.filter(c => c.name !== name), { name, ...finalPos }];
	await saveLayout(currentLayout);
	await renderLayout();
	return true;
};
export const removeComponent = async (name) => {
	currentLayout = currentLayout.filter(c => c.name !== name);
	if (selectedComponent === name) selectedComponent = null;
	await saveLayout(currentLayout);
	await renderLayout();
};
export const replaceComponent = async (name, newTree) => {
	const componentElement = document.querySelector(`[data-component="${name}"].component-content`);
	if (!componentElement) return;
	await runtime.call('tree-to-dom.transform', { content: newTree }, componentElement);
};
// UI Management
export const showLayoutUI = async () => await runtime.call('ui.renderTree', buildLayoutManagementTree());
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
	const components = getRegisteredComponents();
	const activeComponents = new Set(currentLayout.map(c => c.name));
	return {
		tag: "div", style: "margin-bottom: 20px;",
		"list-title": { tag: "h3", text: "Available Components" },
		"components": {
			tag: "div", style: "display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;",
			...Object.fromEntries(components.map(comp => [`comp-${comp.name}`, {
				tag: "div", style: `padding: 10px; border: 1px solid var(--border-primary); border-radius: 4px; ${activeComponents.has(comp.name) ? 'background: var(--bg-tertiary);' : 'cursor: pointer;'}`,
				events: activeComponents.has(comp.name) ? {} : { click: "layout.addComponent" },
				"data-component": comp.name,
				"name": { tag: "div", text: comp.name, style: "font-weight: 500;" },
				"type": { tag: "div", text: comp.type || 'component', style: "font-size: 12px; color: var(--text-muted);" },
				"status": { tag: "div", text: activeComponents.has(comp.name) ? "Active" : "Add", style: `font-size: 12px; color: ${activeComponents.has(comp.name) ? 'var(--success)' : 'var(--accent-primary)'};` }
			}]))
		}
	};
};
const buildLayoutPreview = () => ({
	tag: "div",
	"preview-title": { tag: "h3", text: `Current Layout (${currentLayout.length} components)` },
	"preview-list": {
		tag: "div", style: "display: flex; flex-direction: column; gap: 8px;",
		...Object.fromEntries(currentLayout.map(comp => [`preview-${comp.name}`, {
			tag: "div", style: "display: flex; justify-content: between; align-items: center; padding: 8px; background: var(--bg-tertiary); border-radius: 4px;",
			"info": { tag: "div", text: `${comp.name} (${comp.x}%, ${comp.y}%, ${comp.width}×${comp.height})`, style: "flex: 1;" },
			"remove-btn": { tag: "button", text: "×", class: "cognition-button-secondary", style: "width: 24px; height: 24px; padding: 0;", events: { click: "layout.removeComponentFromUI" }, "data-component": comp.name }
		}]))
	}
});
// Testing
export const test = async () => {
	const { runUnitTest, strictEqual, deepEqual } = runtime.testUtils;
	return [
		await runUnitTest("Component discovery and registration", async () => {
			const components = getRegisteredComponents();
			const actual = { hasComponents: components.length > 0, hasRequiredFields: components.every(c => c.name && c.getTree && c.moduleName) };
			return { actual, assert: deepEqual, expected: { hasComponents: true, hasRequiredFields: true } };
		}),
		await runUnitTest("Grid snapping and position normalization", async () => {
			const actual = { snap5: snapToGrid(23), snap20: snapToGrid(87), normalized: normalizePosition({ x: 7, y: 3, width: 103, height: 97 }) };
			const expected = { snap5: 25, snap20: 85, normalized: { x: 5, y: 5, width: 95, height: 95 } };
			return { actual, assert: deepEqual, expected };
		}),
		await runUnitTest("Collision detection", async () => {
			const layout = [{ name: 'existing', x: 10, y: 10, width: 30, height: 20 }];
			const validPos = { x: 50, y: 10, width: 30, height: 20 };
			const invalidPos = { x: 15, y: 15, width: 30, height: 20 };
			const actual = { validIsValid: isValidPosition(validPos, layout, 'test'), invalidIsInvalid: !isValidPosition(invalidPos, layout, 'test') };
			return { actual, assert: deepEqual, expected: { validIsValid: true, invalidIsInvalid: true } };
		}),
		await runUnitTest("Space finding and component addition", async () => {
			currentLayout = [{ name: 'existing', x: 10, y: 10, width: 30, height: 20 }];
			const space = findAvailableSpace(25, 15);
			const actual = { findsSpace: space !== null, hasValidCoords: space && space.x >= 0 && space.y >= 0 };
			return { actual, assert: deepEqual, expected: { findsSpace: true, hasValidCoords: true } };
		})
	];
};