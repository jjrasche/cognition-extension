export const manifest = {
	name: 'ui',
	version: '1.0.0',
	context: ['extension-page'],
	description: 'Extension page layout and tree orchestration',
	dependencies: ['tree-to-dom'],
	actions: ['initializeLayout', 'renderTree', 'handleSearchKeydown', 'showModal', 'closeModal', 'updatePrompt', 'clearPrompt', 'toggleListening', 'speakPrompt'],
};
let runtime;
export const initialize = async (rt) => {
	runtime = rt;
	await initializeLayout();
};

export const initializeLayout = async () => {
	getMainLayout()?.remove();
	const layoutTree = {
		"main-layout": {
			tag: "div", id: MAIN_LAYOUT_ID,
			"main-content": { tag: "div", id: MAIN_CONTENT_ID, innerHTML: loadingHTML("Enter a search query to begin") },
			"search-bar": {
				tag: "div", id: "cognition-search-bar", style: "position: relative; display: flex; align-items: center; gap: 10px;",
				"search-input": { tag: "input", id: SEARCH_INPUT_ID, type: "text", placeholder: "Search the web...", events: { keydown: "ui.handleSearchKeydown" }, style: "flex: 1;" },
				"button-group": {
					tag: "div", style: "display: flex; gap: 8px;",
				}
			}
		}
	};
	await runtime.call('tree-to-dom.transform', layoutTree, document.body);
	getSearchInput()?.["focus"]();
};
export const handleSearchKeydown = async (event) => {
	if (event.key !== 'Enter' || !event.target.value.trim()) return;
	const input = event.target.value.trim();
	showState('Searching...', 'loading');
	const action = await getAction(input);
	try {
		if (action) await action.func(input);
		else showState('No valid action found', 'error');
	} catch (error) { showState(`Search failed: ${error.message}`, 'error'); }
};
// todo: move these declarations to the modules and pull for all of them in UI module initialization
const searchInputActions = [
	{ name: "chunking evaluation", condition: input => input === "eval", func: async (input) => await renderTree(await runtime.call('file-to-graph.renderEvaluationDashboard', input)) },
	{ name: "read webpage", condition: input => new URL(input.startsWith('http') ? input : `https://${input}`), func: async (input) => await renderTree(await runtime.call('web-read.extractPage', input)) },
	{ name: "search web", condition: input => input.length < 20, func: async (input) => await renderTree(await runtime.call('web-search.getSearchTree', input)) },
];
const getAction = async (input) => {
	const actions = await Promise.all(searchInputActions.filter(async a => await a.condition(input)));
	if (actions.length > 0) {
		runtime.log(`matched ${actions.length} actions for input ${input.substring(0, 20)}:\n${actions.map(a => `- ${a.name}`).join('\n')}`);
	}
	const action = actions[0];
	runtime.log(`selected action ${action.name} for input ${input.substring(0, 20)}`);
	return actions[0];
}
export const renderTree = async (tree, container) => {
	const target = container || getMainContent();
	if (!target) throw new Error('Container not found');
	return await runtime.call('tree-to-dom.transform', tree, target);
};
export const showModal = async ({ title, content = "", tree, actions = {} }) => {
	const existingOverlay = document.querySelector('.cognition-overlay');

	// Build new modal structure (hidden)
	const newModalTree = {
		"modal-overlay": {
			tag: "div", class: "cognition-overlay", style: "display: none",
			"modal": {
				tag: "div", class: "cognition-modal",
				"header": { tag: "h3", text: title, class: "cognition-modal-header" },
				"content": { tag: "div", class: "cognition-modal-content", ...(content && { innerHTML: content }) },
				"actions": { tag: "div", class: "cognition-modal-actions", ...actions }
			}
		}
	};
	// Render new modal structure
	const elements = await renderTree(newModalTree, document.body);
	const newOverlay = elements["modal-overlay"];
	try {
		if (tree) {
			const contentDiv = newOverlay.querySelector('.cognition-modal-content');
			if (contentDiv) await renderTree(tree, contentDiv);
			else runtime.logError('[UI] Could not find modal content div for tree rendering');
		}
		// Atomic swap: show new, remove old
		newOverlay.style.display = '';
		if (existingOverlay) existingOverlay.remove();
	} catch (error) {
		newOverlay.remove();
		if (existingOverlay) existingOverlay["style"].display = '';
		throw error;
	}
};
export const updatePrompt = async (text) => {
	const input = getSearchInput();
	if (input) input["value"] = text;
};
export const clearPrompt = async () => {
	const input = getSearchInput();
	if (input) input["value"] = '';
};
export const closeModal = async () => document.querySelector('.cognition-overlay')?.remove();
const showState = (message, type) => getMainContent()["innerHTML"] = type === 'error' ? errorHTML(message) : loadingHTML(message);
const createElement = (tag, attrs = {}) => Object.assign(document.createElement(tag), attrs);
const loadingHTML = (message) => `<div class="cognition-loading"><div class="cognition-spinner"></div><div class="cognition-loading-message">${message}</div></div>`;
const errorHTML = (message) => `<div class="cognition-error"><div class="cognition-error-icon">⚠️</div><div class="cognition-error-message">${message}</div></div>`;
const MAIN_LAYOUT_ID = 'cognition-main-layout';
const SEARCH_INPUT_ID = 'cognition-search-input';
const MAIN_CONTENT_ID = 'cognition-main-content';
const getMainLayout = () => document.querySelector(`#${MAIN_LAYOUT_ID}`);
const getSearchInput = () => document.querySelector(`#${SEARCH_INPUT_ID}`);
const getMainContent = () => document.querySelector(`#${MAIN_CONTENT_ID}`) || (() => { throw new Error('Main content area not found'); });
const unsafeGetElement = (selector) => document.querySelector(selector) ?? (() => { throw new Error(`Element not found: ${selector}`); })();

