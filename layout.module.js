export const manifest = {
	name: 'layout',
	version: '1.0.0',
	context: 'extension-page',
	description: 'Dynamic component positioning and UI layout management',
	dependencies: ['tree-to-dom'],
	actions: ['initializeLayout', 'maximizeComponent', 'startResize']
};

let runtime, currentLayout = [], savedLayout = [], maximizedComponent = null, selectedComponent = null;
const LAYOUT_KEY = 'layout.config';
const GRID_SIZE = 5; // 5% grid snapping

export const initialize = (rt) => (runtime = rt, initializeLayout());

// Component Discovery & Registration
const registerComponents = async () => runtime.getLoadedModules()
	.flatMap(m => (m.manifest.uiComponents || []).map(comp => ({ ...comp, moduleId: m.name })))
	.filter(comp => comp.name && comp.getTree);

const getComponentTree = async (component) => await runtime.call(`${component.moduleId}.${component.getTree}`);

// Layout Persistence
const loadLayout = async () => (await chrome.storage.sync.get(LAYOUT_KEY))[LAYOUT_KEY] || getDefaultLayout();
const saveLayout = async (layout) => await chrome.storage.sync.set({ [LAYOUT_KEY]: layout });
const getDefaultLayout = () => [
	{ name: 'search-input', x: 10, y: 5, width: 80, height: 10 },
	{ name: 'main-content', x: 10, y: 20, width: 80, height: 70 }
];

// Grid Positioning
const snapToGrid = (value) => Math.round(value / GRID_SIZE) * GRID_SIZE;
const normalizePosition = ({ x, y, width, height }) => ({
	x: snapToGrid(Math.max(0, Math.min(x, 100 - width))),
	y: snapToGrid(Math.max(0, Math.min(y, 100 - height))),
	width: snapToGrid(Math.max(GRID_SIZE, Math.min(width, 100 - x))),
	height: snapToGrid(Math.max(GRID_SIZE, Math.min(height, 100 - y)))
});

// Collision Detection
const hasCollision = (pos1, pos2) => !(pos1.x + pos1.width <= pos2.x || pos2.x + pos2.width <= pos1.x || pos1.y + pos1.height <= pos2.y || pos2.y + pos2.height <= pos1.y);
const findCollisions = (position, layout, excludeName) => layout.filter(comp => comp.name !== excludeName && hasCollision(position, comp));
const isValidPosition = (position, layout, excludeName) => findCollisions(position, layout, excludeName).length === 0;

// Component Positioning
const createPositionedContainer = (position) => ({
	tag: 'div',
	style: `position: absolute; left: ${position.x}%; top: ${position.y}%; width: ${position.width}%; height: ${position.height}%; border: ${selectedComponent === position.name ? '2px solid #0066cc' : '1px solid #333'}; background: white; overflow: auto; cursor: pointer;`,
	class: 'layout-component',
	'data-component': position.name,
	events: { click: 'layout.maximizeComponent' },
	...createResizeHandles(position)
});

const createResizeHandles = (position) => ({
	'resize-handle-right': {
		tag: 'div',
		style: 'position: absolute; right: -3px; top: 0; width: 6px; height: 100%; cursor: e-resize; background: transparent;',
		class: 'resize-handle',
		'data-direction': 'right',
		events: { mousedown: 'layout.startResize' }
	},
	'resize-handle-bottom': {
		tag: 'div',
		style: 'position: absolute; bottom: -3px; left: 0; width: 100%; height: 6px; cursor: s-resize; background: transparent;',
		class: 'resize-handle',
		'data-direction': 'bottom',
		events: { mousedown: 'layout.startResize' }
	},
	'resize-handle-corner': {
		tag: 'div',
		style: 'position: absolute; right: -3px; bottom: -3px; width: 6px; height: 6px; cursor: se-resize; background: transparent;',
		class: 'resize-handle',
		'data-direction': 'corner',
		events: { mousedown: 'layout.startResize' }
	}
});

// Layout Rendering
const renderComponent = async (component, position) => {
	const tree = await getComponentTree(component);
	const container = createPositionedContainer(position);
	container['component-content'] = tree;
	return container;
};

const clearLayout = () => document.querySelectorAll('.layout-component').forEach(el => el.remove());

const renderLayout = async (layout = currentLayout) => {
	clearLayout();
	const components = await registerComponents();
	const componentMap = components.reduce((map, comp) => (map[comp.name] = comp, map), {});

	const layoutTree = {};
	for (const position of layout) {
		if (componentMap[position.name]) {
			layoutTree[`component-${position.name}`] = await renderComponent(componentMap[position.name], position);
		}
	}

	await runtime.call('tree-to-dom.transform', layoutTree, document.body);
	currentLayout = layout;
};