// testing
export const test = async () => {
	const { runUnitTest } = runtime.testUtils;
	await runUnitTest("Initializes complete extension layout", async () => {
		const layout = getMainLayout(), searchInput = getSearchInput(), mainContent = getMainContent();
		const actual = { hasLayout: !!layout, hasSearch: !!searchInput, hasMain: !!mainContent, inputFocused: document.activeElement === searchInput };
		const expected = { hasLayout: true, hasSearch: true, hasMain: true, inputFocused: true };
		return { actual, assert: runtime.testUtils.deepEqual, expected };
	});
	return [
		await runUnitTest("Search input triggers search on Enter key", async () => {
			let searchQuery = null;
			const originalCall = runtime.call;
			runtime.call = async (action, ...args) => action === 'web-search.getSearchTree' && (searchQuery = args[0]);
			const testQuery = "test search";
			await handleSearchKeydown({ key: 'Enter', target: { value: testQuery } });
			runtime.call = originalCall;
			const actual = { searchTriggered: !!searchQuery, query: searchQuery };
			const expected = { searchTriggered: true, query: testQuery };
			return { actual, assert: runtime.testUtils.deepEqual, expected };
		}),
		await runUnitTest("Staged replacement: First modal creation", async () => {
			// Ensure clean state
			document.querySelectorAll('.cognition-overlay').forEach(el => el.remove());
			const testTree = {
				"test-form": {
					tag: "form",
					"test-input": { tag: "input", name: "testField", value: "initial" }
				}
			};
			await showModal({ title: "Test Modal", tree: testTree });
			const overlay = unsafeGetElement('.cognition-overlay');
			const input = unsafeGetElement('[name="testField"]');
			const actual = { hasOverlay: !!overlay, isVisible: overlay["style"].display !== 'none', inputValue: input["value"] };
			const expected = { hasOverlay: true, isVisible: true, inputValue: "initial" };
			overlay?.remove();
			return { actual, assert: runtime.testUtils.deepEqual, expected };
		}),
		await runUnitTest("Staged replacement: Modal replacement preserves no flicker", async () => {
			document.querySelectorAll('.cognition-overlay').forEach(el => el.remove());
			const firstTree = {
				"form1": {
					tag: "form",
					"input1": { tag: "input", name: "field1", value: "first" }
				}
			};
			await showModal({ title: "First Modal", tree: firstTree });
			unsafeGetElement('.cognition-overlay').dataset.testId = 'first';
			const secondTree = {
				"form2": {
					tag: "form",
					"input2": { tag: "input", name: "field2", value: "second" }
				}
			};
			await showModal({ title: "Second Modal", tree: secondTree });
			const remainingOverlays = document.querySelectorAll('.cognition-overlay');
			const currentOverlay = remainingOverlays[0];
			const input = unsafeGetElement('[name="field2"]');
			const actual = { overlayCount: remainingOverlays.length, firstModalGone: !document.querySelector('[data-test-id="first"]'), hasSecondContent: !!input, inputValue: input.value };
			const expected = { overlayCount: 1, firstModalGone: true, hasSecondContent: true, inputValue: "second" };
			remainingOverlays.forEach(el => el.remove());
			return { actual, assert: runtime.testUtils.deepEqual, expected };
		}),
		await runUnitTest("Staged replacement: Error handling cleans up gracefully", async () => {
			// Ensure clean state
			document.querySelectorAll('.cognition-overlay').forEach(el => el.remove());

			// Mock renderTree to fail on second call
			const originalRenderTree = runtime.call;
			let callCount = 0;
			runtime.call = async (action, ...args) => {
				if (action === 'tree-to-dom.transform') { callCount++; }
				return originalRenderTree(action, ...args);
			};

			const testTree = { "failing-form": { tag: "form", "input": { tag: "input" } } };

			let errorThrown = false;
			try { await showModal({ title: "Test Modal", tree: testTree }); }
			catch (error) { errorThrown = true; }
			runtime.call = originalRenderTree;
			const actual = { errorThrown, overlayCount: document.querySelectorAll('.cognition-overlay').length };
			const expected = { errorThrown: true, overlayCount: 0 };
			return { actual, assert: runtime.testUtils.deepEqual, expected };
		}),
		await runUnitTest("Focus handling: Tree focus property works", async () => {
			document.querySelectorAll('.cognition-overlay').forEach(el => el.remove());
			const focusTree = {
				"focus-form": {
					tag: "form",
					"input1": { tag: "input", name: "first", value: "not focused" },
					"input2": { tag: "input", name: "second", value: "should focus", focus: true }
				}
			};
			await showModal({ title: "Focus Test", tree: focusTree });
			await new Promise(resolve => setTimeout(resolve, 10)); // Wait for focus to be applied (setTimeout in tree-to-dom)
			const focusedElement = document.activeElement ?? (() => { throw new Error('No active element'); });
			const actual = { hasFocus: !!focusedElement, focusedName: focusedElement["name"], focusedValue: focusedElement["value"] };
			const expected = { hasFocus: true, focusedName: "second", focusedValue: "should focus" };
			document.querySelector('.cognition-overlay')?.remove();
			return { actual, assert: runtime.testUtils.deepEqual, expected };
		})
	];
};