// Layout Management Actions
export const initializeLayout = async () => {
	currentLayout = await loadLayout();
	await renderLayout();
	setupKeyboardHandlers();
};

const setupKeyboardHandlers = () => {
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && maximizedComponent) restoreLayout();
		if (e.key === 'Tab') { e.preventDefault(); cycleSelection(); }
		if (e.key === 'Delete' && selectedComponent) removeComponent(selectedComponent);
		if (e.key === 'Enter' && selectedComponent) maximizeSelectedComponent();
		if (e.ctrlKey && e.key === 'r') initializeLayout();

		// Arrow key movement for selected component
		if (selectedComponent && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
			e.preventDefault();
			moveSelectedComponent(e.key);
		}
	});
};

const cycleSelection = async () => {
	if (currentLayout.length === 0) return;

	const currentIndex = selectedComponent ? currentLayout.findIndex(c => c.name === selectedComponent) : -1;
	const nextIndex = (currentIndex + 1) % currentLayout.length;
	selectedComponent = currentLayout[nextIndex].name;

	await renderLayout(); // Re-render to show selection
};

const maximizeSelectedComponent = async () => {
	if (!selectedComponent) return;
	const mockEvent = { target: { closest: () => ({ dataset: { component: selectedComponent } }) } };
	await maximizeComponent(mockEvent);
};

const moveSelectedComponent = async (direction) => {
	if (!selectedComponent) return;

	const component = currentLayout.find(c => c.name === selectedComponent);
	if (!component) return;

	const deltaMap = {
		'ArrowUp': { x: 0, y: -GRID_SIZE },
		'ArrowDown': { x: 0, y: GRID_SIZE },
		'ArrowLeft': { x: -GRID_SIZE, y: 0 },
		'ArrowRight': { x: GRID_SIZE, y: 0 }
	};

	const delta = deltaMap[direction];
	const newPosition = normalizePosition({
		x: component.x + delta.x,
		y: component.y + delta.y,
		width: component.width,
		height: component.height
	});

	if (isValidPosition(newPosition, currentLayout, selectedComponent)) {
		Object.assign(component, newPosition);
		await saveLayout(currentLayout);
		await renderLayout();
	}
};

export const maximizeComponent = async (event) => {
	const componentName = event?.target?.closest('.layout-component')?.dataset.component || event;
	if (!componentName || maximizedComponent) return;

	savedLayout = [...currentLayout];
	maximizedComponent = componentName;

	const maxLayout = [{ name: componentName, x: 0, y: 0, width: 100, height: 100 }];
	await renderLayout(maxLayout);
};

export const restoreLayout = async () => {
	if (!maximizedComponent) return;
	maximizedComponent = null;
	await renderLayout(savedLayout);
	currentLayout = savedLayout;
};

// Component Management
const findAvailableSpace = (width = 30, height = 20) => {
	for (let y = 0; y <= 100 - height; y += GRID_SIZE) {
		for (let x = 0; x <= 100 - width; x += GRID_SIZE) {
			const testPos = { x, y, width, height };
			if (isValidPosition(testPos, currentLayout)) return testPos;
		}
	}
	return null; // no space available
};

const pushComponentsDown = (newPosition) => {
	const conflicts = findCollisions(newPosition, currentLayout);
	conflicts.forEach(comp => {
		comp.y = Math.min(newPosition.y + newPosition.height + GRID_SIZE, 100 - comp.height);
	});
	return conflicts.length > 0;
};

const addComponent = async (name, position) => {
	const defaultPos = position || findAvailableSpace();
	let finalPos;

	if (defaultPos) {
		finalPos = normalizePosition({ ...defaultPos, name });
	} else {
		// No space found - create space by pushing components down
		const testPos = { x: 10, y: 10, width: 30, height: 20, name };
		pushComponentsDown(testPos);
		finalPos = normalizePosition(testPos);
	}

	currentLayout = [...currentLayout.filter(c => c.name !== name), finalPos];
	await saveLayout(currentLayout);
	await renderLayout();
	return true;
};

const removeComponent = async (name) => {
	currentLayout = currentLayout.filter(c => c.name !== name);
	if (selectedComponent === name) selectedComponent = null;
	await saveLayout(currentLayout);
	await renderLayout();
};

export const updateComponentPosition = async (name, newPosition) => {
	const normalized = normalizePosition(newPosition);
	if (!isValidPosition(normalized, currentLayout, name)) return false;

	currentLayout = currentLayout.map(c => c.name === name ? { ...c, ...normalized } : c);
	await saveLayout(currentLayout);
	await renderLayout();
	return true;
};

// Resize Handling
let resizing = null;

export const startResize = (event) => {
	event.stopPropagation();
	const component = event.target.closest('.layout-component');
	const direction = event.target.dataset.direction;
	const componentName = component.dataset.component;
	const rect = component.getBoundingClientRect();
	const containerRect = document.body.getBoundingClientRect();

	resizing = {
		componentName,
		direction,
		startX: event.clientX,
		startY: event.clientY,
		startWidth: (rect.width / containerRect.width) * 100,
		startHeight: (rect.height / containerRect.height) * 100,
		startLeft: ((rect.left - containerRect.left) / containerRect.width) * 100,
		startTop: ((rect.top - containerRect.top) / containerRect.height) * 100
	};

	document.addEventListener('mousemove', handleResize);
	document.addEventListener('mouseup', stopResize);
};

const handleResize = (event) => {
	if (!resizing) return;

	const containerRect = document.body.getBoundingClientRect();
	const deltaX = ((event.clientX - resizing.startX) / containerRect.width) * 100;
	const deltaY = ((event.clientY - resizing.startY) / containerRect.height) * 100;

	const newPosition = calculateNewPosition(resizing, deltaX, deltaY);
	const component = currentLayout.find(c => c.name === resizing.componentName);

	if (component && isValidPosition(newPosition, currentLayout, resizing.componentName)) {
		Object.assign(component, newPosition);
		updateComponentStyle(resizing.componentName, newPosition);
	}
};

const calculateNewPosition = ({ direction, startLeft, startTop, startWidth, startHeight }, deltaX, deltaY) => {
	switch (direction) {
		case 'right': return { x: startLeft, y: startTop, width: startWidth + deltaX, height: startHeight };
		case 'bottom': return { x: startLeft, y: startTop, width: startWidth, height: startHeight + deltaY };
		case 'corner': return { x: startLeft, y: startTop, width: startWidth + deltaX, height: startHeight + deltaY };
		default: return { x: startLeft, y: startTop, width: startWidth, height: startHeight };
	}
};

const updateComponentStyle = (componentName, position) => {
	const element = document.querySelector(`[data-component="${componentName}"]`);
	if (element) {
		element.style.left = `${position.x}%`;
		element.style.top = `${position.y}%`;
		element.style.width = `${position.width}%`;
		element.style.height = `${position.height}%`;
	}
};

const stopResize = async () => {
	if (resizing) {
		await saveLayout(currentLayout);
		resizing = null;
	}
	document.removeEventListener('mousemove', handleResize);
	document.removeEventListener('mouseup', stopResize);
};

export const test = () => [
	{
		name: 'Registers components and validates collision detection',
		test: async () => {
			const components = await registerComponents();
			const testLayout = [{ name: 'test1', x: 10, y: 10, width: 30, height: 20 }];
			const validPos = { name: 'test2', x: 50, y: 10, width: 30, height: 20 };
			const invalidPos = { name: 'test2', x: 15, y: 15, width: 30, height: 20 };
			return {
				hasComponents: components.length > 0,
				hasRequiredFields: components.every(c => c.name && c.getTree && c.moduleId),
				noCollisionValid: isValidPosition(validPos, testLayout, 'test2'),
				collisionInvalid: !isValidPosition(invalidPos, testLayout, 'test2'),
				gridSnapping: snapToGrid(23) === 25
			};
		},
		expect: { hasComponents: true, hasRequiredFields: true, noCollisionValid: true, collisionInvalid: true, gridSnapping: true }
	},
	{
		name: 'Manages component lifecycle with space creation and keyboard navigation',
		test: async () => {
			currentLayout = [{ name: 'existing', x: 10, y: 10, width: 30, height: 20 }];
			const spaceFound = findAvailableSpace(25, 15) !== null;
			await addComponent('newComp', { x: 50, y: 10, width: 25, height: 15 });
			const addSuccess = currentLayout.length === 2;

			currentLayout = [{ name: 'blocking', x: 10, y: 10, width: 80, height: 80 }];
			await addComponent('pushed', { x: 15, y: 15, width: 20, height: 15 });
			const pushSuccess = currentLayout.find(c => c.name === 'blocking').y > 15;

			selectedComponent = null;
			await cycleSelection();
			const firstSelected = selectedComponent === 'pushed';
			await cycleSelection();
			const wrapsToBlocking = selectedComponent === 'blocking';

			const originalX = currentLayout.find(c => c.name === 'blocking').x;
			selectedComponent = 'blocking';
			await moveSelectedComponent('ArrowRight');
			const moved = currentLayout.find(c => c.name === 'blocking').x > originalX;

			return { spaceFound, addSuccess, pushSuccess, firstSelected, wrapsToBlocking, moved };
		},
		expect: { spaceFound: true, addSuccess: true, pushSuccess: true, firstSelected: true, wrapsToBlocking: true, moved: true }
	}
];